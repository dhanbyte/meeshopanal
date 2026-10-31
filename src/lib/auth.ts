import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { UserProfile } from "./types";

const LOCAL_SESSION_KEY = "parcelDeskLocalSession";
const LOCAL_ADMIN_EMAIL = "admin@gmail.com";
const LOCAL_ADMIN_PASSWORD = "admin123";

function localProfile(): UserProfile {
  return { uid: "admin-local-uid", name: "Admin", role: "admin", active: true };
}

function localUser(email: string) {
  return { uid: "admin-local-uid", email, displayName: "Admin", emailVerified: true };
}

function profileFor(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }, role: "admin" | "staff" | "client", clientId?: string): UserProfile {
  return {
    uid: user.id,
    name: typeof user.user_metadata?.name === "string" ? user.user_metadata.name : user.email || "Supabase user",
    role,
    active: user.user_metadata?.active !== false,
    clientId: clientId || (typeof user.user_metadata?.clientId === "string" ? user.user_metadata.clientId : undefined),
    clientIds: Array.isArray(user.user_metadata?.clientIds) ? user.user_metadata.clientIds as string[] : undefined,
  };
}

async function resolveProfile(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }) {
  const metadataRole = user.user_metadata?.role;
  if (metadataRole === "admin" || metadataRole === "staff") {
    return profileFor(user, metadataRole);
  }

  if (!supabase) return null;
  const { data, error } = await supabase.from("clients").select("id, name, active").eq("auth_uid", user.id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...profileFor(user, "client", data.id),
    name: data.name || profileFor(user, "client", data.id).name,
    active: data.active === true,
  };
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
  return message || "Something went wrong. Please try again.";
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, profile: null, loading: true, error: "" });

  useEffect(() => {
    if (!supabase) {
      try {
        const saved = window.localStorage.getItem(LOCAL_SESSION_KEY);
        if (saved) setState({ user: localUser(LOCAL_ADMIN_EMAIL), profile: localProfile(), loading: false, error: "" });
        else setState({ user: null, profile: null, loading: false, error: "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY." });
      } catch {
        setState({ user: null, profile: null, loading: false, error: "Supabase is not configured." });
      }
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
    if (normalizedEmail === LOCAL_ADMIN_EMAIL && password === LOCAL_ADMIN_PASSWORD && !supabase) {
      window.localStorage.setItem(LOCAL_SESSION_KEY, "true");
      setState({ user: localUser(normalizedEmail), profile: localProfile(), loading: false, error: "" });
      return;
    }
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error) throw new Error(getReadableError(error));
    if (!data.user) throw new Error("No active account was returned.");
  }

  async function resendConfirmation(email: string) {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.auth.resend({ type: "signup", email: email.trim().toLowerCase() });
    if (error) throw new Error(getReadableError(error));
  }

  async function logout() {
    window.localStorage.removeItem(LOCAL_SESSION_KEY);
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error(getReadableError(error));
    }
    setState({ user: null, profile: null, loading: false, error: "" });
  }

  return { ...state, login, logout, resendConfirmation };
}
