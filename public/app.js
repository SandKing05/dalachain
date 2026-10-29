// DalaChain фронтенді
const $ = (id) => document.getElementById(id);
const short = (s, n = 10) => (s && s.length > n * 2 ? s.slice(0, n) + "…" + s.slice(-6) : s);
const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (t) => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const TYPE = { reward: "сыйақы", start: "бастапқы", transfer: "аударым" };

async function api(url, body) {
  const res = await fetch(url, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Қате");
  return data;
}

// ---------- браузерде сақталған әмияндар ----------
function myWallets() {
  try { return JSON.parse(localStorage.getItem("dalachain_wallets") || "[]"); } catch (e) { return []; }
}
function saveMyWallet(w) {
  const list = myWallets().filter((x) => x.address !== w.address);
  list.push({ address: w.address, name: w.name, privateKey: w.privateKey });
  try { localStorage.setItem("dalachain_wallets", JSON.stringify(list)); } catch (e) {}
}

let allWallets = [];
const nameOf = (addr) => (addr === "SYSTEM" ? "SYSTEM" : (allWallets.find((w) => w.address === addr) || {}).name || short(addr));

function fillSelects() {
  const mine = myWallets();
  const myOpts = mine.map((w) => `<option value="${w.address}">${w.name} — ${short(w.address, 8)}</option>`).join("")
    || `<option value="">Алдымен әмиян ашыңыз</option>`;
  ["myWallets", "sendFrom", "minerWallet"].forEach((id) => { const v = $(id).value; $(id).innerHTML = myOpts; if (v) $(id).value = v; });
  fillRecipients();
}

// алушылар тізімінде жіберушінің өзі болмайды
function fillRecipients() {
  const from = $("sendFrom").value;
  const v = $("sendTo").value;
  const others = allWallets.filter((w) => w.address !== from);
  $("sendTo").innerHTML = others.map((w) => `<option value="${w.address}">${w.name} — ${short(w.address, 8)}</option>`).join("")
    || `<option value="">Басқа әмиян жоқ</option>`;
  if (others.some((w) => w.address === v)) $("sendTo").value = v;
}

function txTable(txs, showBlock) {
  if (!txs.length) return `<p class="muted">Транзакция жоқ</p>`;
  return `<table><tr><th>Түрі</th><th>Жіберуші</th><th>Алушы</th><th>Сома</th>${showBlock ? "<th>Блок</th>" : ""}<th>ID</th></tr>` +
    txs.map((t) => `<tr><td><span class="tag ${t.type}">${TYPE[t.type]}</span></td><td>${nameOf(t.from)}</td><td>${nameOf(t.to)}</td>` +
      `<td><b>${t.amount}</b> DLC</td>${showBlock ? `<td>${t.block === null ? "күтуде" : "#" + t.block}</td>` : ""}` +
      `<td class="mono">${short(t.id, 8)}</td></tr>`).join("") + `</table>`;
}

function blockCard(b, invalid) {
  return `<div class="block ${invalid ? "invalid" : ""}">
    <div class="block-head"><span>Блок #${b.index}</span><span class="muted">${fmtTime(b.timestamp)}</span></div>
    <div class="kv">
      <div class="k">Nonce</div><div class="mono">${b.nonce}</div>
      <div class="k">Prev hash</div><div class="mono">${b.prevHash}</div>
      <div class="k">Hash</div><div class="mono">${b.hash}</div>
      <div class="k">Транзакциялар</div><div>${b.transactions.length}</div>
    </div>
    ${txTable(b.transactions, false)}
  </div>`;
}

// ---------- жүктеу ----------
async function refresh() {
  const [stats, chain, pending, wallets] = await Promise.all([
    api("/api/stats"), api("/api/chain"), api("/api/pending"), api("/api/wallets"),
  ]);
  allWallets = wallets;
  $("rewardInfo").textContent = stats.reward;
  $("stats").innerHTML = [
    ["Блоктар", stats.blocks], ["Транзакциялар", stats.transactions], ["Күтудегі", stats.pending],
    ["Әмияндар", stats.wallets], ["Күрделілік", "0".repeat(stats.difficulty)], ["Айналымда, DLC", stats.supply],
  ].map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
  $("lastBlocks").innerHTML = chain.slice(-3).reverse().map((b) => blockCard(b)).join("");
  $("pendingList").innerHTML = txTable(pending, false);
  $("chainView").innerHTML = chain.slice().reverse().map((b) => blockCard(b)).join("");
  $("allWallets").innerHTML = `<table><tr><th>Иесі</th><th>Мекенжай</th><th>Расталған баланс</th><th>Қолжетімді</th></tr>` +
    wallets.map((w) => `<tr><td>${w.name}</td><td class="mono">${w.address}</td><td>${w.confirmed} DLC</td><td>${w.available} DLC</td></tr>`).join("") + `</table>`;
  fillSelects();
  showWallet();
}

async function showWallet() {
  const addr = $("myWallets").value;
  if (!addr) { $("walletInfo").innerHTML = ""; return; }
  try {
    const w = await api("/api/wallet/" + addr);
    $("walletInfo").innerHTML = `<div class="kv" style="margin-top:12px">
      <div class="k">Мекенжай</div><div class="mono">${w.address}</div>
      <div class="k">Баланс</div><div><b>${w.confirmed} DLC</b> расталған</div>
      <div class="k">Қолжетімді</div><div>${w.available} DLC</div>
      <div class="k">Күтуде</div><div>+${w.pendingIn} / −${w.pendingOut} DLC</div></div>
      <h2 style="margin-top:16px">Тарих</h2>${txTable(w.history, true)}`;
  } catch (e) {
    $("walletInfo").innerHTML = `<div class="msg bad">${e.message}</div>`;
  }
}

// ---------- оқиғалар ----------
document.querySelectorAll("#tabs button").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("active", s.id === btn.dataset.tab));
  refresh();
}));

$("createWallet").onclick = async () => {
  try {
    const w = await api("/api/wallet", { name: $("walletName").value });
    saveMyWallet(w);
    $("newWallet").innerHTML = `<div class="msg ok">Әмиян ашылды: <b>${w.name}</b>
      <label>Мекенжай</label><div class="mono">${w.address}</div>
      <label>Жеке кілт (құпия, ешкімге көрсетпеңіз)</label><div class="mono key">${short(w.privateKey, 24)}</div>
      <p class="muted">100 DLC бастапқы сома келесі блок майнингтелгенде түседі.</p></div>`;
    $("walletName").value = "";
    await refresh();
    $("myWallets").value = w.address;
    showWallet();
  } catch (e) {
    $("newWallet").innerHTML = `<div class="msg bad">${e.message}</div>`;
  }
};

$("myWallets").onchange = showWallet;
$("sendFrom").onchange = fillRecipients;

$("sendBtn").onclick = async () => {
  const from = $("sendFrom").value;
  const w = myWallets().find((x) => x.address === from);
  try {
    if (!w) throw new Error("Жіберуші әмиянды таңдаңыз");
    const tx = await api("/api/transaction", { from, to: $("sendTo").value, amount: $("sendAmount").value, privateKey: w.privateKey });
    $("sendResult").innerHTML = `<div class="msg ok">Транзакция қол қойылып, күту тізіміне қосылды.
      <label>ID</label><div class="mono">${tx.id}</div>
      <label>Цифрлық қолтаңба</label><div class="mono">${short(tx.signature, 30)}</div></div>`;
    refresh();
  } catch (e) {
    $("sendResult").innerHTML = `<div class="msg bad">${e.message}</div>`;
  }
};

$("mineBtn").onclick = async () => {
  $("mineResult").innerHTML = `<div class="msg">Майнинг жүріп жатыр…</div>`;
  try {
    const r = await api("/api/mine", { miner: $("minerWallet").value });
    $("mineResult").innerHTML = `<div class="msg ok">Жаңа блок табылды! Тексерілген nonce саны: <b>${r.attempts.toLocaleString()}</b>, уақыты: <b>${r.ms} мс</b></div>` + blockCard(r.block);
    refresh();
  } catch (e) {
    $("mineResult").innerHTML = `<div class="msg bad">${e.message}</div>`;
  }
};

function showValidation(el, v, extra = "") {
  el.innerHTML = (v.valid
    ? `<div class="msg ok">✔ Тізбек жарамды: барлық хеш, сілтеме және қолтаңба дұрыс.${extra}</div>`
    : `<div class="msg bad">✘ Тізбек бұзылған!${extra}<ul>${v.errors.map((e) => `<li>Блок #${e.index}: ${e.reason}</li>`).join("")}</ul></div>`);
}

$("validateBtn").onclick = async () => showValidation($("validateResult"), await api("/api/validate"));

$("tamperBtn").onclick = async () => {
  try {
    const v = await api("/api/tamper", { block: $("tBlock").value, tx: $("tTx").value, amount: $("tAmount").value });
    showValidation($("tamperResult"), v);
    refresh();
  } catch (e) { $("tamperResult").innerHTML = `<div class="msg bad">${e.message}</div>`; }
};

$("remineBtn").onclick = async () => {
  try {
    const v = await api("/api/remine", { from: $("tBlock").value });
    showValidation($("tamperResult"), v, ` Шабуылшы ${v.attempts.toLocaleString()} nonce тексеріп, барлық келесі блоктарды қайта майнингтеді (${v.ms} мс). Нақты желіде басқа түйіндердегі тізбек ұзынырақ болғандықтан, мұндай тізбек қабылданбайды.`);
    refresh();
  } catch (e) { $("tamperResult").innerHTML = `<div class="msg bad">${e.message}</div>`; }
};

$("restoreBtn").onclick = async () => {
  try {
    showValidation($("tamperResult"), await api("/api/restore"), " Тізбек бастапқы күйіне қайтарылды.");
    refresh();
  } catch (e) { $("tamperResult").innerHTML = `<div class="msg bad">${e.message}</div>`; }
};

async function updateHash() {
  const text = $("hashInput").value;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  $("hashOutput").textContent = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
$("hashInput").oninput = updateHash;

refresh();
updateHash();
