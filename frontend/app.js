const $ = (sel) => document.querySelector(sel);

// 🔒 Your Worker URL
const API_URL = "https://dispatch-api.julsyjuls.workers.dev";

// Track whether the custom modal is open (so we don't steal focus)
let modalOpen = false;

// ---------- State & helpers ----------
const state = {
  scans: [],            // { barcode, ok, msg, sku_code }
  skuCounts: new Map(), // key: sku_code, val: count
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
    msgEl.innerHTML = htmlMessage;         // safe: we control content
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

  // Counts
  const counts = $('#skuCounts');
  if (counts) {
    counts.innerHTML = '';
    for (const [sku, n] of state.skuCounts.entries()) {
      const li = document.createElement('li');
      li.textContent = `${sku}: ${n}`;
      counts.appendChild(li);
    }
  }
}

function bumpSkuCount(key) {
  if (!key) return;
  const n = state.skuCounts.get(key) || 0;
  state.skuCounts.set(key, n + 1);
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
    for (const r of rows) {
      state.scans.push({ barcode: r.barcode, ok: true, msg: 'Reserved', sku_code: r.sku_code });
      bumpSkuCount(r.sku_code);
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
        bumpSkuCount(sku_code); // only on first insert
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
    await loadExisting(); // re-hydrate list & counts from DB
    $('#scanInput')?.focus(); // refocus after unscan
  } catch (e) {
    setFeedback(`❌ ${barcode}: ${String(e.message || e)}`, false);
    $('#scanInput')?.focus();
  }
}

// Event delegation: confirm via custom modal before removing, then refocus
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

// ---------- Focus & boot ----------
window.addEventListener('load', () => {
  $('#scanInput')?.focus();
  loadExisting();
});

// Click anywhere → focus the scanner input (keep your behavior; pause when modal open)
document.addEventListener('click', (e) => {
  if (modalOpen) return; // don't steal focus from modal
  if (e.target?.id !== 'scanInput') $('#scanInput')?.focus();
});
