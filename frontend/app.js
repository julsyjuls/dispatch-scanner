const $ = (sel) => document.querySelector(sel);

// 🔒 Hardcode your Worker URL
const API_URL = "https://dispatch-api.julsyjuls.workers.dev";

// Get dispatch_id from URL only
function getDispatchIdFromURL() {
  const params = new URLSearchParams(location.search);
  const did = params.get('dispatch_id');
  const n = Number(did || 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}
let DISPATCH_ID = getDispatchIdFromURL();

// Show badge
(function showBadge() {
  const badge = $('#dispatchBadge');
  if (!badge) return;
  if (DISPATCH_ID) {
    badge.textContent = `Dispatch #${DISPATCH_ID}`;
    badge.style.display = 'inline-block';
  } else {
    badge.textContent = 'No dispatch selected — open this from Softr';
    badge.style.display = 'inline-block';
  }
})();

// Render helpers (reuse your existing state object)
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

// Scan → Reserve
$('#scanInput').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const barcode = e.target.value.trim();
  e.target.value = '';

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
    const data = await res.json();

    if (data.ok) {
      state.scans.push({ barcode, ok: true, msg: 'Reserved', sku_id: data.sku_id, inventory_id: data.inventory_id });
      bumpSkuCount(data.sku_id);
      setFeedback(`✅ ${barcode} reserved`);
    } else {
      state.scans.push({ barcode, ok: false, msg: data.msg || data.code || 'Error' });
      setFeedback(`❌ ${barcode}: ${data.msg || data.code}`, false);
    }
    render();
  } catch (e) {
    state.scans.push({ barcode, ok: false, msg: String(e.message || e) });
    setFeedback(`❌ ${barcode}: ${String(e.message || e)}`, false);
    render();
  }
});

// autofocus for scanners
window.addEventListener('load', () => $('#scanInput').focus());
