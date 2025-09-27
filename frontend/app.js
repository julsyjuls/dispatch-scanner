// app.js — focus-safe scanner + modal + password (HTML/CSS untouched)
const $ = (sel) => document.querySelector(sel);

// 🔒 Your Worker URL
const API_URL = "https://dispatch-api.julsyjuls.workers.dev";

// 🔐 Page password protection
const PAGE_PASSWORD = "KAPS1"; // 👈 change anytime

// Gates
let authOpen = true;   // 🔴 start locked: no scan, no autofocus
let modalOpen = false; // custom confirm modal state

// Grab key elements once
const scanInput = $('#scanInput');
const authOverlay = $('#auth-overlay');

// Remove any stray autofocus and hard-disable the scanner until unlock
if (scanInput) {
  scanInput.removeAttribute?.('autofocus');
  scanInput.disabled = true;
}

// If a stray modal was left visible, hide it on boot
const confirmOverlay = $('#confirmOverlay');
if (confirmOverlay && !confirmOverlay.hasAttribute('hidden')) {
  confirmOverlay.hidden = true;
}

// ---------- Small helpers ----------
function pauseScanner() {
  if (!scanInput) return;
  scanInput.blur();
  scanInput.disabled = true;
}

function resumeScanner() {
  if (!scanInput) return;
  // respect read-only; we’ll set state.readOnly elsewhere
  scanInput.disabled = state.readOnly || authOpen || modalOpen;
  if (!scanInput.disabled) setTimeout(() => scanInput.focus(), 30);
}

function setFeedback(msg, success = true) {
  const el = $('#feedback');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('success', !!success);
  el.classList.toggle('error', !success);
}

function getDispatchIdFromURL() {
  const params = new URLSearchParams(location.search);
  const did = params.get('dispatch_id');
  return /^\d+$/.test(did || '') ? did : null;
}
let DISPATCH_ID = getDispatchIdFromURL();

// ---------- Password flow (blocks background focus) ----------
function ensurePagePassword() {
  return new Promise((resolve) => {
    const overlay = authOverlay;
    const input   = $('#auth-password');
    const submit  = $('#auth-submit');
    const errorEl = $('#auth-error');

    // Keep focus inside the password box
    if (document.activeElement) document.activeElement.blur();
    setTimeout(() => input?.focus(), 0);

    function tryUnlock() {
      const val = (input.value || "").trim();
      if (val === PAGE_PASSWORD) {
        authOpen = false;          // 🟢 unlock
        overlay?.remove();         // remove overlay
        resumeScanner();           // enable scanner now
        resolve(true);
      } else {
        errorEl.textContent = "❌ Incorrect password. Please try again.";
        input.value = "";
        input.focus();
      }
    }

    submit?.addEventListener("click", tryUnlock);
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
  });
}

// ---------- State ----------
const state = {
  scans: [],                 // { barcode, ok, msg, sku_code }
  skuCounts: new Map(),
  skuItems: new Map(),
  expandedSKUs: new Set(),
  brandBySku: new Map(),
  brandByBarcode: new Map(),
  readOnly: false,
};

// ---------- Read-only UI helpers ----------
async function loadMeta() {
  if (!DISPATCH_ID) return;
  try {
    const r = await fetch(`${API_URL}/api/dispatch/${encodeURIComponent(DISPATCH_ID)}/meta`);
    const j = await r.json();
    const status = (j?.status || '').toLowerCase();
    state.readOnly = (status !== 'open');
    applyReadOnlyUI(status);
  } catch {
    state.readOnly = false;
    applyReadOnlyUI(null);
  } finally {
    resumeScanner(); // ensure disabled/enabled state aligns with readOnly+authOpen+modalOpen
  }
}

function applyReadOnlyUI(statusLower) {
  if (scanInput) {
    scanInput.disabled = state.readOnly || authOpen || modalOpen;
    scanInput.placeholder = state.readOnly ? 'Read-only (Dispatched)' : 'Scan or enter barcode.';
  }
  const badge = $('#dispatchBadge');
  if (badge) {
    const suffix = state.readOnly
      ? (statusLower ? ` · ${statusLower.charAt(0).toUpperCase()}${statusLower.slice(1)}` : ' · Dispatched')
      : '';
    badge.textContent = DISPATCH_ID ? `Dispatch #${DISPATCH_ID}${suffix}` : 'No dispatch selected — open this from Softr';
    badge.style.display = 'inline-block';
  }
}

// Show badge immediately
(() => {
  const badge = $('#dispatchBadge');
  if (!badge) return;
  badge.textContent = DISPATCH_ID ? `Dispatch #${DISPATCH_ID}` : 'No dispatch selected — open this from Softr';
  badge.style.display = 'inline-block';
})();

// ---------- Rendering helpers ----------
function bumpSkuCount(key) {
  if (!key) return;
  const n = state.skuCounts.get(key) || 0;
  state.skuCounts.set(key, n + 1);
}
function addSkuItem(sku, barcode) {
  if (!sku || !barcode) return;
  if (!state.skuItems.has(sku)) state.skuItems.set(sku, new Set());
  state.skuItems.get(sku).add(barcode);
}
function removeSkuItem(sku, barcode) {
  const set = state.skuItems.get(sku);
  if (!set) return;
  set.delete(barcode);
  if (set.size === 0) {
    state.skuItems.delete(sku);
    state.skuCounts.delete(sku);
    state.expandedSKUs.delete(sku);
    state.brandBySku.delete(sku);
  } else {
    state.skuCounts.set(sku, set.size);
  }
}

function computeTotalItems() {
  let total = 0;
  for (const n of state.skuCounts.values()) total += Number(n) || 0;
  return total;
}
function updateSummaryTotalUI() {
  const el = $('#summaryTotal');
  if (!el) return;
  const total = computeTotalItems();
  el.textContent = total;
  el.title = `${total} items scanned`;
  el.style.display = total > 0 ? 'inline-flex' : 'none';
}

function render() {
  const list = $('#scanList');
  if (list) {
    list.innerHTML = '';
    for (let i = state.scans.length - 1; i >= Math.max(0, state.scans.length - 30); i--) {
      const s = state.scans[i];
      const li = document.createElement('li');
      li.innerHTML =
        `${s.ok ? '✅' : '❌'} <strong>${s.barcode}</strong>` +
        (s.sku_code ? ` · ${s.sku_code}` : '') +
        (s.msg ? ` · ${s.msg}` : '') +
        (state.readOnly ? '' : ` <button class="warn remove" data-barcode="${s.barcode}">Remove</button>`);
      list.appendChild(li);
    }
  }

  const counts = $('#skuCounts');
  if (counts) {
    counts.innerHTML = '';
    const entries = Array.from(state.skuCounts.entries()).sort(([a], [b]) => a.localeCompare(b));
    for (const [sku, n] of entries) {
      const li = document.createElement('li');
      li.className = 'sku-row';
      li.dataset.sku = sku;

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'toggle';
      toggle.textContent = state.expandedSKUs.has(sku) ? '▼' : '▶';

      const set = state.skuItems.get(sku) || new Set();
      const brandSet = new Set();
      for (const code of set) {
        const b = state.brandByBarcode.get(code) ?? state.brandBySku.get(sku) ?? '';
        if (b) brandSet.add(b);
      }
      const brandLabel = brandSet.size > 1 ? 'Mixed' : (brandSet.values().next().value || '');

      const label = document.createElement('span');
      label.className = 'sku-label';
      label.innerHTML = `${sku} ${brandLabel ? `· <em>${brandLabel}</em>` : ''} <span class="sku-badge">${n}</span>`;

      li.appendChild(toggle);
      li.appendChild(label);

      if (state.expandedSKUs.has(sku)) {
        const ul = document.createElement('ul');
        ul.className = 'barcode-list';
        ul.style.display = 'flex';
        ul.style.flexDirection = 'column';
        ul.style.gap = '8px';

        for (const code of Array.from(set).sort()) {
          const item = document.createElement('li');
          item.className = 'barcode-chip';
          item.style.display = 'flex';
          item.style.alignItems = 'center';
          item.style.gap = '8px';

          const brand = state.brandByBarcode.get(code) ?? state.brandBySku.get(sku) ?? '';
          const codeSpan = document.createElement('span');
          codeSpan.className = 'chip-code';
          codeSpan.textContent = brand ? `${code} · ${brand}` : code;

          item.appendChild(codeSpan);

          if (!state.readOnly) {
            const rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'chip-remove';
            rm.textContent = 'Remove';
            rm.dataset.barcode = code;
            rm.dataset.sku = sku;
            item.appendChild(rm);
          }

          ul.appendChild(item);
        }
        li.appendChild(ul);
      }

      counts.appendChild(li);
    }
  }
  updateSummaryTotalUI();
}

// ---------- Data hydration ----------
async function loadExisting() {
  if (!DISPATCH_ID) { setFeedback('Missing Dispatch ID. Open this page from a Dispatch.', false); return; }
  try {
    const res = await fetch(`${API_URL}/api/list?dispatch_id=${encodeURIComponent(DISPATCH_ID)}`);
    if (!res.ok) { setFeedback(`Couldn't load existing scans (HTTP ${res.status})`, false); return; }
    const data = await res.json();
    const rows = data.rows || [];

    state.scans = [];
    state.skuCounts.clear();
    state.skuItems.clear();
    state.brandBySku.clear();
    state.brandByBarcode.clear();

    for (const r of rows) {
      state.scans.push({ barcode: r.barcode, ok: true, msg: 'Reserved', sku_code: r.sku_code });
      bumpSkuCount(r.sku_code);
      addSkuItem(r.sku_code, r.barcode);
      const brand = r.brand_name ?? r.brand ?? null;
      if (brand) {
        state.brandBySku.set(r.sku_code, brand);
        state.brandByBarcode.set(r.barcode, brand);
      }
    }
    render();
  } catch (e) {
    setFeedback(`Load failed: ${String(e.message || e)}`, false);
  }
}

async function loadItemsFromView() {
  if (!DISPATCH_ID) { setFeedback('Missing Dispatch ID. Open this page from a Dispatch.', false); return; }
  try {
    const res = await fetch(`${API_URL}/api/dispatch/${encodeURIComponent(DISPATCH_ID)}/items`);
    if (!res.ok) { setFeedback(`Couldn't load items (HTTP ${res.status})`, false); return; }
    const data = await res.json();
    const rows = data.items || [];

    state.scans = [];
    state.skuCounts.clear();
    state.skuItems.clear();
    state.brandBySku.clear();
    state.brandByBarcode.clear();

    for (const r of rows) {
      const barcode = r.barcode;
      const sku = r.sku_code || '';
      const brand = r.brand_name || null;

      state.scans.push({ barcode, ok: true, msg: 'Reserved', sku_code: sku });
      bumpSkuCount(sku);
      addSkuItem(sku, barcode);

      if (brand) {
        state.brandBySku.set(sku, brand);
        state.brandByBarcode.set(barcode, brand);
      }
    }
    render();
  } catch (e) {
    setFeedback(`Load failed: ${String(e.message || e)}`, false);
  }
}

// ---------- Confirm modal (focus-safe) ----------
function confirmModal(htmlMessage, okText = 'Remove', cancelText = 'Cancel') {
  const overlay = $('#confirmOverlay');
  const dialog  = overlay?.querySelector('.modal');
  const titleEl = $('#confirmTitle');
  const msgEl   = $('#confirmMsg');
  const okBtn   = $('#confirmOk');
  const cancelBtn = $('#confirmCancel');

  // Fallback to native confirm if markup missing
  if (!overlay || !titleEl || !msgEl || !okBtn || !cancelBtn || !dialog) {
    const plain = String(htmlMessage).replace(/<[^>]*>/g, '');
    return Promise.resolve(window.confirm(plain));
  }

  return new Promise((resolve) => {
    titleEl.textContent = 'Remove item?';
    msgEl.innerHTML = htmlMessage;
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;

    overlay.hidden = false;
    modalOpen = true;
    pauseScanner();

    setTimeout(() => cancelBtn.focus(), 10);

    const onKeyDown = (e) => {
      if (!modalOpen) return;
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
      else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
    };

    const onOverlayClick = (e) => { if (e.target === overlay) cleanup(false); };

    function cleanup(result) {
      overlay.hidden = true;
      modalOpen = false;
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.removeEventListener('click', onOverlayClick, true);
      resumeScanner();
      resolve(result);
    }

    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);

    document.addEventListener('keydown', onKeyDown, true);
    overlay.addEventListener('click', onOverlayClick, true);
    dialog.setAttribute('tabindex', '-1');
  });
}

// ---------- Scan handler ----------
if (scanInput) {
  scanInput.addEventListener('keydown', async (e) => {
    if (authOpen || modalOpen) return; // ⛔️ block while password/modal showing
    if (e.key !== 'Enter') return;

    if (state.readOnly) {
      setFeedback('This dispatch is read-only.', false);
      scanInput.value = '';
      scanInput.focus();
      return;
    }

    const barcode = e.target.value.trim();
    e.target.value = '';
    if (!barcode) return;

    if (!DISPATCH_ID) {
      setFeedback('Missing Dispatch ID. Open this page via Softr dispatch details.', false);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dispatch_id: DISPATCH_ID, barcode })
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        state.scans.push({ barcode, ok: false, msg: `HTTP ${res.status} ${text}` });
        setFeedback(`❌ ${barcode}: HTTP ${res.status}`, false);
        render();
        scanInput.focus();
        return;
      }

      const data = await res.json();
      const item = data.item || (Array.isArray(data.rows) ? data.rows[0] : null);
      const sku_code = item?.sku_code;
      const brand_name = item?.brand_name ?? item?.brand ?? null;

      if (data.ok && item?.was_inserted) {
        state.scans.push({ barcode, ok: true, msg: 'Reserved', sku_code });
        bumpSkuCount(sku_code);
        addSkuItem(sku_code, barcode);
        if (brand_name) {
          state.brandBySku.set(sku_code, brand_name);
          state.brandByBarcode.set(barcode, brand_name);
        }
        setFeedback(`✅ ${barcode} reserved${sku_code ? ` · ${sku_code}` : ''}`);
      } else {
        const msg = data.msg || (item ? `Not eligible: ${item.inventory_status} (rank ${item.batch_rank})` : (data.code || 'Error'));
        state.scans.push({ barcode, ok: false, msg, sku_code });
        if (brand_name) {
          state.brandBySku.set(sku_code, brand_name);
          state.brandByBarcode.set(barcode, brand_name);
        }
        setFeedback(`❌ ${barcode}: ${msg}`, false);
      }
      render();
      scanInput.focus();
    } catch (err) {
      const msg = String(err?.message || err);
      state.scans.push({ barcode, ok: false, msg });
      setFeedback(`❌ ${barcode}: ${msg}`, false);
      render();
      scanInput.focus();
    }
  });
}

// ---------- Unscan (Remove) ----------
async function unscan(barcode) {
  if (state.readOnly) { setFeedback('This dispatch is read-only.', false); return; }
  if (!DISPATCH_ID) { setFeedback('Missing Dispatch ID.', false); return; }
  try {
    const res = await fetch(`${API_URL}/api/unscan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dispatch_id: DISPATCH_ID, barcode })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setFeedback(`❌ ${barcode}: ${data.msg || 'Unscan failed'}`, false);
      return;
    }
    setFeedback(`↩️ ${barcode}: ${data.msg}`, true);

    await loadItemsFromView();
    scanInput?.focus();
  } catch (e) {
    setFeedback(`❌ ${barcode}: ${String(e.message || e)}`, false);
    scanInput?.focus();
  }
}

// Event delegation for Recent Scans list
const scanList = $('#scanList');
if (scanList) {
  scanList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button.remove');
    if (!btn) return;

    if (state.readOnly) { setFeedback('This dispatch is read-only.', false); return; }

    const code = btn.dataset.barcode;
    if (!code) return;

    const ok = await confirmModal(
      `Remove <strong class="code">${code}</strong> from Dispatch #${DISPATCH_ID}?`,
      'Remove',
      'Cancel'
    );
    if (!ok) { scanInput?.focus(); return; }

    await unscan(code);
    scanInput?.focus();
  });
}

// Toggle expand/collapse + per-barcode remove
const countsEl = $('#skuCounts');
if (countsEl) {
  countsEl.addEventListener('click', async (e) => {
    const chipBtn = e.target.closest('button.chip-remove');
    if (chipBtn) {
      e.stopPropagation();
      if (state.readOnly) { setFeedback('This dispatch is read-only.', false); return; }

      const code = chipBtn.dataset.barcode;
      if (!code) return;
      const ok = await confirmModal(
        `Remove <strong class="code">${code}</strong> from Dispatch #${DISPATCH_ID}?`,
        'Remove',
        'Cancel'
      );
      if (!ok) { scanInput?.focus(); return; }
      await unscan(code);
      scanInput?.focus();
      return;
    }

    const row = e.target.closest('.sku-row');
    if (!row) return;
    const sku = row.dataset.sku;
    if (!sku) return;

    if (state.expandedSKUs.has(sku)) state.expandedSKUs.delete(sku);
    else state.expandedSKUs.add(sku);
    render();
  });
}

// ---------- Boot ----------
window.addEventListener('load', async () => {
  // Wait for password before running the app
  await ensurePagePassword();

  // Now we can safely enable scanner (loadMeta may still set readOnly=true)
  await loadMeta();
  await loadItemsFromView();

  // if unlocked and not read-only, focus it just once
  resumeScanner();
});

// Global click-to-refocus: disabled while password/modal are open
document.addEventListener('click', (e) => {
  if (authOpen || modalOpen) return;
  const t = e.target;
  // ignore interactive elements and clicks inside modal overlay
  if (t.closest('#confirmOverlay') ||
      ['INPUT', 'BUTTON', 'A', 'SELECT', 'TEXTAREA', 'LABEL'].includes(t.tagName)) return;
  scanInput?.focus();
});

// ---------- XLSX Export Helpers ----------
function buildDetailsFromState() {
  const out = [];
  for (const [sku, set] of state.skuItems.entries()) {
    for (const code of set) {
      const brand = state.brandByBarcode.get(code) ?? state.brandBySku.get(sku) ?? "";
      out.push({ sku_code: sku, barcode: code, brand_name: brand });
    }
  }
  out.sort((a, b) => a.sku_code.localeCompare(b.sku_code) || (a.barcode ?? "").localeCompare(b.barcode ?? ""));
  return out;
}

function buildSummaryFromState() {
  const byKey = new Map();
  for (const [sku, set] of state.skuItems.entries()) {
    for (const code of set) {
      const brand = state.brandByBarcode.get(code) ?? state.brandBySku.get(sku) ?? "";
      const key = `${sku}||${brand}`;
      byKey.set(key, (byKey.get(key) || 0) + 1);
    }
  }
  const rows = [];
  for (const [key, count] of byKey.entries()) {
    const [sku, brand] = key.split("||");
    rows.push({ sku_code: sku, brand_name: brand, count });
  }
  rows.sort((a, b) =>
    a.sku_code.localeCompare(b.sku_code) ||
    (a.brand_name ?? "").localeCompare(b.brand_name ?? "")
  );
  return rows;
}

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function autosizeColumnsFromJSON(rows, headerOrder) {
  const headers = headerOrder && headerOrder.length ? headerOrder : (rows[0] ? Object.keys(rows[0]) : []);
  const colWidths = headers.map(h => Math.max((h?.length || 0), 4));
  for (const r of rows) {
    headers.forEach((h, i) => {
      const val = r[h] ?? "";
      const len = String(val).length;
      if (len > colWidths[i]) colWidths[i] = len;
    });
  }
  return colWidths.map(ch => ({ wch: Math.min(Math.max(ch + 2, 8), 40) }));
}

function addAutoFilter(ws) {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: range.e.r, c: range.e.c } }) };
}

function appendTotalsRow(ws, label, countColLetter, totalValue) {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const nextRowNumber = range.e.r + 2;
  const sumFormula = `SUM(${countColLetter}2:${countColLetter}${nextRowNumber - 1})`;
  XLSX.utils.sheet_add_aoa(ws, [
    [label, null, { t: 'n', v: Number(totalValue) || 0, f: sumFormula }]
  ], { origin: `A${nextRowNumber}` });
  const newRange = { s: range.s, e: { r: nextRowNumber - 1, c: range.e.c } };
  ws['!ref'] = XLSX.utils.encode_range(newRange);
}

function exportXlsx() {
  if (typeof XLSX === "undefined") { alert("XLSX library not loaded. Include the SheetJS script tag."); return; }

  const summary = buildSummaryFromState();
  const details = buildDetailsFromState();

  const wb = XLSX.utils.book_new();

  const summaryHeaders = ["sku_code", "brand_name", "count"];
  const wsSummary = XLSX.utils.json_to_sheet(summary, { header: summaryHeaders });
  wsSummary['!cols'] = autosizeColumnsFromJSON(summary, summaryHeaders);
  addAutoFilter(wsSummary);

  const totalCount = summary.reduce((s, r) => s + Number(r.count || 0), 0);
  appendTotalsRow(wsSummary, "Total", "C", totalCount);

  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.CalcPr = { fullCalcOnLoad: true };

  const detailHeaders = ["sku_code", "barcode", "brand_name"];
  const wsDetails = XLSX.utils.json_to_sheet(details, { header: detailHeaders });
  wsDetails['!cols'] = autosizeColumnsFromJSON(details, detailHeaders);
  addAutoFilter(wsDetails);
  XLSX.utils.book_append_sheet(wb, wsDetails, "Details");

  XLSX.writeFile(wb, `dispatch_export_${dateStamp()}.xlsx`);
}

document.getElementById("btnExportXlsx")?.addEventListener("click", exportXlsx);
