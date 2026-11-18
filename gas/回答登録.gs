/**
 * 回答登録.gs（No.6 回答の登録）
 * フォームに回答が届いたとき（修正も含む）に、高速用スプレッドシートの「対象者」と「回答データ」を更新する。
 * Notionへの書き写しは「Notion反映待ち」に積み、1分後にまとめて行う（Notion反映.gs）。
 * 順番待ちの中ではシートだけを書くので、1件0.5秒ほどで終わり、一斉に回答が来ても詰まりにくい。
 *
 * 【トリガー】公開したときに、フォームごとに onSurveySubmit を呼ぶトリガーが付く
 * 【班ごとのアンケート】2人目の送信は「重複送信」として記録だけし、班の答えには採用しない
 *   （回答を非公開にしているアンケートだけは、答え直しとして新しい答えを採用する）
 * 【修正】編集用リンクからの再送信は回答IDが同じまま届く。上書きはせず、Notionの本文に履歴を書き足す
 */

const LOCK_WAIT_MS = 300000; // 同時に回答が届いたときに順番待ちする最大時間（5分）

// ===== 入口（トリガーから呼ばれる） =====

/**
 * フォームの送信トリガーから呼ばれる関数。名前を変えないこと（フォーム作成.gs の SUBMIT_HANDLER と同じ）。
 * 順番待ちが長すぎたときは諦める。定期チェックの「取りこぼしの回収」が後から拾う。
 */
function onSurveySubmit(e) {
  let queued = false;
  try {
    queued = withDataLock_(function () {
      return withErrorNotice_('onSurveySubmit', function () { return handleResponse_(e.source, e.response); });
    }, LOCK_WAIT_MS);
  } catch (err) {
    if (String(err.message) === 'BUSY') {
      logWarn_('onSurveySubmit', '順番待ちが5分を超えたため、定期チェックで後から登録します（回答ID ' + e.response.getId() + '）');
      return;
    }
    throw err;
  }
  if (queued) kickNotionSync_();
}

/**
 * 1件の回答を処理する本体。書き込みの順番待ちの中で呼ぶこと。
 * 戻り値 = Notionへの作業を積んだら true
 */
function handleResponse_(form, response) {
  const survey = findSurveyByForm_(form.getId());
  if (!survey) throw new Error('高速データに、このフォームのアンケートが見つかりません：' + form.getTitle());
  if (survey.status !== '受付中') logWarn_('handleResponse_', '状態が「' + survey.status + '」のアンケートに回答が届きました：' + survey.title);

  const info = readResponse_(response);
  const prev = getAnswerData_(info.responseId);
  if (prev && prev.submittedAt >= info.at) return false; // すでに登録済み（取りこぼしの回収と重なったとき）

  const edited = findTargetByResponse_(survey.id, info.responseId);
  let result;
  if (edited) result = recordEdit_(survey, edited, info);
  else if (info.name === GUEST_CHOICE) result = recordGuestAnswer_(survey, info); // リスト外の方（リスト外.gs）
  else if (survey.unit === '班ごと') result = recordHanAnswer_(survey, info);
  else result = recordPersonAnswer_(survey, info);

  saveAnswerData_({ responseId: info.responseId, surveyId: survey.id, label: result ? result.label : '',
    submittedAt: info.at, name: info.displayName, answers: JSON.stringify(info.items) });
  CacheService.getScriptCache().remove('sum:' + survey.id); // 集計を作り直す
  if (!result) return false;

  enqueueNotion_({ kind: 'answer', surveyId: survey.id, key: result.key, responseId: info.responseId,
    note: { kind: result.kind, text: result.text || '', name: info.displayName, atLabel: info.atLabel,
      answers: info.items.map(function (x) { return { q: x.q, a: formatAnswer_(x.v) }; }) } });
  return true;
}

// ===== 人ごとのアンケート =====

/**
 * 人ごとのアンケートの新しい回答を記録する。
 * 同じ人が編集用リンクを使わずにもう一度送ってきた場合は、「再回答」として最新を正にする。
 */
function recordPersonAnswer_(survey, info) {
  const member = memberByName_(info.name);
  if (!member) return null;
  const t = getTarget_(survey.id, 'm:' + member.id);
  if (!t) {
    logWarn_('recordPersonAnswer_', '対象者ではない人からの回答です（公開後の入会など）。記録しません：' + info.name);
    return null;
  }
  const again = t.state === '回答済み';
  updateCells_(SH.TARGET, t._row, { state: '回答済み', answeredAt: info.at, answeredBy: info.name, responseId: info.responseId,
    editUrl: info.editUrl, edited: again ? '1' : '' });
  return { key: t.key, label: t.label, kind: again ? '再回答' : '回答', text: again ? '前回の回答のあと、もう一度送信されました' : '' };
}

// ===== 班ごとのアンケート =====

/**
 * 班ごとのアンケートの新しい回答を記録する。
 * 班がまだ「未回答」なら、その班の答えとして採用する。すでに回答済みなら「重複送信」として記録だけする。
 */
function recordHanAnswer_(survey, info) {
  const member = memberByName_(info.name);
  if (!member) return null;
  const mine = getHansOfMember_(member.id).filter(function (h) { return h.kubunId === survey.kubunId; })[0];
  const t = mine ? getTarget_(survey.id, 'h:' + mine.han) : null;
  if (!t) {
    logWarn_('recordHanAnswer_', 'この区分の班に入っていない人からの回答です。記録しません：' + info.name);
    return null;
  }
  if (t.state === '回答済み' && isSecretSurvey_(survey.id)) {
    // 回答を非公開にしているアンケートは、班の答えを見て直せないため、「答え直す」の送信を新しい答えとして採用する（非公開.gs）
    updateCells_(SH.TARGET, t._row, { answeredAt: info.at, answeredBy: info.name, responseId: info.responseId,
      editUrl: info.editUrl, edited: '1' });
    return { key: t.key, label: t.label, kind: '再回答', text: t.han + '班として ' + info.name + ' さんが答え直しました' };
  }
  if (t.state === '回答済み') {
    return { key: t.key, label: t.label, kind: '重複送信（採用せず）',
      text: '班の回答はすでに ' + t.answeredBy + ' さんが送信済みのため、この送信は班の答えには使っていません' };
  }
  updateCells_(SH.TARGET, t._row, { state: '回答済み', answeredAt: info.at, answeredBy: info.name, responseId: info.responseId,
    editUrl: info.editUrl, edited: '' });
  return { key: t.key, label: t.label, kind: '回答', text: t.han + '班として ' + info.name + ' さんが回答' };
}

// ===== 修正（編集用リンクからの再送信） =====

/**
 * 編集用リンクから直された回答を記録する。行の持ち主（人・班）は変えず、履歴を書き足す。
 * 人ごと：名前を書き換えられていても、元の人の回答として扱う。
 * 班ごと：名前の欄の人を「修正した人」とする。名前が元のままなら「修正者：不明」とする。
 */
function recordEdit_(survey, t, info) {
  const original = t.answeredBy;
  let text;
  if (t.key.indexOf('g:') === 0) {
    // リスト外の方の修正。書いた名前が変わっていたら、それに合わせる
    const name = info.guestName || original;
    updateCells_(SH.TARGET, t._row, { answeredAt: info.at, edited: '1', editUrl: info.editUrl, answeredBy: name, label: GUEST_STATE + '｜' + name });
    return { key: t.key, label: GUEST_STATE + '｜' + name, kind: '修正', text: name !== original ? '名前を「' + original + '」から「' + name + '」に直しています' : '' };
  }
  if (survey.unit === '班ごと') {
    text = '修正者：' + (info.name && info.name !== original ? info.name : '不明');
  } else {
    text = (info.name && info.name !== original)
      ? '名前の欄が「' + info.name + '」に変えられていましたが、' + original + ' さんの回答として扱っています' : '';
  }
  updateCells_(SH.TARGET, t._row, { answeredAt: info.at, edited: '1', editUrl: info.editUrl });
  return { key: t.key, label: t.label, kind: '修正', text: text };
}

// ===== 回答の読み取り =====

/**
 * フォームの回答を読み、{ responseId, editUrl, at, atLabel, name, items:[{id, q, v}] } にする。
 * v は答えそのもの（文字、または複数選択・グリッドの配列）。
 */
function readResponse_(response) {
  let name = '', guestName = '';
  const items = [];
  response.getItemResponses().forEach(function (ir) {
    const item = ir.getItem();
    const q = item.getTitle();
    const v = ir.getResponse();
    if (q === NAME_QUESTION_TITLE) name = String(v || '');
    else if (q === GUEST_NAME_TITLE) guestName = String(v || '').trim(); // リスト外の方が書いた名前
    else items.push({ id: String(item.getId()), q: q, v: v });
  });
  const ts = response.getTimestamp();
  return {
    responseId: response.getId(),
    editUrl: response.getEditResponseUrl(),
    at: Utilities.formatDate(ts, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    atLabel: Utilities.formatDate(ts, TIMEZONE, 'yyyy/MM/dd HH:mm'),
    name: name,
    guestName: guestName,
    displayName: name === GUEST_CHOICE ? (guestName || '名前の入力なし') + '（リスト外）' : name,
    items: items,
  };
}

/**
 * 回答の値を文字にする（チェックボックスやグリッドの配列も「、」でつなぐ）。
 */
function formatAnswer_(v) {
  if (v === null || v === undefined || v === '') return '（未記入）';
  if (Array.isArray(v)) return v.map(function (x) { return Array.isArray(x) ? x.join('・') : (x || '－'); }).join('、');
  return String(v);
}

/**
 * 名前の欄の名前から、メンバーを1人探す。見つからなければ、Notionから最新のメンバーを写して探し直す。
 * 同姓同名がいたら注意を残して1人目を使う。
 */
function memberByName_(name) {
  let hits = findMembersByName_(name);
  if (!hits.length) { syncMembersFromNotion_(); hits = findMembersByName_(name); }
  if (!hits.length) {
    logWarn_('memberByName_', 'メンバーに見つからない名前のため記録できません：' + name);
    return null;
  }
  if (hits.length > 1) logWarn_('memberByName_', '同姓同名のメンバーが' + hits.length + '名います：' + name);
  return hits[0];
}

// ===== 動作確認用 =====

/**
 * いちばん新しい受付中のアンケートに、テストの回答を1件送る（送信トリガーが動いて記録される）。
 * 下の TEST_NAME の人として送る。数秒後に高速データの「対象者」、1〜2分後にNotionを確認する。
 */
function testSubmitResponse() {
  const TEST_NAME = '青木 さくら';
  const s = getSurveys_().filter(function (x) { return x.status === '受付中'; })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })[0];
  if (!s) throw new Error('受付中のアンケートがありません。先に公開してください');
  const form = FormApp.openById(s.formId);
  const res = form.createResponse();
  form.getItems().forEach(function (item) {
    if (item.getTitle() === NAME_QUESTION_TITLE) res.withItemResponse(item.asListItem().createResponse(TEST_NAME));
    else if (item.getType() === FormApp.ItemType.TEXT) res.withItemResponse(item.asTextItem().createResponse('テスト回答です'));
    else if (item.getType() === FormApp.ItemType.PARAGRAPH_TEXT) res.withItemResponse(item.asParagraphTextItem().createResponse('テスト回答です'));
    else if (item.getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
      const c = item.asMultipleChoiceItem().getChoices();
      if (c.length) res.withItemResponse(item.asMultipleChoiceItem().createResponse(c[0].getValue()));
    }
  });
  res.submit();
  logInfo_('testSubmitResponse', s.title + ' に ' + TEST_NAME + ' として送信しました');
}