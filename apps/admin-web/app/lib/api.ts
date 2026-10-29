// Phase 13 admin API client. No mock data anywhere: every value on
// every page comes from the API, and failures are shown, not hidden.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

const TOKEN_KEY = 'rahi_admin_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

async function call(path: string, method: string, body?: unknown): Promise<unknown> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (typeof json.message === 'string' && json.message) ||
      (Array.isArray(json.message) ? json.message.join(', ') : null) ||
      `Request failed (${res.status})`;
    const error = new Error(message) as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return (json as { data?: unknown }).data ?? json;
}

export const apiGet = (path: string) => call(path, 'GET');
export const apiPost = (path: string, body: unknown) => call(path, 'POST', body);
export const apiPatch = (path: string, body: unknown) => call(path, 'PATCH', body);
