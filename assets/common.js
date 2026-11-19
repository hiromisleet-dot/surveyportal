// ===== 画面共通の道具 =====
/** サーバー（GAS）の関数を呼ぶ（Promiseで返す）
 *  GitHub Pagesから、GASのウェブアプリ（doPost）に fetch で送る。
 *  Content-Type を text/plain にしているのは、ブラウザの事前確認（CORS）を起こさないため。 */
function call(fn){
  const args = Array.prototype.slice.call(arguments, 1);
  return fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ fn: fn, args: args })
  })
  .then(function(r){
    if(!r.ok) throw new Error("サーバーにつながりませんでした（" + r.status + "）。少し待ってからもう一度お試しください。");
    return r.json();
  })
  .then(function(d){
    if(!d || !d.ok) throw new Error((d && d.error) || "サーバーでエラーが起きました。");
    return d.result;
  }, function(e){
    if(e instanceof SyntaxError) throw new Error("サーバーの返事を読めませんでした。GASのURLと公開設定を確かめてください。");
    throw e;
  });
}
/** 文字を画面に安全に出す */
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
/** 日時を「11/9 15:00」の形にする */
const fmt = s => { if(!s) return ""; const d = new Date(s); return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
/** 締め切りを「2026/11/20」または「2026/11/20 18:00」の形にする */
const fmtDl = s => { if(!s) return ""; if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g,"/"); const d = new Date(s); return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
/** 締め切りまであと何日か（日付の部分で数える） */
const daysLeft = s => Math.round((Date.parse(String(s).slice(0,10)+"T00:00:00") - Date.parse(todayStr()+"T00:00:00")) / 86400000);
function leftHtml(s){ const n = daysLeft(s); if(n < 0) return ""; return `<span class="left ${n<=3?"soon":""}">（${n===0?"今日まで":"あと"+n+"日"}）</span>`; }
function toast(t){ const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2500); }
function closeModal(){ document.getElementById("layer").innerHTML = ""; }
function modal(html){ document.getElementById("layer").innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`; }
const errMsg = e => (e && e.message ? e.message : String(e)).replace(/^Error:\s*/, "");

// ===== 線のアイコン（絵文字の代わり。色は文字の色に合わせる） =====
const ICONS = {
 "refresh": "<path d=\"M21 12a9 9 0 1 1-2.6-6.4L21 8\"/><path d=\"M21 3v5h-5\"/>",
 "lock": "<rect x=\"4\" y=\"11\" width=\"16\" height=\"10\" rx=\"2\"/><path d=\"M8 11V7a4 4 0 0 1 8 0v4\"/>",
 "unlock": "<rect x=\"4\" y=\"11\" width=\"16\" height=\"10\" rx=\"2\"/><path d=\"M8 11V7a4 4 0 0 1 7.9-1\"/>",
 "pencil": "<path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z\"/>",
 "file": "<path d=\"M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z\"/><path d=\"M14 3v6h6\"/><path d=\"M8 13h8M8 17h5\"/>",
 "check": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"m8 12 3 3 5-6\"/>",
 "search": "<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-3.5-3.5\"/>",
 "sliders": "<path d=\"M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12\"/><circle cx=\"16\" cy=\"6\" r=\"2\"/><circle cx=\"10\" cy=\"12\" r=\"2\"/><circle cx=\"18\" cy=\"18\" r=\"2\"/>",
 "down": "<path d=\"m6 9 6 6 6-6\"/>",
 "up": "<path d=\"m6 15 6-6 6 6\"/>",
 "arrowUp": "<path d=\"M12 19V5M5 12l7-7 7 7\"/>",
 "arrowDown": "<path d=\"M12 5v14M19 12l-7 7-7-7\"/>",
 "plus": "<path d=\"M12 5v14M5 12h14\"/>",
 "inbox": "<path d=\"M22 12h-6l-2 3h-4l-2-3H2\"/><path d=\"M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z\"/>",
 "clock": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>",
 "users": "<circle cx=\"9\" cy=\"8\" r=\"3.5\"/><path d=\"M2.5 20a6.5 6.5 0 0 1 13 0\"/><path d=\"M16 4.5a3.5 3.5 0 0 1 0 7\"/><path d=\"M18 14a6 6 0 0 1 3.5 6\"/>",
 "bell": "<path d=\"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9\"/><path d=\"M10.3 21a1.9 1.9 0 0 0 3.4 0\"/>",
 "link": "<path d=\"M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7\"/><path d=\"M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7\"/>",
 "undo": "<path d=\"M3 7v6h6\"/><path d=\"M21 17a9 9 0 0 0-15-6.7L3 13\"/>",
 "copy": "<rect x=\"8\" y=\"8\" width=\"13\" height=\"13\" rx=\"2\"/><path d=\"M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3\"/>",
 "trash": "<path d=\"M3 6h18\"/><path d=\"M8 6V4h8v2\"/><path d=\"M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6\"/>",
 "chart": "<path d=\"M3 3v18h18\"/><path d=\"M8 17v-4M13 17V8M18 17v-7\"/>",
 "comment": "<path d=\"M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z\"/>",
 "gear": "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z\"/>",
 "book": "<path d=\"M4 19.5A2.5 2.5 0 0 1 6.5 17H20\"/><path d=\"M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z\"/>",
 "list": "<path d=\"M8 6h13M8 12h13M8 18h13\"/><path d=\"M3 6h.01M3 12h.01M3 18h.01\"/>",
 "download": "<path d=\"M12 3v12\"/><path d=\"m7 10 5 5 5-5\"/><path d=\"M5 21h14\"/>"
};
/** アイコンのSVGを返す。ic("lock") のように使う */
function ic(name){
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}
