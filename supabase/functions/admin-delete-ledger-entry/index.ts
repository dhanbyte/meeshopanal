import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAdminApiKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}") as Record<string, unknown>;
    const key = keys.parceldesk_edge;
    return typeof key === "string" ? key : "";
  } catch {
    return "";
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const secretKey = getAdminApiKey();
  const publishableKey = request.headers.get("apikey");
  const authorization = request.headers.get("Authorization");
  if (!url || !secretKey || !publishableKey || !authorization) return respond({ error: "Supabase function is not configured. Add the 'parceldesk_edge' secret API key." }, 500);

  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: actorResult, error: actorError } = await admin.auth.getUser(token);
  const actor = actorResult.user;
  if (actorError || !actor) {
    return respond({ error: "Only an active administrator can remove ledger entries." }, 403);
  }
  const { data: profile, error: profileError } = await admin.from("profiles").select("role, active").eq("id", actor.id).maybeSingle();
  if (profileError || profile?.role !== "admin" || profile.active !== true) return respond({ error: "Only an active administrator can reverse ledger entries." }, 403);

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return respond({ error: "Ledger entry ID is required." }, 400);

  const userClient = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } }, auth: { autoRefreshToken: false, persistSession: false } });
  const { data: reversalId, error: reversalError } = await userClient.rpc("reverse_ledger_entry", { p_entry_id: id, p_idempotency_key: crypto.randomUUID() });
  if (reversalError) return respond({ error: reversalError.message }, 400);
  return respond({ reversed: true, reversalId });
});
