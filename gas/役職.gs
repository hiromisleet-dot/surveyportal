/**
 * 役職.gs（アンケートを出す役職と、メンバー・班・役職の読み直し）
 * 役職の一覧はNotionの「役職」データベースで管理し、高速用スプレッドシートの「役職」シートに写して使う。
 * アンケートにどの役職が付いているかは「アンケートの役職」シートに持つ（アンケートIDと役職IDの対応）。
 * Notionのアンケート管理DBにも「役職」として書き写す。
 *
 * 【スクリプトプロパティ】DB_ROLE … 役職データベースのID（未登録なら役職なしで動く）
 * 【Notionの役職DBの項目】役職名（タイトル）／並び順（数値）／使う（チェック）／登録した人（テキスト。なくても動く）
 * 【画面から呼ぶ関数】apiRoles／apiReloadMaster／apiAddRole／apiUpdateRole／apiMoveRole（合言葉が必要）
 *
 * 役職は消さずに「使う」のチェックを外して休ませる（過去のアンケートに役職名を残すため）。
 */

const ROLE_SH = { name: '役職', cols: [['id', '役職ID'], ['name', '役職名'], ['order', '並び順'], ['active', '使う']] };
const ROLE_SYNC_KEY = 'LAST_ROLE_SYNC_DATE'; // 役職を最後にNotionから読んだ日（1日1回、自動で読み直す）
const SURVEY_ROLE_SH = { name: 'アンケートの役職', cols: [['surveyId', 'アンケートID'], ['roleId', '役職ID']] };

// ===== 役職の一覧 =====

/**
 * Notionの役職DBを、役職シートに写す。1回の処理の中では1回だけ動く。DB_ROLE が未登録なら何もしない。
 */
function syncRolesFromNotion_() {
  if (syncRolesFromNotion_.done) return;
  const props = PropertiesService.getScriptProperties();
  const dbId = props.getProperty('DB_ROLE');
  syncRolesFromNotion_.done = true;
  props.setProperty(ROLE_SYNC_KEY, nowJst_('yyyy-MM-dd'));
  if (!dbId) return;
  const rows = notionQueryAll_(dbId.trim());
  replaceAll_(ROLE_SH, rows.map(function (r) {
    return { id: normId_(r.id), name: prop_(r, '役職名') || '', order: prop_(r, '並び順') === null ? '' : String(prop_(r, '並び順')),
      active: prop_(r, '使う') ? '1' : '' };
  }));
}

/**
 * 役職を並び順で返す。[{ id, name, order, active }]。シートが空か、その日まだ読んでいなければ、Notionから写してから返す。
 * 使わなくなった役職も返す（過去のアンケートの役職名を出すため）。画面のタブには active のものだけ出す。
 */
function getRoles_() {
  let list = readAll_(ROLE_SH);
  const last = PropertiesService.getScriptProperties().getProperty(ROLE_SYNC_KEY);
  if (!list.length || last !== nowJst_('yyyy-MM-dd')) { syncRolesFromNotion_(); list = readAll_(ROLE_SH); }
  return list.map(function (r) { return { id: r.id, name: r.name, order: Number(r.order || 9999), active: r.active === '1' }; })
    .sort(function (a, b) { return a.order - b.order || a.name.localeCompare(b.name, 'ja'); });
}

/** 役職IDから役職名を引く表 { 役職ID: 役職名 } */
function roleNameMap_() {
  const m = {};
  getRoles_().forEach(function (r) { m[r.id] = r.name; });
  return m;
}

// ===== アンケートの役職 =====

/** アンケートIDから役職IDを引く表 { アンケートID: 役職ID } */
function surveyRoleMap_() {
  const m = {};
  readAll_(SURVEY_ROLE_SH).forEach(function (r) { m[r.surveyId] = r.roleId; });
  return m;
}

/**
 * アンケートに役職を付ける（シートに書き、Notionのアンケート管理DBにも書く）。roleId が空なら「未設定」にする。
 */
function setSurveyRole_(surveyId, roleId) {
  surveyId = normId_(surveyId);
  roleId = normId_(roleId || '');
  withDataLock_(function () {
    const cur = readAll_(SURVEY_ROLE_SH).filter(function (r) { return r.surveyId === surveyId; })[0];
    if (cur) updateCells_(SURVEY_ROLE_SH, cur._row, { roleId: roleId });
    else appendRows_(SURVEY_ROLE_SH, [{ surveyId: surveyId, roleId: roleId }]);
  });
  try {
    notionUpdatePage_(surveyId, { '役職': P.relation(roleId ? [roleId] : []) });
  } catch (e) {
    logWarn_('setSurveyRole_', 'Notionに役職を書けませんでした（アプリには反映済み）：' + e);
  }
}

// ===== 読み直し =====

/**
 * メンバー・班・役職を、Notionから今すぐ読み直す（作る人の画面の「メンバー・班を読み直す」ボタン）。
 */
function reloadMasterData_() {
  syncMembersFromNotion_.done = false;
  syncHansFromNotion_.done = false;
  syncRolesFromNotion_.done = false;
  syncMembersFromNotion_();
  syncHansFromNotion_();
  syncRolesFromNotion_();
  const r = { members: getMembers_(true).length, hans: readAll_(SH.HAN).length, roles: getRoles_().length };
  logInfo_('reloadMasterData_', '読み直しました：在籍中 ' + r.members + '名、班 ' + r.hans + '件、役職 ' + r.roles + '件');
  return r;
}

// ===== 画面から呼ぶ関数 =====

/** 役職の一覧を返す（作る人の画面のタブと選択欄に使う） */
function apiRoles(pass) {
  checkPass_(pass);
  return getRoles_();
}

/** メンバー・班・役職を読み直す */
function apiReloadMaster(pass) {
  checkPass_(pass);
  return withErrorNotice_('apiReloadMaster', reloadMasterData_);
}

// ===== 役職の追加・書き換え（作る人の画面から） =====

/** 役職名を比べるための形（空白を除き、英字は小文字にそろえる）。「実行委員 」と「実行委員」を同じとみなす */
function roleKey_(name) {
  return String(name || '').replace(/[\s　]+/g, '').toLowerCase();
}

/** 役職名の入力を整える（前後の空白を除き、続いた空白を1つにする） */
function cleanRoleName_(name) {
  const s = String(name || '').replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) throw new Error('役職名を入れてください。');
  if (s.length > 40) throw new Error('役職名は40文字までにしてください。');
  return s;
}

function roleDbId_() {
  const id = (PropertiesService.getScriptProperties().getProperty('DB_ROLE') || '').trim();
  if (!id) throw new Error('役職データベースがまだ設定されていません（スクリプトプロパティ DB_ROLE）。');
  return id;
}

/** 役職シートの1行を書き換える */
function updateRoleRow_(id, changes) {
  withDataLock_(function () {
    const row = readAll_(ROLE_SH).filter(function (r) { return r.id === id; })[0];
    if (row) updateCells_(ROLE_SH, row._row, changes);
  });
}

/**
 * 役職を追加する。by は登録した人の名前（作成欄の「作成者」）。
 * 同じ名前の役職があるときは、使っていれば知らせ、休んでいれば「使う」に戻す（二重登録をしない）。
 * 戻り値：{ role, roles, revived }
 */
function apiAddRole(pass, name, by) {
  checkPass_(pass);
  name = cleanRoleName_(name);
  const roles = getRoles_();
  const same = roles.filter(function (r) { return roleKey_(r.name) === roleKey_(name); })[0];
  if (same && same.active) throw new Error('「' + same.name + '」はすでにあります。プルダウンから選んでください。');
  if (same) {
    notionUpdatePage_(same.id, { '使う': P.checkbox(true) });
    updateRoleRow_(same.id, { active: '1' });
    return { role: same, roles: getRoles_(), revived: true };
  }
  const order = roles.reduce(function (m, r) { return r.order < 9999 ? Math.max(m, r.order) : m; }, 0) + 1;
  const props = { '役職名': P.title(name), '並び順': { number: order }, '使う': P.checkbox(true) };
  let page;
  try {
    page = notionCreatePage_(roleDbId_(), Object.assign({ '登録した人': P.text(by || '') }, props));
  } catch (e) {
    // 役職DBに「登録した人」の欄がないときは、その欄なしで登録する
    if (!/登録した人/.test(String(e))) throw e;
    page = notionCreatePage_(roleDbId_(), props);
  }
  const id = normId_(page.id);
  withDataLock_(function () { appendRows_(ROLE_SH, [{ id: id, name: name, order: String(order), active: '1' }]); });
  logInfo_('apiAddRole', '役職を追加しました：' + name + '（' + (by || '名前なし') + '）');
  return { role: { id: id, name: name, order: order, active: true }, roles: getRoles_(), revived: false };
}

/**
 * 役職の名前・使う／使わないを書き換える。changes = { name, active }
 * 名前を変えると、過去のアンケートの表示も新しい名前になる。
 */
function apiUpdateRole(pass, id, changes) {
  checkPass_(pass);
  id = normId_(id);
  changes = changes || {};
  const roles = getRoles_();
  const cur = roles.filter(function (r) { return r.id === id; })[0];
  if (!cur) throw new Error('役職が見つかりません。画面を最新にしてください。');
  const np = {}, row = {};
  if (changes.name !== undefined) {
    const name = cleanRoleName_(changes.name);
    const same = roles.filter(function (r) { return r.id !== id && roleKey_(r.name) === roleKey_(name); })[0];
    if (same) throw new Error('「' + same.name + '」はすでにあります。別の名前にしてください。');
    np['役職名'] = P.title(name); row.name = name;
  }
  if (changes.active !== undefined) { np['使う'] = P.checkbox(!!changes.active); row.active = changes.active ? '1' : ''; }
  if (!Object.keys(np).length) return getRoles_();
  notionUpdatePage_(id, np);
  updateRoleRow_(id, row);
  logInfo_('apiUpdateRole', '役職を書き換えました：' + cur.name + ' → ' + JSON.stringify(row));
  return getRoles_();
}

/** 役職の並び順を1つ上（dir=-1）か下（dir=1）に動かす。並び順は1から振り直す */
function apiMoveRole(pass, id, dir) {
  checkPass_(pass);
  id = normId_(id);
  const roles = getRoles_();
  const i = roles.map(function (r) { return r.id; }).indexOf(id), j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= roles.length) return roles;
  const t = roles[i]; roles[i] = roles[j]; roles[j] = t;
  roles.forEach(function (r, k) {
    if (r.order === k + 1) return;
    notionUpdatePage_(r.id, { '並び順': { number: k + 1 } });
    updateRoleRow_(r.id, { order: String(k + 1) });
  });
  return getRoles_();
}

// ===== 動作確認用 =====

/** 役職をNotionから読み直して、ログシートに出すテスト */
function testRoles() {
  syncRolesFromNotion_.done = false;
  syncRolesFromNotion_();
  logInfo_('testRoles', JSON.stringify(getRoles_()));
}
