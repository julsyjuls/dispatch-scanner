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

      const label = document.createElement('span');
      label.className = 'sku-label';
      label.textContent = `${sku}: ${n}`;

      li.appendChild(toggle);
      li.appendChild(label);

      // If expanded, render the child list of barcodes with their own Remove buttons
      if (state.expandedSKUs.has(sku)) {
        const ul = document.createElement('ul');
        ul.className = 'barcode-list';

        const set = state.skuItems.get(sku) || new Set();
        for (const code of Array.from(set).sort()) {
          const item = document.createElement('li');
          item.className = 'barcode-chip';

          const codeSpan = document.createElement('span');
          codeSpan.className = 'chip-code';
          codeSpan.textContent = code;

          const rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'chip-remove';
          rm.textContent = 'Remove';
          rm.dataset.barcode = code;
          rm.dataset.sku = sku;

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

    for (const r of rows) {
      state.scans.push({ barcode: r.barcode, ok: true, msg: 'Reserved', sku_code: r.sku_code });
      bumpSkuCount(r.sku_code);
      addSkuItem(r.sku_code, r.barcode);
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

      if (data.ok && item?.was_inserted) {
        state.scans.push({ barcode, ok: true, msg: 'Reserved', sku_code });
        bumpSkuCount(sku_code);        // only on first insert
        addSkuItem(sku_code, barcode); // track barcode under its SKU
        setFeedback(`✅ ${barcode} reserved${sku_code ? ` · ${sku_code}` : ''}`);
      } else {
        const msg = data.msg || (item
          ? `Not eligible: ${item.inventory_status} (rank ${item.batch_rank})`
          : (data.code || 'Error'));
        state.scans.push({ barcode, ok: false, msg, sku_code });
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
