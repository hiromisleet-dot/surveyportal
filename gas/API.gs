/**
 * API.gs（GitHub Pagesの画面から呼ばれる窓口）
 *
 * 画面（index.html・admin.html）は、ここに fetch でPOSTする。
 * 送られてくる形：{ "fn": "apiMySurveys", "args": [ ... ] }
 * 返す形　　　　：{ "ok": true, "result": ... } または { "ok": false, "error": "メッセージ" }
 *
 * 呼べるのは名前が api で始まる関数だけ（apiMembers、apiCreate など）。
 * 作る人用の api〜 は、これまでどおり関数の中で合言葉を確かめる。
 *
 * 【入れ方】本体GASに「API」というスクリプトファイルを足して、この中身を貼る。
 * そのあと「デプロイを管理」で、今のデプロイを「新しいバージョン」に更新する（URLは変わらない）。
 */
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = String(req.fn || '');
    const args = Array.isArray(req.args) ? req.args : [];
    if (!/^api[A-Z]\w*$/.test(fn) || typeof globalThis[fn] !== 'function') {
      throw new Error('呼べない処理です：' + fn);
    }
    const result = globalThis[fn].apply(null, args);
    out = { ok: true, result: result === undefined ? null : result };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
