import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { UserProfile } from "./types";

const LOCAL_ADMIN_EMAIL = "admin@gmail.com";
const LOCAL_ADMIN_PASSWORD = "admin123";
const LOCAL_SESSION_KEY = "parcelDeskLocalSession";
const LOCAL_ADMIN_PROFILE: UserProfile = { uid: "local-demo-admin", name: "Local demo admin", role: "admin", active: true, clientIds: [] };

function localDemoUser() {
  return { uid: LOCAL_ADMIN_PROFILE.uid, email: LOCAL_ADMIN_EMAIL, displayName: LOCAL_ADMIN_PROFILE.name, emailVerified: true };
}

function profileFor(user: { id: string; email?: string | null }, profile: { role: "admin" | "staff" | "client"; active: boolean; name?: string | null; client_id?: string | null }) {
  return {
    uid: user.id,
    name: profile.name || user.email || "Supabase user",
    role: profile.role,
    active: profile.active,
    clientId: profile.client_id || undefined,
  };
}

async function resolveProfile(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("profiles").select("role, active, name, client_id").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (!data || data.active !== true) return null;
  const profile = profileFor(user, data);
  if (profile.role !== "staff") return profile as UserProfile;
  const { data: assignments, error: assignmentError } = await supabase.from("staff_client_access").select("client_id").eq("staff_id", user.id);
  if (assignmentError) throw assignmentError;
  return { ...profile, clientIds: (assignments ?? []).map((row) => row.client_id) } as UserProfile;
}

export interface AuthState {
  user: { uid: string; email?: string | null; displayName?: string; emailVerified?: boolean } | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string;
}

export function isEmailNotConfirmedError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === "email_not_confirmed" || /email not confirmed/i.test(message);
}

export function getReadableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/invalid login credentials/i.test(message)) return "Email or password does not match an active account.";
  if (/email not confirmed/i.test(message)) return "Email not confirmed. Ask an administrator to reset this client login from the panel.";
  if (/failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message)) {
    return "Cannot reach Supabase Auth. Check that VITE_SUPABASE_URL points to an active project and that your internet connection is available.";
  }
  return message || "Something went wrong. Please try again.";
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, profile: null, loading: true, error: "" });

  useEffect(() => {
    if (!supabase) {
      try {
        if (window.localStorage.getItem(LOCAL_SESSION_KEY)) {
          setState({ user: localDemoUser(), profile: LOCAL_ADMIN_PROFILE, loading: false, error: "" });
          return;
        }
      } catch {
        // Private browsing may block local storage; sign-in still works for this tab.
      }
      setState({ user: null, profile: null, loading: false, error: "" });
      return;
    }

    const client = supabase;
    let active = true;
    void client.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (data.session?.user) {
        const user = data.session.user;
        const profile = await resolveProfile(user);
        if (!profile) {
          await client.auth.signOut();
          setState({ user: null, profile: null, loading: false, error: "" });
          return;
        }
        setState({ user: { uid: user.id, email: user.email, displayName: String(user.user_metadata?.name || user.email || ""), emailVerified: true }, profile, loading: false, error: "" });
      } else {
        setState({ user: null, profile: null, loading: false, error: "" });
      }
    }).catch((error) => {
      if (active) setState({ user: null, profile: null, loading: false, error: getReadableError(error) });
    });

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setState((current) => ({ ...current, user: null, profile: null, loading: false }));
        return;
      }
      const user = session.user;
      void resolveProfile(user).then((profile) => {
        if (!profile) {
          void client.auth.signOut();
          setState({ user: null, profile: null, loading: false, error: "" });
          return;
        }
        setState({ user: { uid: user.id, email: user.email, displayName: String(user.user_metadata?.name || user.email || ""), emailVerified: true }, profile, loading: false, error: "" });
      }).catch((error) => {
        setState({ user: null, profile: null, loading: false, error: getReadableError(error) });
      });
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  async function login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!supabase) {
      if (normalizedEmail !== LOCAL_ADMIN_EMAIL || password !== LOCAL_ADMIN_PASSWORD) {
        throw new Error("Email or password does not match the local demo admin account.");
      }
      try { window.localStorage.setItem(LOCAL_SESSION_KEY, "true"); } catch { /* Keep the signed-in state for this tab. */ }
      setState({ user: localDemoUser(), profile: LOCAL_ADMIN_PROFILE, loading: false, error: "" });
      return;
    }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (error) throw error;
      if (!data.user) throw new Error("No active account was returned.");
    } catch (error) {
      throw new Error(getReadableError(error));
    }
  }

  async function resendConfirmation(email: string) {
    if (!supabase) throw new Error("Email confirmation is unavailable in local demo mode.");
    const { error } = await supabase.auth.resend({ type: "signup", email: email.trim().toLowerCase() });
    if (error) throw new Error(getReadableError(error));
  }

  async function logout() {
    try { window.localStorage.removeItem(LOCAL_SESSION_KEY); } catch { /* Ignore unavailable local storage. */ }
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error(getReadableError(error));
    }
    setState({ user: null, profile: null, loading: false, error: "" });
  }

  return { ...state, login, logout, resendConfirmation };
}
