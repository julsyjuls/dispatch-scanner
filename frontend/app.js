const $ = (sel) => document.querySelector(sel);

// 🔒 Hardcode your Worker URL
const API_URL = "https://dispatch-api.julsyjuls.workers.dev";

// --- simple state + helpers ---
const state = {
  scans: [],                 // { barcode, ok, msg, sku_code }
  skuCounts: new Map(),      // key: sku_code, value: count
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
  // accept digits-only, but KEEP leading zeros (return as string)
  return /^\d+$/.test(did || '') ? did : null;
}
let DISPATCH_ID = getDispatchIdFromURL();


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

function render() {
  // Recent scans (last 30)
  const list = $('#scanList');
  list.innerHTML = '';
  for (let i = state.scans.length - 1; i >= Math.max(0, state.scans.length - 30); i--) {
    const s = state.scans[i];
    const li = document.createElement('li');
    li.innerHTML = `${s.ok ? '✅' : '❌'} <strong>${s.barcode}</strong>` +
      (s.sku_code ? ` · ${s.sku_code}` : '') +
      (s.msg ? ` · ${s.msg}` : '');
    list.appendChild(li);
  }

  // Counts by SKU
  const counts = $('#skuCounts');
  counts.innerHTML = '';
  for (const [sku, n] of state.skuCounts.entries()) {
    const li = document.createElement('li');
    li.textContent = `SKU ${sku}: ${n}`;
    counts.appendChild(li);
  }
}

function bumpSkuCount(key) {
  if (!key) return;
  const n = state.skuCounts.get(key) || 0;
  state.skuCounts.set(key, n + 1);
}

// Scan → Reserve
$('#scanInput').addEventListener('keydown', async (e) => {
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
    return;
  }

  const data = await res.json();
  const item = data.item || (Array.isArray(data.rows) ? data.rows[0] : null);
  const sku_code = item?.sku_code;

  if (data.ok && item?.was_inserted) {
    state.scans.push({ barcode, ok: true, msg: 'Reserved', sku_code });
    bumpSkuCount(sku_code);             // ✅ only on first insert
    setFeedback(`✅ ${barcode} reserved${sku_code ? ` · ${sku_code}` : ''}`);
  } else {
    const msg = data.msg || (item
      ? `Not eligible: ${item.inventory_status} (rank ${item.batch_rank})`
      : (data.code || 'Error'));
    state.scans.push({ barcode, ok: false, msg, sku_code });
    setFeedback(`❌ ${barcode}: ${msg}`, false);
  }
  render();
} catch (err) {
  const msg = String(err?.message || err);
  state.scans.push({ barcode, ok: false, msg });
  setFeedback(`❌ ${barcode}: ${msg}`, false);
  render();
}

});

// autofocus for scanners
window.addEventListener('load', () => $('#scanInput')?.focus());
