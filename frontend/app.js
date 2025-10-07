// app.js — focus-safe scanner + modal + password (HTML/CSS untouched)
// v2025-10-07c — Realtime + expandable Summary + working XLSX Export (also in read-only)

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
const exportBtn = $("#btnExportXlsx");

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
  skuCounts: new Map(),     // sku_code -> count
  skuItems: new Map(),      // sku_code -> Set(barcodes)
  expandedSKUs: new Set(),  // sku_code
  brandBySku: new Map(),    // sku_code -> brand_name
  brandByBarcode: new Map(),// barcode -> brand_name
  readOnly: false,
  returnedItems: [],        // OPTIONAL: [{ sku, barcode, brand }]
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

  // Export button visibility: hide only in Return Mode or when no dispatch id
  if (exportBtn) {
    if (IS_RETURN_MODE || !DISPATCH_ID) {
      exportBtn.style.display = "none";
    } else {
      exportBtn.style.display = "inline-block";
      exportBtn.disabled = false;
      exportBtn.title = "Export current dispatch to XLSX";
    }
  }
}

// ---------- Show badge immediately ----------
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
  // Recent Scans
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

  // Summary (with expandable rows)
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

        // Toggle button
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "toggle";
        toggle.setAttribute("aria-expanded", state.expandedSKUs.has(sku) ? "true" : "false");
        toggle.textContent = state.expandedSKUs.has(sku) ? "▼" : "▶";

        // Label (clickable)
        const brandSet = new Set();
        const set = state.skuItems.get(sku) || new Set();
        for (const code of set) {
          const b = state.brandByBarcode.get(code) ?? state.brandBySku.get(sku) ?? "";
          if (b) brandSet.add(b);
        }
        const brandLabel =
          brandSet.size > 1 ? "Mixed" : brandSet.values().next().value || "";

        const labelBtn = document.createElement("button");
        labelBtn.type = "button";
        labelBtn.className = "sku-label";
        labelBtn.setAttribute("data-clickable", "1");
        labelBtn.innerHTML = `${sku} ${
          brandLabel ? `· <em>${brandLabel}</em>` : ""
        } <span class="sku-badge">${n}</span>`;

        li.appendChild(toggle);
        li.appendChild(labelBtn);

        // Expanded details: per-barcode list
        if (state.expandedSKUs.has(sku)) {
          const ul = document.createElement("ul");
          ul.className = "barcode-list";
          const setCodes = state.skuItems.get(sku) || new Set();
          const codes = Array.from(setCodes).sort((a, b) => a.localeCompare(b));
          for (const code of codes) {
            const item = document.createElement("li");
            const b = state.brandByBarcode.get(code) ?? state.brandBySku.get(sku) ?? "";
            item.innerHTML = `<code>${code}</code>${b ? ` · <small>${b}</small>` : ""}`;
            ul.appendChild(item);
          }
          li.appendChild(ul);
        }

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
      `${API_URL}/api/dispatch/${encodeURIComponent(DISPATCH_ID)}/items?t=${Date.now()}`,
      { cache: "no-store" }
    );
    if (!res.ok) return;
    const data = await res.json();
    const rows = data.items || [];
    state.scans = [];
    state.skuCounts.clear();
    state.skuItems.clear();
    state.brandBySku.clear();
    state.brandByBarcode.clear();

    // Reset returned items (we'll capture any flagged as returned below)
    state.returnedItems = [];

    for (const r of rows) {
      const barcode = r.barcode;
      const sku = r.sku_code || "";
      const brand = r.brand_name || null;
      state.scans.push({ barcode, ok: true, msg: "Reserved", sku_code: sku });
      if (sku) {
        state.skuCounts.set(sku, (state.skuCounts.get(sku) || 0) + 1);
        addSkuItem(sku, barcode);
      }
      if (brand) {
        state.brandBySku.set(sku, brand);
        state.brandByBarcode.set(barcode, brand);
      }

      // OPTIONAL: capture returns if API marks items as returned
      const statusLower = String(r.status || "").toLowerCase();
      if (r.returned === true || statusLower === "returned") {
        state.returnedItems.push({
          sku,
          barcode,
          brand: brand || state.brandByBarcode.get(barcode) || state.brandBySku.get(sku) || ""
        });
      }
    }
    render();
  } catch {}
}

// ---------- Expand/Collapse handlers for Summary ----------
function toggleSkuRow(sku) {
  if (!sku) return;
  if (state.expandedSKUs.has(sku)) state.expandedSKUs.delete(sku);
  else state.expandedSKUs.add(sku);
  render();
}
function onSkuCountsClick(e) {
  const row = e.target.closest(".sku-row");
  if (!row) return;
  const sku = row.dataset.sku;
  if (e.target.classList.contains("toggle") || e.target.classList.contains("sku-label")) {
    e.preventDefault();
    e.stopPropagation();
    toggleSkuRow(sku);
  }
}
function onSkuCountsKeydown(e) {
  if (!["Enter", " "].includes(e.key)) return;
  const row = e.target.closest(".sku-row");
  if (!row) return;
  if (e.target.classList.contains("toggle") || e.target.classList.contains("sku-label")) {
    e.preventDefault();
    e.stopPropagation();
    toggleSkuRow(row.dataset.sku);
  }
}

// ---------- XLSX Export (Summary + Details + Returned Items) ----------
async function exportDispatchToXlsx() {
  if (!DISPATCH_ID) {
    setFeedback("No dispatch selected to export.", false);
    return;
  }
  try {
    // Refresh items to be accurate; also resets returnedItems in loadItemsFromView
    await loadItemsFromView();

    // Sheet2: Details (sku_code, barcode, brand_name)
    const details = [];
    const skus = Array.from(state.skuItems.keys()).sort((a, b) => a.localeCompare(b));
    for (const sku of skus) {
      const brandDefault = state.brandBySku.get(sku) || "";
      const codes = Array.from(state.skuItems.get(sku) || []).sort((a, b) => a.localeCompare(b));
      for (const code of codes) {
        details.push({
          sku_code: sku || "",
          barcode: code,
          brand_name: state.brandByBarcode.get(code) || brandDefault || ""
        });
      }
    }

    // Sheet1: Summary (sku_code, brand_name, count) + TOTAL row
    const summary = [];
    let grandTotal = 0;
    for (const sku of skus) {
      const count = (state.skuItems.get(sku) || new Set()).size;
      const brand = state.brandBySku.get(sku) || "";
      grandTotal += count;
      summary.push({ sku_code: sku || "", brand_name: brand || "", count });
    }
    summary.push({ sku_code: "TOTAL", brand_name: "", count: grandTotal });

    // Sheet3: Returned Items (optional)
    // Prefer items flagged by API; fallback to session “Returned” scans
    const returnedRows = [...(state.returnedItems || [])];
    if (returnedRows.length === 0) {
      for (const s of state.scans) {
        if (String(s.msg || "").toLowerCase() === "returned") {
          const sku = s.sku_code || "";
          const brand = state.brandByBarcode.get(s.barcode) || state.brandBySku.get(sku) || "";
          returnedRows.push({ sku, barcode: s.barcode, brand });
        }
      }
    }
    const returned = returnedRows.map(r => ({
      sku_code: r.sku || r.sku_code || "",
      barcode: r.barcode,
      brand_name: r.brand || r.brand_name || ""
    }));

    if (!details.length && !returned.length) {
      setFeedback("Nothing to export for this dispatch.", false);
      return;
    }
    if (typeof XLSX === "undefined") {
      setFeedback("Export library not loaded. Please check the SheetJS script tag.", false);
      return;
    }

    const wsSummary  = XLSX.utils.json_to_sheet(summary);
    const wsDetails  = XLSX.utils.json_to_sheet(details);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");
    XLSX.utils.book_append_sheet(wb, wsDetails, "Details");

    if (returned.length > 0) {
      const wsReturned = XLSX.utils.json_to_sheet(returned);
      XLSX.utils.book_append_sheet(wb, wsReturned, "Returned Items");
    }

    const filename = `dispatch_${DISPATCH_ID}.xlsx`;
    XLSX.writeFile(wb, filename);
    setFeedback(`⬇️ Exported to ${filename}`);
  } catch (err) {
    setFeedback(`Export failed: ${String(err?.message || err)}`, false);
  }
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

        // optimistic update
        const sku = data?.sku_code || data?.sku || "";
        const brand = data?.brand_name || data?.brand || "";
        state.scans.push({ barcode, ok: true, msg: "Reserved", sku_code: sku });
        if (sku) {
          state.skuCounts.set(sku, (state.skuCounts.get(sku) || 0) + 1);
          addSkuItem(sku, barcode);
          if (brand) {
            state.brandBySku.set(sku, brand);
            state.brandByBarcode.set(barcode, brand);
          }
        }
        render();

        // reconcile with server
        await loadItemsFromView();
        render();
      } else {
        setFeedback(`❌ ${barcode}: ${data?.msg || "Error"}`, false);
        render();
      }
    } catch (err) {
      setFeedback(`❌ ${barcode}: ${String(err?.message || err)}`, false);
      render();
    }
    scanInput.focus();
  });
}

// ---------- Boot ----------
window.addEventListener("load", async () => {
  await ensurePagePassword();

  // Hook Summary expand/collapse
  const counts = $("#skuCounts");
  counts?.addEventListener("click", onSkuCountsClick);
  counts?.addEventListener("keydown", onSkuCountsKeydown);

  // Hook Export
  exportBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    exportDispatchToXlsx();
  });

  if (IS_RETURN_MODE) {
    state.readOnly = false;
    DISPATCH_ID = null;
    const badge = $("#dispatchBadge");
    if (badge) {
      badge.textContent = "Return Mode";
      badge.style.display = "inline-block";
    }
    if (exportBtn) exportBtn.style.display = "none"; // hide Export in return mode
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

// Keep focus on scanner except when clicking interactive UI
document.addEventListener("click", (e) => {
  if (authOpen || modalOpen) return;
  const t = e.target;
  if (
    t.closest("#confirmOverlay") ||
    t.closest("#skuCounts") ||
    t.closest("#btnExportXlsx") ||
    ["INPUT", "BUTTON", "A", "SELECT", "TEXTAREA", "LABEL"].includes(t.tagName)
  ) {
    return;
  }
  scanInput?.focus();
});
