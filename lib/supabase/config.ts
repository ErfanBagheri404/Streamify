export function getSupabaseConfig() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || "";
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

export function getAccountStatusEndpoint() {
  return process.env.EXPO_PUBLIC_AUTH_ACCOUNT_STATUS_URL?.trim() || "";
}
