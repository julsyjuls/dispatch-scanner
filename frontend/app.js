// app.js — focus-safe scanner + modal + password (HTML/CSS untouched)
const $ = (sel) => document.querySelector(sel);

// 🔒 Worker endpoint
const API_URL = "https://dispatch-api.julsyjuls.workers.dev";

// 🔐 Page password protection
const PAGE_PASSWORD = "KAPS1";

// Gates
let authOpen = true;
let modalOpen = false;

// Elements
const scanInput = $("#scanInput");
const authOverlay = $("#auth-overlay");

// Disable scanner at start
if (scanInput) {
  scanInput.removeAttribute?.("autofocus");
  scanInput.disabled = true;
}

// Hide stray modal if any
const confirmOverlay = $("#confirmOverlay");
if (confirmOverlay && !confirmOverlay.hasAttribute("hidden")) {
  confirmOverlay.hidden = true;
}

// ---------- URL helpers ----------
function getDispatchIdFromURL() {
  const params = new URLSearchParams(location.search);
  const did = params.get("dispatch_id");
  return /^\d+$/.test(did || "") ? did : null;
}
function getModeFromURL() {
  const params = new URLSearchParams(location.search);
  const m = (params.get("mode") || "").toLowerCase();
  return m === "return" ? "return" : "dispatch";
}
let DISPATCH_ID = getDispatchIdFromURL();
const MODE = getModeFromURL();
const IS_RETURN_MODE = MODE === "return";

// ---------- Helpers ----------
function pauseScanner() {
  if (!scanInput) return;
  scanInput.blur();
  scanInput.disabled = true;
}
function resumeScanner() {
  if (!scanInput) return;
  const shouldDisable = authOpen || modalOpen || (!IS_RETURN_MODE && state.readOnly);
  scanInput.disabled = shouldDisable;
  if (!scanInput.disabled) setTimeout(() => scanInput.focus(), 30);
}
function setFeedback(msg, success = true) {
  const el = $("#feedback");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("success", !!success);
  el.classList.toggle("error", !success);
}

// ---------- Password ----------
function ensurePagePassword() {
  return new Promise((resolve) => {
    const overlay = authOverlay;
    const input = $("#auth-password");
    const submit = $("#auth-submit");
    const errorEl = $("#auth-error");

    if (document.activeElement) document.activeElement.blur();
    setTimeout(() => input?.focus(), 0);

    function tryUnlock() {
      const val = (input.value || "").trim();
      if (val === PAGE_PASSWORD) {
        authOpen = false;
        overlay?.remove();
        resumeScanner();
        resolve(true);
      } else {
        errorEl.textContent = "❌ Incorrect password. Please try again.";
        input.value = "";
        input.focus();
      }
    }
    submit?.addEventListener("click", tryUnlock);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") tryUnlock();
    });
  });
}

// ---------- State ----------
const state = {
  scans: [],
  skuCounts: new Map(),
  skuItems: new Map(),
  expandedSKUs: new Set(),
  brandBySku: new Map(),
  brandByBarcode: new Map(),
  readOnly: false,
};

// ---------- Read-only UI ----------
async function loadMeta() {
  if (!DISPATCH_ID) return;
  try {
    const r = await fetch(`${API_URL}/api/dispatch/${encodeURIComponent(DISPATCH_ID)}/meta`);
    const j = await r.json();
    const status = (j?.status || "").toLowerCase();
    state.readOnly = status !== "open";
    applyReadOnlyUI(status);
  } catch {
    state.readOnly = false;
    applyReadOnlyUI(null);
  } finally {
    resumeScanner();
  }
}

function applyReadOnlyUI(statusLower) {
  if (scanInput) {
    scanInput.disabled = state.readOnly || authOpen || modalOpen;
    scanInput.placeholder = state.readOnly
      ? "Read-only (Dispatched)"
      : "Scan or enter barcode.";
  }
  const badge = $("#dispatchBadge");
  if (badge) {
    const suffix = state.readOnly
      ? statusLower
        ? ` · ${statusLower.charAt(0).toUpperCase()}${statusLower.slice(1)}`
        : " · Dispatched"
      : "";
    badge.textContent = DISPATCH_ID
      ? `Dispatch #${DISPATCH_ID}${suffix}`
      : "No dispatch selected — open this from Softr";
    badge.style.display = "inline-block";
  }
}

// ---------- Show badge ----------
(() => {
  const badge = $("#dispatchBadge");
  if (!badge) return;
  badge.textContent = IS_RETURN_MODE
    ? "Return Mode"
    : DISPATCH_ID
    ? `Dispatch #${DISPATCH_ID}`
    : "No dispatch selected — open this from Softr";
  badge.style.display = "inline-block";
})();

// ---------- Rendering ----------
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
  const el = $("#summaryTotal");
  if (!el) return;
  const total = computeTotalItems();
  el.textContent = total;
  el.title = `${total} items scanned`;
  el.style.display = total > 0 ? "inline-flex" : "none";
}
function render() {
  const list = $("#scanList");
  if (list) {
    list.innerHTML = "";
    for (let i = state.scans.length - 1; i >= Math.max(0, state.scans.length - 30); i--) {
      const s = state.scans[i];
      const li = document.createElement("li");
      li.innerHTML =
        `${s.ok ? "✅" : "❌"} <strong>${s.barcode}</strong>` +
        (s.sku_code ? ` · ${s.sku_code}` : "") +
        (s.msg ? ` · ${s.msg}` : "") +
        (!IS_RETURN_MODE && !state.readOnly
          ? ` <button class="warn remove" data-barcode="${s.barcode}">Remove</button>`
          : "");
      list.appendChild(li);
    }
  }
  if (!IS_RETURN_MODE) {
    const counts = $("#skuCounts");
    if (counts) {
      counts.innerHTML = "";
      const entries = Array.from(state.skuCounts.entries()).sort(([a], [b]) =>
        a.localeCompare(b)
      );
      for (const [sku, n] of entries) {
        const li = document.createElement("li");
        li.className = "sku-row";
        li.dataset.sku = sku;
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "toggle";
        toggle.textContent = state.expandedSKUs.has(sku) ? "▼" : "▶";
        const set = state.skuItems.get(sku) || new Set();
        const brandSet = new Set();
        for (const code of set) {
          const b = state.brandByBarcode.get(code) ?? state.brandBySku.get(sku) ?? "";
          if (b) brandSet.add(b);
        }
        const brandLabel =
          brandSet.size > 1 ? "Mixed" : brandSet.values().next().value || "";
        const label = document.createElement("span");
        label.className = "sku-label";
        label.innerHTML = `${sku} ${
          brandLabel ? `· <em>${brandLabel}</em>` : ""
        } <span class="sku-badge">${n}</span>`;
        li.appendChild(toggle);
        li.appendChild(label);
        counts.appendChild(li);
      }
    }
  }
  updateSummaryTotalUI();
}

// ---------- Data load ----------
async function loadItemsFromView() {
  if (!DISPATCH_ID) return;
  try {
    const res = await fetch(
      `${API_URL}/api/dispatch/${encodeURIComponent(DISPATCH_ID)}/items`
    );
    if (!res.ok) return;
    const data = await res.json();
    const rows = data.items || [];
    state.scans = [];
    state.skuCounts.clear();
    state.skuItems.clear();
    state.brandBySku.clear();
    state.brandByBarcode.clear();
    for (const r of rows) {
      const barcode = r.barcode;
      const sku = r.sku_code || "";
      const brand = r.brand_name || null;
      state.scans.push({ barcode, ok: true, msg: "Reserved", sku_code: sku });
      bumpSkuCount(sku);
      addSkuItem(sku, barcode);
      if (brand) {
        state.brandBySku.set(sku, brand);
        state.brandByBarcode.set(barcode, brand);
      }
    }
    render();
  } catch {}
}

// ---------- Scan handler ----------
if (scanInput) {
  scanInput.addEventListener("keydown", async (e) => {
    if (authOpen || modalOpen) return;
    if (e.key !== "Enter") return;

    const barcode = e.target.value.trim();
    e.target.value = "";
    if (!barcode) return;

    // Return Mode
    if (IS_RETURN_MODE) {
      try {
        const res = await fetch(`${API_URL}/api/return`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ barcode }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          setFeedback(`✅ ${barcode} returned (now Available)`);
          state.scans.push({ barcode, ok: true, msg: "Returned" });
        } else {
          const msg = data?.msg || `HTTP ${res.status}`;
          setFeedback(`❌ ${barcode}: ${msg}`, false);
          state.scans.push({ barcode, ok: false, msg });
        }
      } catch (err) {
        const msg = String(err?.message || err);
        setFeedback(`❌ ${barcode}: ${msg}`, false);
      }
      render();
      scanInput.focus();
      return;
    }

    // Dispatch Mode
    if (state.readOnly) {
      setFeedback("This dispatch is read-only.", false);
      scanInput.focus();
      return;
    }
    if (!DISPATCH_ID) {
      setFeedback("Missing Dispatch ID.", false);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dispatch_id: DISPATCH_ID, barcode }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setFeedback(`✅ ${barcode} reserved`);
      } else {
        setFeedback(`❌ ${barcode}: ${data?.msg || "Error"}`, false);
      }
    } catch (err) {
      setFeedback(`❌ ${barcode}: ${String(err?.message || err)}`, false);
    }
    render();
    scanInput.focus();
  });
}

// ---------- Boot ----------
window.addEventListener("load", async () => {
  await ensurePagePassword();

  if (IS_RETURN_MODE) {
    state.readOnly = false;
    DISPATCH_ID = null;
    const badge = $("#dispatchBadge");
    if (badge) {
      badge.textContent = "Return Mode";
      badge.style.display = "inline-block";
    }
    const btn = document.getElementById("btnExportXlsx");
    if (btn) btn.style.display = "none"; // hide Export
    if (scanInput) {
      scanInput.placeholder = "Return Mode: scan or enter barcode";
      scanInput.disabled = authOpen || modalOpen;
    }
    resumeScanner();
    return;
  }

  // Dispatch Mode boot
  await loadMeta();
  await loadItemsFromView();
  resumeScanner();
});

document.addEventListener("click", (e) => {
  if (authOpen || modalOpen) return;
  const t = e.target;
  if (
    t.closest("#confirmOverlay") ||
    ["INPUT", "BUTTON", "A", "SELECT", "TEXTAREA", "LABEL"].includes(t.tagName)
  )
    return;
  scanInput?.focus();
});
