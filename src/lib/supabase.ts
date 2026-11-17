import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const supabaseLegacyAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabaseApiKey = supabasePublishableKey || supabaseLegacyAnonKey;

if (!supabaseUrl || !supabaseApiKey) {
  console.warn("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your .env.local file.");
}

export const supabase = supabaseUrl && supabaseApiKey
  ? createClient(supabaseUrl, supabaseApiKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function isSupabaseReady() {
  return Boolean(supabase);
}
