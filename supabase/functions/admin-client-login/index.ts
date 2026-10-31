import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !serviceRoleKey || !authorization) return response({ error: "Supabase function is not configured." }, 500);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: actorResult, error: actorError } = await adminClient.auth.getUser(token);
  const actor = actorResult.user;
  const isConfiguredAdmin = actor?.email?.toLowerCase() === "admin@gmail.com";
  if (actorError || !actor || ((!isConfiguredAdmin && actor.user_metadata?.role !== "admin") || actor.user_metadata?.active === false)) {
    return response({ error: "Only an active administrator can manage client logins." }, 403);
  }

  const body = await request.json().catch(() => null);
  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!clientId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response({ error: "Client ID and a valid email are required." }, 400);
  }

  const { data: client, error: clientError } = await adminClient.from("clients").select("id, name, business_name, contact_name, auth_uid").eq("id", clientId).maybeSingle();
  if (clientError) return response({ error: clientError.message }, 500);
  if (!client) return response({ error: "This client record does not exist." }, 404);

  let uid = typeof client.auth_uid === "string" ? client.auth_uid : "";
  if (!uid) {
    const { data: users, error: usersError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersError) return response({ error: usersError.message }, 500);
    const existingUser = users.users.find((user) => user.email?.toLowerCase() === email);
    uid = existingUser?.id || "";
  }
  if (uid) {
    if (password && password.length < 6) return response({ error: "Password must contain at least 6 characters." }, 400);
    const authUpdate: Record<string, unknown> = {
      email,
      email_confirm: true,
      user_metadata: { clientId, role: "client", name: client.contact_name || client.business_name || client.name },
    };
    if (password) authUpdate.password = password;
    const { error } = await adminClient.auth.admin.updateUserById(uid, {
      ...authUpdate,
    });
    if (error) return response({ error: error.message }, 400);
  } else {
    if (password.length < 6) return response({ error: "A new client login needs a password of at least 6 characters." }, 400);
    const { data: created, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { clientId, role: "client", name: client.contact_name || client.business_name || client.name },
    });
    if (error || !created.user) return response({ error: error?.message || "Could not create the client login." }, 400);
    uid = created.user.id;
  }

  const { error: updateError } = await adminClient.from("clients").update({ login_email: email, auth_uid: uid }).eq("id", clientId);
  if (updateError) return response({ error: updateError.message }, 500);
  return response({ uid });
});
