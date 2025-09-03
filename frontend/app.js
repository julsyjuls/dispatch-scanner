// --- Helpers ---
const json = (obj, init = {}) =>
  new Response(JSON.stringify(obj), {
    headers: { "content-type": "application/json" },
    ...init,
  });

function withCors(req, res, origin) {
  const o = origin || req.headers.get("Origin") || "*";
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", o);
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "content-type,authorization");
  return new Response(res.body, { status: res.status, headers });
}

async function callRpc(env, fn, body) {
  const url = `${env.SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`RPC ${fn} failed: ${r.status} ${text}`);
  }
  return r.json();
}

async function safeJson(req) {
  try { return await req.json(); } catch { return {}; }
}

// --- Worker ---
export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return withCors(req, new Response(null, { status: 204 }), env.CORS_ORIGIN);
    }

    try {
      // Health check
      if (url.pathname === "/api/ping") {
        return withCors(req, json({ ok: true, msg: "Dispatch Worker ready" }), env.CORS_ORIGIN);
      }

      // POST /api/scan
      if (url.pathname === "/api/scan" && req.method === "POST") {
        const { dispatch_id, barcode } = await safeJson(req);
        if (!dispatch_id || !barcode) {
          return withCors(
            req,
            json({ ok: false, code: "BAD_REQUEST", msg: "dispatch_id and barcode required" }, { status: 400 }),
            env.CORS_ORIGIN
          );
        }

        const data = await callRpc(env, "scan_dispatch_item", {
          p_dispatch_id: dispatch_id, // keep as string (e.g., '0000002')
          p_barcode: barcode,
        });

        const rows = Array.isArray(data) ? data : [data];
        if (!rows.length) {
          return withCors(
            req,
            json({ ok: false, code: "NOT_FOUND", msg: "No row returned" }, { status: 404 }),
            env.CORS_ORIGIN
          );
        }

        const item = rows[0];
        const ok = !!item?.was_inserted;
        const msg = ok
          ? "Reserved"
          : `Not eligible: ${item?.inventory_status ?? "N/A"} (rank ${item?.batch_rank ?? "N/A"})`;

        return withCors(req, json({ ok, msg, item, rows }), env.CORS_ORIGIN);
      }

      // POST /api/unscan
      if (url.pathname === "/api/unscan" && req.method === "POST") {
        const { dispatch_id, barcode } = await safeJson(req);
        if (!dispatch_id || !barcode) {
          return withCors(
            req,
            json({ ok: false, code: "BAD_REQUEST", msg: "dispatch_id and barcode required" }, { status: 400 }),
            env.CORS_ORIGIN
          );
        }

        const data = await callRpc(env, "unscan_dispatch_item", {
          p_dispatch_id: dispatch_id,
          p_barcode: barcode,
        });

        const rows = Array.isArray(data) ? data : [data];
        const item = rows[0] || null;
        const ok = !!item?.removed;
        const msg = ok
          ? (item?.reverted ? "Removed and reverted to Available" : "Removed")
          : "Nothing to remove";

        return withCors(req, json({ ok, msg, item, rows }), env.CORS_ORIGIN);
      }

      // GET /api/list?dispatch_id=0000002
      if (url.pathname === "/api/list" && req.method === "GET") {
        const did = url.searchParams.get("dispatch_id");
        if (!did) {
          return withCors(
            req,
            json({ ok: false, code: "BAD_REQUEST", msg: "dispatch_id required" }, { status: 400 }),
            env.CORS_ORIGIN
          );
        }

        const rows = await callRpc(env, "list_dispatch_scans", { p_dispatch_id: did });
        return withCors(req, json({ ok: true, rows }), env.CORS_ORIGIN);
      }

      // POST /api/finalize
      if (url.pathname === "/api/finalize" && req.method === "POST") {
        const { dispatch_id, dispatch_date } = await safeJson(req);
        if (!dispatch_id || !dispatch_date) {
          return withCors(
            req,
            json({ ok: false, code: "BAD_REQUEST", msg: "dispatch_id and dispatch_date required" }, { status: 400 }),
            env.CORS_ORIGIN
          );
        }

        const result = await callRpc(env, "finalize_dispatch", {
          p_dispatch_id: dispatch_id,
          p_dispatch_date: dispatch_date,
        });

        return withCors(req, json({ ok: true, msg: "Finalize complete", data: result }), env.CORS_ORIGIN);
      }

      // Default
      return withCors(req, json({ ok: true, msg: "Dispatch Worker ready" }), env.CORS_ORIGIN);
    } catch (e) {
      return withCors(
        req,
        json({ ok: false, code: "SERVER_ERROR", error: String(e && e.message ? e.message : e) }, { status: 500 }),
        env.CORS_ORIGIN
      );
    }
  },
};
