import { supabase } from "./supabaseClient";

export async function accountFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
  if (url.origin !== window.location.origin) throw new Error("Account requests must use this application's origin.");
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  if (data.session?.access_token) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  else headers.set("Authorization", "Bearer signed-out");
  return fetch(input, { ...init, headers });
}
