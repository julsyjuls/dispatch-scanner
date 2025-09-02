const $ = (sel) => document.querySelector(sel);

// 🔒 Hardcode your Worker URL
const API_URL = "https://dispatch-api.julsyjuls.workers.dev";

// --- get dispatch_id from URL only ---
function getDispatchIdFromURL() {
  const params = new URLSearchParams(location.search);
  const did = params.get('dispatch_id');
  const n = Number(did || 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

let DISPATCH_ID = getDispatchIdFromURL();

// Optional: show a badge like “Dispatch #1234”
(function showBadge() {
  const badge = $('#dispatchBadge');
  if (!badge) return;
  if (DISPATCH_ID) {
    badge.textContent = `Dispatch #${DISPATCH_ID}`;
    badge.style.display = 'inline-block';
  } else {
    badge.textContent = 'No dispatch selected';
    badge.style.display = 'inline-block';
  }
})();

// Disable UI if opened without a dispatch_id
(function guardOpenWithoutId() {
  const scan = $('#scanInput');
  const finalize = $('#finalizeBtn');
  if (!DISPATCH_ID) {
    if (scan) {
      scan.disabled = true;
      scan.placeholder = 'Open from Softr dispatch details (missing ?dispatch_id=...)';
    }
    if (finalize) finalize.disabled = true;
    if (typeof setFeedback === 'function') {
      setFeedback('Missing Dispatch ID. Open this page via Softr dispatch details.', false);
    }
  }
})();

// ------------ render + counts (your existing state helpers) ------------
function render() {
  const list = $('#scanList');
  list.innerHTML = '';
  for (let i = state.scans.length - 1; i >= Math.max(0, state.scans.length - 30); i--) {
    const s = state.scans[i];
    const li = document.createElement('li');
    li.innerHTML = `${s.ok ? '✅' : '❌'} <strong>${s.barcode}</strong> · ${s.msg}`;
    list.appendChild(li);
  }

  const counts = $('#skuCounts');
  counts.innerHTML = '';
  for (const [sku, n] of state.skuCounts.entries()) {
    const li = document.createElement('li');
    li.textContent = `SKU ${sku}: ${n}`;
    counts.appendChild(li);
  }
}

function bumpSkuCount(sku_id) {
  if (sku_id == null) return;
  const n = state.skuCounts.get(sku_id) || 0;
  state.skuCounts.set(sku_id, n + 1);
}

// ------------ Finalize (backend reads date from header in Softr) ------------
$('#finalizeBtn').addEventListener('click', async () => {
  if (!DISPATCH_ID) {
    setFeedback('Missing Dispatch ID. Open from Softr dispatch details.', false);
    return;
  }
  try {
    const res = await fetch(`${API_URL}/api/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dispatch_id: DISPATCH_ID }) // no date here
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.msg || data.error || 'Finalize failed');
    setFeedback(`Finalized. Updated ${data.updated} item(s).`);
  } catch (e) {
    setFeedback(String(e.message || e), false);
  }
});

// ------------ Scan → Reserve ------------
$('#scanInput').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const barcode = e.target.value.trim();
  e.target.value = '';

  if (!DISPATCH_ID) {
    setFeedback('Missing Dispatch ID. Open from Softr dispatch details.', false);
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': '
