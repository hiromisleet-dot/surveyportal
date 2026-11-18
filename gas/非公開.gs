/**
 * 非公開.gs（回答を管理者だけが見られるようにする機能）
 * アンケートごとに「回答を非公開にする」をオンにすると、次のようになる。
 *   ・回答する人の画面に、答えの中身と修正用リンク（Googleフォームの編集用URL）を渡さない
 *     → 名前を選び直して他の人になりすましても、その人の答えは見えない
 *   ・答えを直したいときは「答え直す」で空のフォームから送り直す。いちばん新しい送信を正とする
 *     （班ごとのアンケートも、2人目以降の送信を「重複送信」にせず、新しい答えとして採用する）
 *   ・作る人の画面・Notion・CSVでは、これまでどおり全員の答えが見られる
 *
 * 【記録のしかた】
 *  オン・オフは高速データの「アンケートの非公開」シートに持ち、Notionのアンケート管理の「回答を非公開」にも書く。
 *  いつでも切り替えられる（フォームの形は変わらないため）。
 */

const SECRET_SH = { name: 'アンケートの非公開', cols: [['surveyId', 'アンケートID'], ['on', '非公開']] };

/** アンケートIDから、回答を非公開にしているかを引く表 { アンケートID: true } */
function surveySecretMap_() {
  const m = {};
  readAll_(SECRET_SH).forEach(function (r) { if (r.on === '1') m[r.surveyId] = true; });
  return m;
}

/** 1つのアンケートが非公開かどうか */
function isSecretSurvey_(surveyId) {
  return !!surveySecretMap_()[normId_(surveyId)];
}

/**
 * アンケートの「回答を非公開」を記録する（シートに書き、Notionのアンケート管理にも書く）。
 */
function setSurveySecret_(surveyId, on) {
  surveyId = normId_(surveyId);
  withDataLock_(function () {
    const cur = readAll_(SECRET_SH).filter(function (r) { return r.surveyId === surveyId; })[0];
    if (cur) updateCells_(SECRET_SH, cur._row, { on: on ? '1' : '' });
    else appendRows_(SECRET_SH, [{ surveyId: surveyId, on: on ? '1' : '' }]);
  });
  try {
    notionUpdatePage_(surveyId, { '回答を非公開': P.checkbox(!!on) });
  } catch (e) {
    logWarn_('setSurveySecret_', 'Notionに「回答を非公開」を書けませんでした（アプリには反映済み）：' + e);
  }
}
