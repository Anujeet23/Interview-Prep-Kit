export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Thin fetch wrapper. Every backend error has the shape { error: { code, message } },
 * so callers can show `err.message` directly. A 401 on a protected call sends the user
 * to sign in and brings them back afterwards.
 */
export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (res.status === 401 && !path.startsWith('/auth/') && typeof window !== 'undefined') {
    const next = encodeURIComponent(window.location.pathname);
    window.location.assign(`/login?next=${next}&reason=${data?.error?.code || 'UNAUTHENTICATED'}`);
  }
  if (!res.ok) {
    const fallback = res.status >= 500 ? 'The server had a problem. Try again in a moment.' : `Request failed (${res.status}).`;
    throw new ApiError(res.status, data?.error?.code || `HTTP_${res.status}`, data?.error?.message || fallback, data?.error?.details);
  }
  return data;
}

export const CATEGORY_LABELS = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  'system-design': 'System design',
  'company-fit': 'Company fit',
};
export const CATEGORIES = Object.keys(CATEGORY_LABELS);
