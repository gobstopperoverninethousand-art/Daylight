import { createClient, SupabaseClient } from "@supabase/supabase-js";
let client: SupabaseClient | null = null;
export function browserDb() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  // PKCE keeps the Google sign-in code exchange out of the URL fragment.
  client = createClient(url, key, { auth: { flowType: "pkce" } });
  return client;
}
