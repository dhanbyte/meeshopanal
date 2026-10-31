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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!url || !serviceRoleKey || !authorization) return respond({ error: "Supabase function is not configured." }, 500);

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: actorResult, error: actorError } = await admin.auth.getUser(token);
  const actor = actorResult.user;
  const isAdmin = actor?.email?.toLowerCase() === "admin@gmail.com" || actor?.user_metadata?.role === "admin";
  if (actorError || !actor || !isAdmin || actor.user_metadata?.active === false) {
    return respond({ error: "Only an active administrator can remove ledger entries." }, 403);
  }

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return respond({ error: "Ledger entry ID is required." }, 400);

  const { data: entry, error: entryError } = await admin.from("ledger_entries").select("id, client_id, payable_delta, receivable_delta, cash_delta").eq("id", id).maybeSingle();
  if (entryError) return respond({ error: entryError.message }, 500);
  if (!entry) return respond({ deleted: true });

  const { data: balance, error: balanceError } = await admin.from("client_balances").select("payable, receivable, cash").eq("client_id", entry.client_id).maybeSingle();
  if (balanceError) return respond({ error: balanceError.message }, 500);
  const { error: balanceWriteError } = await admin.from("client_balances").upsert({
    client_id: entry.client_id,
    payable: Number(balance?.payable ?? 0) - Number(entry.payable_delta ?? 0),
    receivable: Number(balance?.receivable ?? 0) - Number(entry.receivable_delta ?? 0),
    cash: Number(balance?.cash ?? 0) - Number(entry.cash_delta ?? 0),
    updated_at: new Date().toISOString(),
  }, { onConflict: "client_id" });
  if (balanceWriteError) return respond({ error: balanceWriteError.message }, 500);

  const { error: deleteError } = await admin.from("ledger_entries").delete().eq("id", id);
  if (deleteError) return respond({ error: deleteError.message }, 500);
  return respond({ deleted: true });
});
