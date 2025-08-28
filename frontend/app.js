const $ = (sel) => document.querySelector(sel);
// recent scans
const list = $('#scanList');
list.innerHTML = '';
for (let i = state.scans.length - 1; i >= Math.max(0, state.scans.length - 30); i--) {
const s = state.scans[i];
const li = document.createElement('li');
li.innerHTML = `${s.ok ? '✅' : '❌'} <strong>${s.barcode}</strong> · ${s.msg}`;
list.appendChild(li);
}


// counts
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


$('#dispatchId').addEventListener('change', (e) => {
state.dispatchId = Number(e.target.value || 0) || null;
});


$('#finalizeBtn').addEventListener('click', async () => {
const id = Number($('#dispatchId').value || 0);
const date = $('#dispatchDate').value;
if (!id || !date) { setFeedback('Dispatch ID and date required to finalize', false); return; }
try {
const res = await fetch(`${$('#apiUrl').value}/api/finalize`, {
method: 'POST', headers: { 'content-type': 'application/json' },
body: JSON.stringify({ dispatch_id: id, dispatch_date: date })
});
const data = await res.json();
if (!data.ok) throw new Error(data.msg || data.error || 'Finalize failed');
setFeedback(`Finalized. Updated ${data.updated} item(s).`);
} catch (e) {
setFeedback(String(e.message || e), false);
}
});


$('#scanInput').addEventListener('keydown', async (e) => {
if (e.key !== 'Enter') return;
const barcode = e.target.value.trim();
e.target.value = '';


const id = Number($('#dispatchId').value || 0);
if (!id) { setFeedback('Enter a Dispatch ID first', false); return; }
const api = $('#apiUrl').value;
if (!api) { setFeedback('Set Worker API URL', false); return; }


try {
const res = await fetch(`${api}/api/scan`, {
method: 'POST', headers: { 'content-type': 'application/json' },
body: JSON.stringify({ dispatch_id: id, barcode })
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


// autofocus helper for scanners
window.addEventListener('load', () => $('#scanInput').focus());
