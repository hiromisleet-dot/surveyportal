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
