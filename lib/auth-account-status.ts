import { getAccountStatusEndpoint } from "./supabase/config";

export interface AccountStatusResponse {
  available: boolean;
  exists: boolean;
  duplicate: boolean;
  providers: string[];
  suggestedAction: string;
  error?: string;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function checkAccountStatus(
  rawEmail: string
): Promise<AccountStatusResponse | null> {
  const endpoint = getAccountStatusEndpoint();
  const email = normalizeEmail(rawEmail);

  if (!endpoint || !email) {
    return null;
  }

  try {
    const url = new URL(endpoint);
    url.searchParams.set("email", email);

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    return (await response.json()) as AccountStatusResponse;
  } catch {
    return null;
  }
}
