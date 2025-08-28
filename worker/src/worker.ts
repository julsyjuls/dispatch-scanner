// Minimal fetch proxy to Supabase RPC with server-side key


export interface Env {
SUPABASE_URL: string;
SUPABASE_SERVICE_ROLE_KEY: string;
CORS_ORIGIN?: string; // optional: e.g., https://your-pages-domain.pages.dev
}


const json = (obj: unknown, init: ResponseInit = {}) =>
new Response(JSON.stringify(obj), {
headers: { "content-type": "application/json" },
...init,
});


function withCors(req: Request, res: Response, origin?: string) {
const o = origin || req.headers.get("Origin") || "*";
const headers = new Headers(res.headers);
headers.set("Access-Control-Allow-Origin", o);
headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
headers.set("Access-Control-Allow-Headers", "content-type");
return new Response(res.body, { status: res.status, headers });
}


async function callRpc(env: Env, fn: string, body: unknown) {
const url = `${env.SUPABASE_URL}/rest/v1/rpc/${fn}`;
const r = await fetch(url, {
method: "POST",
headers: {
"content-type": "application/json",
apikey: env.SUPABASE_SERVICE_ROLE_KEY,
authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
// Prefer: 'return=representation' // not needed for RPC
},
body: JSON.stringify(body ?? {}),
});
if (!r.ok) {
const text = await r.text();
throw new Error(`RPC ${fn} failed: ${r.status} ${text}`);
}
return r.json<any>();
}


export default {
async fetch(req: Request, env: Env): Promise<Response> {
const url = new URL(req.url);


if (req.method === "OPTIONS") {
return withCors(req, new Response(null, { status: 204 }), env.CORS_ORIGIN);
}


try {
if (url.pathname === "/api/scan" && req.method === "POST") {
const { dispatch_id, barcode } = await req.json();
if (!dispatch_id || !barcode) return withCors(req, json({ ok: false, msg: "dispatch_id and barcode required" }, { status: 400 }), env.CORS_ORIGIN);
const data = await callRpc(env, "scan_item", { p_dispatch_id: dispatch_id, p_barcode: barcode });
return withCors(req, json(data), env.CORS_ORIGIN);
}


if (url.pathname === "/api/finalize" && req.method === "POST") {
const { dispatch_id, dispatch_date } = await req.json();
if (!dispatch_id || !dispatch_date) return withCors(req, json({ ok: false, msg: "dispatch_id and dispatch_date required" }, { status: 400 }), env.CORS_ORIGIN);
const data = await callRpc(env, "finalize_dispatch", { p_dispatch_id: dispatch_id, p_dispatch_date: dispatch_date });
return withCors(req, json(data), env.CORS_ORIGIN);
}


return withCors(req, json({ ok: true, msg: "Dispatch Worker ready" }));
} catch (e: any) {
return withCors(req, json({ ok: false, error: String(e?.message || e) }, { status: 500 }), env.CORS_ORIGIN);
}
},
} satisfies ExportedHandler<Env>;
