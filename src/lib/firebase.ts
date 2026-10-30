
// Firebase is intentionally disabled in this app. Supabase is the active backend.
export const firebaseReady = false;

export const app = null;
export const auth = null;
export const db = null;
export const storage = null;

export function requireFirebase() {
  if (!auth || !db || !storage) {
    throw new Error("Firebase is disabled. Use Supabase for auth and workspace data.");
  }
  return { auth, db, storage };
}
