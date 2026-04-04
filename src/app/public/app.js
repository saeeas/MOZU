// ── タブ切り替え ──────────────────────────────
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${target}`).classList.add("active");
    if (target === "quote") loadMarkupRates();
  });
});

// ── 今日の日付表示 ───────────────────────────
const DAYS = ["日", "月", "火", "水", "木", "金", "土"];
const now = new Date();
document.getElementById("today-date").textContent =
  `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${DAYS[now.getDay()]}）`;

// ── アカウント接続状況 ───────────────────────
async function loadAccountStatus() {
  const res = await fetch("/auth/status").then((r) => r.json());
  const container = document.getElementById("account-status");
  container.innerHTML = "";

  const accounts = {
    mozu:     { label: "仕事", hint: "s_nagaosa@mozu-inc.com" },
    personal: { label: "個人", hint: "1296bty@gmail.com" },
  };

  for (const [key, info] of Object.entries(accounts)) {
    const connected = !!res[key];
    const chip = document.createElement("div");
    chip.className = `account-chip ${connected ? "connected" : ""}`;
    chip.innerHTML = `<span class="dot"></span>${info.label}`;
    chip.title = connected ? `${info.hint}（接続済み）` : `${info.hint}（クリックして接続）`;
    if (!connected) chip.addEventListener("click", () => { window.location.href = `/auth/connect/${key}`; });
    container.appendChild(chip);
  }
}

// ── カレンダー ───────────────────────────────
async function loadCalendar() {
  const container = document.getElementById("calendar-events");
  container.innerHTML = '<div class="loading">読み込み中...</div>';

  const data = await fetch("/api/calendar/today").then((r) => r.json()).catch(() => null);

  if (!data) {
    container.innerHTML = '<div class="no-events">カレンダーを読み込めませんでした</div>';
    return;
  }

  if (!data.events || data.events.length === 0) {
    container.innerHTML = '<div class="no-events">今日の予定はありません</div>';
    return;
  }

  const list = document.createElement("div");
  list.className = "event-list";

  for (const ev of data.events) {
    const item = document.createElement("div");
    const accClass = ev.account;
    item.className = `event-item ${accClass} ${ev.allDay ? "allday" : ""}`;

    const timeStr = ev.allDay
      ? "終日"
      : `${fmtTime(ev.start)}〜${fmtTime(ev.end)}`;

    const tag = `<span class="event-tag ${accClass === "personal" ? "personal" : ""}">${ev.accountLabel}</span>`;
    const sub = [ev.calendarName, ev.location].filter(Boolean).join(" ｜ ");

    item.innerHTML = `
      <span class="event-time">${timeStr}</span>
      <div class="event-body">
        <div class="event-title">${esc(ev.title)}${tag}</div>
        ${sub ? `<div class="event-sub">${esc(sub)}</div>` : ""}
      </div>`;
    list.appendChild(item);
  }

  container.innerHTML = "";
  container.appendChild(list);
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

document.getElementById("refresh-cal").addEventListener("click", loadCalendar);

// ── チェックリスト ────────────────────────────
async function loadChecklist() {
  const data = await fetch("/api/checklist").then((r) => r.json());
  const ul = document.getElementById("checklist-items");
  const badge = document.getElementById("checklist-progress");
  ul.innerHTML = "";

  const done = data.items.filter((i) => i.checked).length;
  const total = data.items.length;
  badge.textContent = `${done} / ${total}`;
  badge.className = `badge ${done === total ? "done" : ""}`;

  for (const item of data.items) {
    const li = document.createElement("li");
    li.className = item.checked ? "checked" : "";
    li.dataset.id = item.id;
    li.innerHTML = `
      <span class="check-box"></span>
      <span class="check-emoji">${item.emoji}</span>
      <span class="check-label">${esc(item.label)}</span>`;
    li.addEventListener("click", () => toggleCheck(item.id, !item.checked));
    ul.appendChild(li);
  }
}

async function toggleCheck(id, checked) {
  await fetch(`/api/checklist/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checked }),
  });
  await loadChecklist();

  // 掛け率表アップロード完了でチェック
  if (id === "markup_dl" && checked) updateMarkupStatus();
}

// ── 掛け率表ドロップゾーン ────────────────────
const dropzone = document.getElementById("markup-dropzone");
const fileInput = document.getElementById("markup-file-input");

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, () => dropzone.classList.remove("drag-over"))
);
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) uploadMarkup(file);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) uploadMarkup(fileInput.files[0]);
});

async function uploadMarkup(file) {
  const status = document.getElementById("markup-status");
  status.textContent = "アップロード中...";
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch("/api/quote/upload-markup-rates", { method: "POST", body: fd })
    .then((r) => r.json()).catch(() => null);

  if (res?.ok) {
    dropzone.classList.add("success");
    status.textContent = "✅ 掛け率表を更新しました";
    // チェックリストの「掛け率表DL」をチェック
    await fetch("/api/checklist/markup_dl", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checked: true }),
    });
    await loadChecklist();
    await loadMarkupRates();
  } else {
    status.textContent = "❌ アップロードに失敗しました";
  }
}

async function updateMarkupStatus() {
  const data = await fetch("/api/quote/markup-rates-status").then((r) => r.json());
  const status = document.getElementById("markup-status");
  if (data.exists) {
    const mtime = new Date(data.mtime);
    status.textContent = `📊 最終更新: ${mtime.getMonth()+1}/${mtime.getDate()} ${fmtTime(data.mtime)}`;
  }
}

// ── 見積もり計算 ─────────────────────────────
const MAKER_PREFIXES = {
  "リンナイ":   ["RUF", "RUFH", "RBF", "RC-", "RDT", "RMS", "REW", "RMH", "RGB", "GCW", "RHF", "RUS"],
  "TOTO":      ["TK", "CS", "SW", "TCF", "CES", "EWB", "WB", "DB", "TCA", "TLS"],
  "LIXIL":     ["BF", "SF", "LF", "CF", "BB", "RN", "A-", "AM", "BC", "DT"],
  "ノーリツ":   ["GT", "GQ", "GRQ", "ORC"],
  "パナソニック": ["FY", "CH", "XCH", "DL-", "FV", "WY"],
};

document.getElementById("product-code").addEventListener("input", (e) => {
  const val = e.target.value.toUpperCase();
  const hint = document.getElementById("maker-hint");
  const maker = guessMaker(val);
  hint.textContent = maker ? `メーカー推定: ${maker}` : "";
});

function guessMaker(code) {
  const upper = code.toUpperCase();
  for (const [maker, prefixes] of Object.entries(MAKER_PREFIXES)) {
    if (prefixes.some((p) => upper.startsWith(p.toUpperCase()))) return maker;
  }
  return null;
}

document.getElementById("calc-btn").addEventListener("click", calculate);
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && document.getElementById("tab-quote").classList.contains("active")) calculate();
});

async function calculate() {
  const productCode = document.getElementById("product-code").value.trim();
  const listPrice   = parseFloat(document.getElementById("list-price").value);
  const errEl = document.getElementById("calc-error");
  errEl.style.display = "none";

  if (!productCode || !listPrice) {
    errEl.textContent = "型番と定価を入力してください";
    errEl.style.display = "block";
    return;
  }

  const res = await fetch("/api/quote/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productCode, listPrice }),
  }).then((r) => r.json());

  const resultEl = document.getElementById("calc-result");

  if (!res.ok) {
    resultEl.innerHTML = `
      <div class="result-maker">${esc(res.productCode)} ／ メーカー: ${esc(res.maker)}</div>
      <div class="error-msg">${esc(res.error || "計算できませんでした")}</div>`;
    return;
  }

  const pct = (r) => `${(r * 100).toFixed(1)}%`;
  const yen = (n) => `¥${n.toLocaleString()}`;

  resultEl.innerHTML = `
    <div class="result-maker">
      <strong>${esc(res.productCode)}</strong>
      ／ ${esc(res.maker)}${res.category ? ` ・ ${esc(res.category)}` : ""}
      ／ 定価 ${yen(res.listPrice)}
    </div>
    <div class="result-grid">
      <div class="result-cell purchase">
        <div class="rc-label">仕入れ掛け率</div>
        <div class="rc-rate">${pct(res.purchaseRate)}</div>
        <div class="rc-price">${yen(res.purchasePrice)}</div>
        <div class="rc-price-label">仕入れ価格</div>
      </div>
      <div class="result-cell display">
        <div class="rc-label">提示掛け率</div>
        <div class="rc-rate">${pct(res.displayRate)}</div>
        <div class="rc-price">${yen(res.displayPrice)}</div>
        <div class="rc-price-label">提示価格</div>
      </div>
    </div>
    ${res.note ? `<div class="result-note">📝 ${esc(res.note)}</div>` : ""}
    ${res.appliedFrom ? `<div class="result-note" style="margin-top:6px">適用開始: ${esc(res.appliedFrom)}</div>` : ""}`;
}

// ── 掛け率表プレビュー ───────────────────────
async function loadMarkupRates() {
  const wrap = document.getElementById("rates-table-wrap");
  const data = await fetch("/api/quote/markup-rates").then((r) => r.json());

  if (!data.ok) {
    wrap.innerHTML = `<p class="placeholder">${esc(data.error || "掛け率表が見つかりません")}<br><small>掛け率表フォルダに掛け率表.xlsxを配置してください</small></p>`;
    return;
  }

  if (!data.rates.length) {
    wrap.innerHTML = '<p class="placeholder">データがありません</p>';
    return;
  }

  const headers = ["メーカー", "品種カテゴリ", "仕入れ掛け率", "提示掛け率", "適用開始日", "備考"];
  const keys    = ["maker", "category", "purchaseRate", "displayRate", "appliedFrom", "note"];

  const rows = data.rates.map((r) =>
    `<tr>${keys.map((k) => {
      let v = r[k] ?? "";
      if (k === "purchaseRate" || k === "displayRate") v = v ? `${(v * 100).toFixed(1)}%` : "";
      return `<td>${esc(String(v))}</td>`;
    }).join("")}</tr>`
  ).join("");

  wrap.innerHTML = `
    <div class="table-scroll">
      <table class="rates-table">
        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

document.getElementById("reload-rates").addEventListener("click", loadMarkupRates);

// ── ユーティリティ ───────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── 初期化 ───────────────────────────────────
(async () => {
  await Promise.all([
    loadAccountStatus(),
    loadCalendar(),
    loadChecklist(),
  ]);
  await updateMarkupStatus();
})();
