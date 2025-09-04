const $ = (sel) => document.querySelector(sel);

// 🔒 Your Worker URL
const API_URL = "https://dispatch-api.julsyjuls.workers.dev";

// Track whether the custom modal is open (so we don't steal focus)
let modalOpen = false;

// ---------- State & helpers ----------
const state = {
  scans: [],                 // { barcode, ok, msg, sku_code }
  skuCounts: new Map(),      // key: sku_code, val: count
  skuItems: new Map(),       // key: sku_code, val: Set(barcodes)
  expandedSKUs: new Set(),   // which SKUs are expanded in the UI
  brandBySku: new Map(),     // brand per SKU (fallback)
  brandByBarcode: new Map(), // ✅ brand per barcode (supports mixed brands)
};

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
  // keep digits and preserve leading zeros; return as string
  return /^\d+$/.test(did || '') ? did : null;
}
let DISPATCH_ID = getDispatchIdFromURL();

// Custom confirm modal (falls back to window.confirm if modal HTML not present)
function confirmModal(htmlMessage, okText = 'Remove', cancelText = 'Cancel') {
  const overlay = $('#confirmOverlay');
  const titleEl = $('#confirmTitle');
  const msgEl   = $('#confirmMsg');
  const okBtn   = $('#confirmOk');
  const cancelBtn = $('#confirmCancel');

  // Fallback to native confirm if modal markup not present
  if (!overlay || !titleEl || !msgEl || !okBtn || !cancelBtn) {
    const plain = String(htmlMessage).replace(/<[^>]*>/g, '');
    return Promise.resolve(window.confirm(plain));
  }

  return new Promise((resolve) => {
    titleEl.textContent = 'Remove item?';
    msgEl.innerHTML = htmlMessage; // safe: we control content
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;

    overlay.hidden = false;
    modalOpen = true;

    const cleanup = (result) => {
      overlay.hidden = true;
      modalOpen = false;
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      resolve(result);
    };

    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
  });
}

// Show badge
(function showBadge() {
  const badge = $('#dispatchBadge');
  if (!badge) return;
  if (DISPATCH_ID) {
    badge.textContent = `Dispatch #${DISPATCH_ID}`;
  } else {
    badge.textContent = 'No dispatch selected — open this from Softr';
  }
  badge.style.display = 'inline-block';
})();

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
  if (!sku || !barcode) return;
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

function render() {
  // Recent scans (last 30)
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
        ` <button class="warn remove" data-barcode="${s.barcode}">Remove</button>`;
      list.appendChild(li);
    }
  }

  // Counts with expandable barcode lists
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

      // Compute brand label: if multiple brands under this SKU => "Mixed"
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

      // If expanded, render the child list of barcodes with their own Remove buttons
      if (state.expandedSKUs.has(sku)) {
        const ul = document.createElement('ul');
        ul.className = 'barcode-list';

        for (const code of Array.from(set).sort()) {
          const item = document.createElement('li');
          item.className = 'barcode-chip';

          const brand = state.brandByBarcode.get(code) ?? state.brandBySku.get(sku) ?? '';

          const codeSpan = document.createElement('span');
          codeSpan.className = 'chip-code';
          codeSpan.textContent = brand ? `${code} · ${brand}` : code;
          
          const rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'chip-remove';
          rm.textContent = 'Remove';
          rm.dataset.barcode = code;
          rm.dataset.sku = sku;
          
          item.style.display = "flex";
          item.style.justifyContent = "space-between";
          item.style.alignItems = "center";
          
          item.appendChild(codeSpan);
          item.appendChild(rm);

          ul.appendChild(item);
        }
        li.appendChild(ul);
      }

      counts.appendChild(li);
    }
  }
}

// ---------- Hydrate from server ----------
async function loadExisting() {
  if (!DISPATCH_ID) {
    setFeedback('Missing Dispatch ID. Open this page from a Dispatch.', false);
    return;
  }
  try {
    const res = await fetch(`${API_URL}/api/list?dispatch_id=${encodeURIComponent(DISPATCH_ID)}`);
    if (!res.ok) {
      setFeedback(`Couldn't load existing scans (HTTP ${res.status})`, false);
      return;
    }
    const data = await res.json();
    const rows = data.rows || [];

    // rebuild state
    state.scans = [];
    state.skuCounts.clear();
    state.skuItems.clear();
    // keep expandedSKUs as-is so the UI doesn't collapse on refresh
    state.brandBySku.clear();
    state.brandByBarcode.clear();

    for (const r of rows) {
      state.scans.push({ barcode: r.barcode, ok: true, msg: 'Reserved', sku_code: r.sku_code });
      bumpSkuCount(r.sku_code);
      addSkuItem(r.sku_code, r.barcode);

      // keep brand if backend returns it (brand_name / brand)
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

// ---------- Scan handler ----------
const scanInput = $('#scanInput');
if (scanInput) {
  scanInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
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
        $('#scanInput')?.focus();
        return;
      }

      const data = await res.json();
      const item = data.item || (Array.isArray(data.rows) ? data.rows[0] : null);
      const sku_code = item?.sku_code;
      const brand_name = item?.brand_name ?? item?.brand ?? null;

      if (data.ok && item?.was_inserted) {
        state.scans.push({ barcode, ok: true, msg: 'Reserved', sku_code });
        bumpSkuCount(sku_code);        // only on first insert
        addSkuItem(sku_code, barcode); // track barcode under its SKU
        if (brand_name) {
          state.brandBySku.set(sku_code, brand_name);
          state.brandByBarcode.set(barcode, brand_name);
        }
        setFeedback(`✅ ${barcode} reserved${sku_code ? ` · ${sku_code}` : ''}`);
      } else {
        const msg = data.msg || (item
          ? `Not eligible: ${item.inventory_status} (rank ${item.batch_rank})`
          : (data.code || 'Error'));
        state.scans.push({ barcode, ok: false, msg, sku_code });
        if (brand_name) {
          state.brandBySku.set(sku_code, brand_name);
          state.brandByBarcode.set(barcode, brand_name);
        }
        setFeedback(`❌ ${barcode}: ${msg}`, false);
      }
      render();
      $('#scanInput')?.focus(); // refocus after handling
    } catch (err) {
      const msg = String(err?.message || err);
      state.scans.push({ barcode, ok: false, msg });
      setFeedback(`❌ ${barcode}: ${msg}`, false);
      render();
      $('#scanInput')?.focus();
    }
  });
}

// ---------- Unscan (Remove) ----------
async function unscan(barcode) {
  if (!DISPATCH_ID) {
    setFeedback('Missing Dispatch ID.', false);
    return;
  }
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

    // Re-hydrate to ensure server state is the source of truth
    await loadExisting();
    $('#scanInput')?.focus();
  } catch (e) {
    setFeedback(`❌ ${barcode}: ${String(e.message || e)}`, false);
    $('#scanInput')?.focus();
  }
}

// Event delegation for Recent Scans list
const scanList = $('#scanList');
if (scanList) {
  scanList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button.remove');
    if (!btn) return;
    const code = btn.dataset.barcode;
    if (!code) return;

    const ok = await confirmModal(
      `Remove <strong class="code">${code}</strong> from Dispatch #${DISPATCH_ID}?`,
      'Remove',
      'Cancel'
    );
    if (!ok) { $('#scanInput')?.focus(); return; }

    await unscan(code);
    $('#scanInput')?.focus();
  });
}

// Toggle expand/collapse on counts panel + per-barcode remove
const countsEl = $('#skuCounts');
if (countsEl) {
  countsEl.addEventListener('click', async (e) => {
    // If clicking the remove button on a chip, don't toggle row
    const chipBtn = e.target.closest('button.chip-remove');
    if (chipBtn) {
      e.stopPropagation();
      const code = chipBtn.dataset.barcode;
      if (!code) return;
      const ok = await confirmModal(
        `Remove <strong class="code">${code}</strong> from Dispatch #${DISPATCH_ID}?`,
        'Remove',
        'Cancel'
      );
      if (!ok) { $('#scanInput')?.focus(); return; }
      await unscan(code);
      $('#scanInput')?.focus();
      return;
    }

    // Otherwise, toggle the SKU row expand/collapse
    const row = e.target.closest('.sku-row');
    if (!row) return;
    const sku = row.dataset.sku;
    if (!sku) return;

    if (state.expandedSKUs.has(sku)) {
      state.expandedSKUs.delete(sku);
    } else {
      state.expandedSKUs.add(sku);
    }
    render();
  });
}

// ---------- Focus & boot ----------
window.addEventListener('load', () => {
  $('#scanInput')?.focus();
  loadExisting();
});

// Click anywhere → focus the scanner input (pause when modal open)
document.addEventListener('click', (e) => {
  if (modalOpen) return; // don't steal focus from modal
  if (e.target?.id !== 'scanInput') $('#scanInput')?.focus();
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
  // Sort nicely for Excel
  out.sort((a, b) => a.sku_code.localeCompare(b.sku_code) || (a.barcode ?? "").localeCompare(b.barcode ?? ""));
  return out;
}

function buildSummaryFromState() {
  // Count by composite key (sku|brand) so mixed brands split rows
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
  // Local stamp like 2025-09-04_1530
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// Auto-fit-ish column widths based on content length
function autosizeColumnsFromJSON(rows, headerOrder) {
  const headers = headerOrder && headerOrder.length ? headerOrder : (rows[0] ? Object.keys(rows[0]) : []);
  const colWidths = headers.map(h => Math.max((h?.length || 0), 4)); // min width
  for (const r of rows) {
    headers.forEach((h, i) => {
      const val = r[h] ?? "";
      const len = String(val).length;
      if (len > colWidths[i]) colWidths[i] = len;
    });
  }
  // Make it a bit roomier
  return colWidths.map(ch => ({ wch: Math.min(Math.max(ch + 2, 8), 40) }));
}

function addAutoFilter(ws, headerOrder) {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  // Add filter on full header row
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: range.e.r, c: range.e.c } }) };
}

function appendTotalsRow(ws, label, countColLetter) {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const nextRowNumber = range.e.r + 2; // 1-based index of the next empty row

  // Write: [ "Total", null, =SUM(C2:C{lastDataRow}) ]
  const lastDataRow = nextRowNumber - 1;
  const sumFormula = `SUM(${countColLetter}2:${countColLetter}${lastDataRow})`;
  XLSX.utils.sheet_add_aoa(ws, [
    [label, null, { f: sumFormula }]
  ], { origin: `A${nextRowNumber}` });

  // Expand sheet range to include the new totals row
  const newRange = { s: range.s, e: { r: nextRowNumber - 1, c: range.e.c } };
  ws['!ref'] = XLSX.utils.encode_range(newRange);
}

// ===== XLSX Export (Summary + Details) =====
function exportXlsx() {
  if (typeof XLSX === "undefined") {
    alert("XLSX library not loaded. Include the SheetJS script tag.");
    return;
  }

  const summary = buildSummaryFromState();
  const details = buildDetailsFromState();

  // Build workbook
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryHeaders = ["sku_code", "brand_name", "count"];
  const wsSummary = XLSX.utils.json_to_sheet(summary, { header: summaryHeaders });
  wsSummary['!cols'] = autosizeColumnsFromJSON(summary, summaryHeaders);
  addAutoFilter(wsSummary, summaryHeaders);
  // Totals row (puts "Total" at col A and SUM in column C)
  appendTotalsRow(wsSummary, "Total", "C");
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  // Details sheet
  const detailHeaders = ["sku_code", "barcode", "brand_name"];
  const wsDetails = XLSX.utils.json_to_sheet(details, { header: detailHeaders });
  wsDetails['!cols'] = autosizeColumnsFromJSON(details, detailHeaders);
  addAutoFilter(wsDetails, detailHeaders);
  XLSX.utils.book_append_sheet(wb, wsDetails, "Details");

  // Done!
  XLSX.writeFile(wb, `dispatch_export_${dateStamp()}.xlsx`);
}

// Wire the button
document.getElementById("btnExportXlsx")?.addEventListener("click", exportXlsx);
