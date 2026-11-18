/**
 * ウェブアプリ.gs（No.1 回答する人の画面、No.2 作る人の画面のサーバー側）
 * URLの末尾で画面を切り替える。
 *   回答する人：…/exec
 *   作る人　　：…/exec?p=admin
 * 画面（HTML）からは google.script.run で、このファイルの api〜 の関数を呼ぶ。
 * データはすべて高速用スプレッドシートから読む（Notionやフォームには読みに行かない）。
 * 作る人の api〜 は、毎回合言葉をチェックする（合言葉はNotionの設定ページで変更できる）。
 * 役職まわり（apiRoles・apiReloadMaster）は 役職.gs、期まわり（apiCurrentKi）は 期.gs にある。
 * 作ったあとのアンケートの役職・期・回答の単位は apiEditSurvey で直す（Notionで直接直してもアプリには反映されないため）。
 *
 * 【画面のファイル】回答する人.html、作る人.html、共通スタイル.html
 */

const CLOSED_LIST_LIMIT = 200; // 作る人の一覧に出す締め切り済みの件数（作成日の新しい順）
const HAN_HELP_TEXT = '班の代表としてご回答ください。修正するときは、ご自身のお名前に変えてから送信してください。'; // 班ごとのときの「お名前」の注意書き（フォーム作成.gs と同じ文）

// ===== 画面を出す =====

/**
 * ウェブアプリを開いたときに呼ばれる。?p=admin なら作る人の画面、それ以外は回答する人の画面を出す。
 */
function doGet(e) {
  const admin = e && e.parameter && e.parameter.p === 'admin';
  const t = HtmlService.createTemplateFromFile(admin ? '作る人' : '回答する人');
  return t.evaluate()
    .setTitle(admin ? 'アンケート管理' : 'アンケート回答状況')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * HTMLの中で別のHTMLファイル（共通スタイル）を読み込むための道具。
 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ===== 回答する人の画面から呼ぶ関数 =====

/**
 * 名前を選ぶプルダウン用に、在籍中のメンバーを返す。[{ id, name, kana }]
 */
function apiMembers() {
  return getMembers_(true).map(function (m) { return { id: m.id, name: m.name, kana: m.kana }; });
}

/**
 * その人に関係するアンケートの一覧を返す（受付中・締め切りのものだけ）。
 * 人ごと：自分の行／班ごと：自分の班の行 を見て、未回答・回答済み・対象外を判定する。どの役職からのアンケートかも付ける。
 */
function apiMySurveys(memberId) {
  return withErrorNotice_('apiMySurveys', function () {
    memberId = normId_(memberId);
    const me = getMember_(memberId);
    const myName = me ? me.name : '';
    const myHans = {};
    getHansOfMember_(memberId).forEach(function (h) { myHans[h.kubunId + '|h:' + h.han] = true; });
    const roleOf = surveyRoleMap_();
    const roleName = roleNameMap_();
    const secretOn = surveySecretMap_(); // 回答を非公開にしているアンケート（非公開.gs）

    const surveys = {};
    getSurveys_().forEach(function (s) { if (s.status === '受付中' || s.status === '締め切り') surveys[s.id] = s; });

    const out = [];
    getTargets_().forEach(function (t) {
      const s = surveys[t.surveyId];
      if (!s) return;
      const mine = t.memberId ? t.memberId === memberId : !!myHans[t.kubunId + '|' + t.key];
      if (!mine) return;
      const secret = !!secretOn[s.id];
      out.push({ secret: secret,
        id: s.id, title: s.title, deadline: s.deadline, status: s.status, unit: s.unit,
        roleName: roleName[roleOf[s.id]] || '',
        state: t.state, han: t.han, answeredAt: t.answeredAt, edited: t.edited === '1', answeredBy: t.answeredBy,
        // 非公開のアンケートは、答えの中身を開く手がかり（回答ID・編集用リンク）を画面に渡さない
        editUrl: secret ? '' : t.editUrl, responseId: secret ? '' : t.responseId,
        formUrl: s.status === '受付中' ? prefilledUrl_(s, myName) : '',
      });
    });
    return out;
  });
}

/**
 * 自分（自分の班）の回答の中身を返す。[{ q, a }]
 */
function apiMyAnswer(surveyId, responseId) {
  if (isSecretSurvey_(surveyId)) throw new Error('このアンケートの回答は、管理者だけが見られます。');
  const a = getAnswerData_(responseId);
  if (!a || a.surveyId !== normId_(surveyId)) return [];
  let items = [];
  try { items = JSON.parse(a.answers || '[]'); } catch (e) { /* 壊れた行は空で返す */ }
  return items.map(function (x) { return { q: x.q, a: formatAnswer_(x.v) }; });
}

// ===== 作る人の画面から呼ぶ関数（すべて合言葉が必要） =====

/** 合言葉が合っているかを確かめる（画面の入口で使う） */
function apiLogin(pass) {
  return { ok: checkPass_(pass, true) };
}

/**
 * 作る人の一覧。受付中・公開待ち・生成中・エラーは全部、締め切り済みは作成日の新しい順に CLOSED_LIST_LIMIT 件まで。
 * 各アンケートに、回答済み数・対象数（対象外（退会）は数えない）、役職ID、作成日時、期をつける。
 */
function apiAdminList(pass) {
  checkPass_(pass);
  return withErrorNotice_('apiAdminList', function () {
    const count = {};
    getTargets_().forEach(function (t) {
      const c = count[t.surveyId] = count[t.surveyId] || { answered: 0, total: 0, guest: 0 };
      if (t.state === '回答済み') { c.answered++; c.total++; } else if (t.state === '未回答') c.total++;
      else if (t.state === GUEST_STATE) c.guest++;
    });
    const roleOf = surveyRoleMap_();
    const guestOn = surveyGuestMap_();
    const secretOn = surveySecretMap_();
    const kiMap = surveyKiMap_();
    const createdOf = function (s) { return String(s.createdAt || s.deadline || ''); };
    const list = getSurveys_().filter(function (s) { return s.status !== '削除'; })
      .sort(function (a, b) { return createdOf(b).localeCompare(createdOf(a)); });
    let closed = 0;
    return list.filter(function (s) { return s.status !== '締め切り' || ++closed <= CLOSED_LIST_LIMIT; }).map(function (s) {
      const c = count[s.id] || { answered: 0, total: 0, guest: 0 };
      return { allowGuest: !!guestOn[s.id], secret: !!secretOn[s.id], guest: c.guest, id: s.id, title: s.title, deadline: s.deadline, status: s.status, unit: s.unit, formId: s.formId,
        formUrl: s.formUrl, editUrl: s.editUrl, publishAt: s.publishAt, author: s.author, roleId: roleOf[s.id] || '',
        createdAt: s.createdAt || '', ki: kiOfSurvey_(s, kiMap), answered: c.answered, total: c.total };
    });
  });
}

/** リマインド文のひな形を返す（Notionの設定ページの「リマインド文：」の欄。未設定なら空） */
function apiRemindTemplate(pass) {
  checkPass_(pass);
  return getSettings_().remind || '';
}

/** アンケートを新しく作る。params = { title, deadline, publishAt, unit, author, roleId, ki, allowGuest, secret } */
function apiCreate(pass, params) {
  checkPass_(pass);
  const r = createSurvey(params);
  if (params.allowGuest) setSurveyGuest_(r.pageId, true);
  if (params.secret) setSurveySecret_(r.pageId, true);
  setSurveyRole_(r.pageId, params.roleId);
  setSurveyKi_(r.pageId, params.ki);
  stampCreatedAt_(r.pageId);
  return r;
}

/** アンケートを複製する。params = { title, deadline, publishAt, author, roleId, ki }（役職が空なら元の役職を引き継ぐ） */
function apiDuplicate(pass, srcId, params) {
  checkPass_(pass);
  const r = duplicateSurvey(srcId, params);
  if (surveyGuestMap_()[normId_(srcId)]) setSurveyGuest_(r.pageId, true); // リスト外の設定は元から引き継ぐ（フォームの形もコピーされる）
  if (isSecretSurvey_(srcId)) setSurveySecret_(r.pageId, true);          // 回答の非公開も元から引き継ぐ
  setSurveyRole_(r.pageId, params.roleId || surveyRoleMap_()[normId_(srcId)] || '');
  setSurveyKi_(r.pageId, params.ki);
  stampCreatedAt_(r.pageId);
  return r;
}

/**
 * 作ったあとのアンケートの、役職・期・回答の単位・リスト外の受け付け・回答の非公開を直す。params = { roleId, ki, unit, allowGuest, secret }
 * 回答の非公開は、どの状態でも直せる（フォームの形は変わらないため）。
 * リスト外の受け付けも、回答の単位と同じく「公開待ち」のときだけ直せる（フォームのページの形が変わるため）。
 * 役職と期は、どの状態でも直せる（高速データとNotionの両方を書き換える）。
 * 回答の単位は「公開待ち」のときだけ直せる。公開後は対象者が決まっているため、切り替えると集計がずれる。
 * 単位を切り替えたときは、フォームの説明文と「お名前」の注意書きも合わせて直す（名前のプルダウンはどちらも同じメンバー一覧）。
 */
function apiEditSurvey(pass, id, params) {
  checkPass_(pass);
  return withErrorNotice_('apiEditSurvey', function () {
    const s = getSurvey_(id);
    if (!s) throw new Error('アンケートが見つかりません');
    params = params || {};
    const changed = [];

    if (params.roleId !== undefined && params.roleId !== (surveyRoleMap_()[s.id] || '')) {
      setSurveyRole_(s.id, params.roleId || '');
      changed.push('役職');
    }
    const ki = Number(params.ki);
    if (ki && ki !== kiOfSurvey_(s, surveyKiMap_())) {
      setSurveyKi_(s.id, ki);
      changed.push('期');
    }
    if (params.allowGuest !== undefined && !!params.allowGuest !== !!surveyGuestMap_()[s.id]) {
      if (s.status !== '公開待ち') throw new Error('リスト外の受け付けは「公開待ち」のあいだだけ変えられます');
      if (s.formId) setGuestMode_(FormApp.openById(s.formId), !!params.allowGuest);
      setSurveyGuest_(s.id, !!params.allowGuest);
      changed.push('リスト外の受け付け');
    }
    if (params.secret !== undefined && !!params.secret !== isSecretSurvey_(s.id)) {
      setSurveySecret_(s.id, !!params.secret);
      changed.push('回答の非公開');
    }
    if (params.unit && params.unit !== (s.unit || '人ごと')) {
      if (['人ごと', '班ごと'].indexOf(params.unit) < 0) throw new Error('回答の単位が正しくありません');
      if (s.status !== '公開待ち') throw new Error('回答の単位は「公開待ち」のあいだだけ変えられます');
      changeUnit_(s, params.unit);
      changed.push('回答の単位');
    }
    logInfo_('apiEditSurvey', s.title + '：' + (changed.length ? changed.join('・') + 'を変更' : '変更なし'));
    return { ok: true, changed: changed };
  });
}

/**
 * 回答の単位を切り替える（apiEditSurvey から呼ぶ）。
 * 高速データ → フォームの説明文と注意書き → Notionの「回答単位」の順に直す。
 */
function changeUnit_(s, unit) {
  withDataLock_(function () { saveSurvey_({ id: s.id, unit: unit }); });
  if (s.formId) {
    const form = FormApp.openById(s.formId);
    form.setDescription(formDescription_({ deadline: String(s.deadline).slice(0, 10), unit: unit }));
    findNameItem_(form).setHelpText(unit === '班ごと' ? HAN_HELP_TEXT : '');
  }
  try {
    notionUpdatePage_(s.id, { '回答単位': P.select(unit) });
  } catch (e) {
    logWarn_('changeUnit_', s.title + '：Notionの回答単位を書き換えられませんでした：' + e);
  }
}

/** 今すぐ公開する */
function apiPublishNow(pass, id) { checkPass_(pass); return publishNow(id); }

/** 締め切る */
function apiClose(pass, id) { checkPass_(pass); return closeNow(id); }

/** 新しい締め切りで受付を再開する */
function apiReopen(pass, id, deadline) { checkPass_(pass); return reopenSurvey(id, deadline); }

/** アンケートを削除する（フォーム・管理の行・回答の行をすべてゴミ箱へ。30日以内なら元に戻せる） */
function apiDelete(pass, id) { checkPass_(pass); return deleteSurvey(id); }

/**
 * 集計（回答率・未回答の一覧・質問ごとの集計）を返す。
 * fresh が true のときは、使い回している集計と質問の形を捨てて作り直す（質問を足したあとなど）。
 */
function apiSummary(pass, id, fresh) {
  checkPass_(pass);
  if (fresh) {
    const s = getSurvey_(id);
    CacheService.getScriptCache().removeAll(['sum:' + normId_(id), s ? 'q:' + s.formId : 'q:']);
  }
  return getSurveySummary(id);
}

/** 回答をCSVにするための表を返す（回答した人だけ。リスト外の回答も含む） */
function apiCsv(pass, id) {
  checkPass_(pass);
  return withErrorNotice_('apiCsv', function () { return surveyCsv_(id); });
}

// ===== 小さな道具 =====

/**
 * 合言葉をチェックする。違えばエラーにする（soft が true のときは true/false を返す）。
 */
function checkPass_(pass, soft) {
  const ok = !!pass && pass === getSettings_().password;
  if (!ok && !soft) throw new Error('合言葉が違います。画面を開き直して、もう一度入れてください。');
  return ok;
}

/**
 * アンケートの作成日時が空なら、今の日時を書いておく（締め切り済みの一覧を作成日順に並べるため）。
 */
function stampCreatedAt_(surveyId) {
  try {
    const s = getSurvey_(surveyId);
    if (s && !s.createdAt) saveSurvey_({ id: s.id, createdAt: nowJst_() });
  } catch (e) {
    logWarn_('stampCreatedAt_', '作成日時を書けませんでした：' + e);
  }
}

/**
 * 名前が入った状態で開くフォームのURL（事前入力URL）を作る。
 * 名前の入力欄の番号は作成のときにシートに書いてある。古いアンケートで空なら、ここで1回だけ調べて書いておく。
 */
function prefilledUrl_(s, name) {
  if (!s.formUrl) return '';
  let entry = s.entryId;
  if (!entry && s.formId) {
    try {
      entry = nameEntryId_(FormApp.openById(s.formId));
      if (entry) saveSurvey_({ id: s.id, entryId: entry });
    } catch (e) { logWarn_('prefilledUrl_', s.title + '：名前の入力欄番号を取れませんでした：' + e); }
  }
  if (!entry || !name) return s.formUrl;
  return s.formUrl.split('?')[0] + '?usp=pp_url&entry.' + entry + '=' + encodeURIComponent(name);
}

// ===== 動作確認用 =====

/**
 * 回答する人の一覧を、在籍中の1人目でログシートに出すテスト（かかった時間も出す）。
 */
function testMySurveys() {
  const m = apiMembers()[0];
  const t0 = Date.now();
  const list = apiMySurveys(m.id);
  logInfo_('testMySurveys', m.name + '：' + list.length + '件、' + ((Date.now() - t0) / 1000).toFixed(1) + '秒　' + JSON.stringify(list));
}

/**
 * 公開待ちのアンケート1件で、回答の単位を切り替えて元に戻すテスト（ログシートに結果を出す）。
 */
function testEditSurvey() {
  const s = getSurveys_().filter(function (x) { return x.status === '公開待ち'; })[0];
  if (!s) throw new Error('公開待ちのアンケートがありません。先に testCreateSurvey を実行してください');
  const pass = getSettings_().password;
  const other = s.unit === '班ごと' ? '人ごと' : '班ごと';
  logInfo_('testEditSurvey', apiEditSurvey(pass, s.id, { unit: other }));
  logInfo_('testEditSurvey', apiEditSurvey(pass, s.id, { unit: s.unit || '人ごと' }));
}