import { supabase } from "./supabase";

export async function saveClientLogin(clientId: string, email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!password || password.length < 6) throw new Error("Password must contain at least 6 characters.");

  const { data, error } = await supabase.functions.invoke("admin-client-login", {
    body: { clientId, email: normalizedEmail, password },
  });
  if (error) {
    let message = error.message || "Could not save the client login.";
    if (error.context instanceof Response) {
      const body = await error.context.json().catch(() => null) as { error?: string } | null;
      if (body?.error) message = body.error;
    }
    throw new Error(message);
  }
  if (!data?.uid) throw new Error("The client login was not created.");
  return data as { uid: string };
}
