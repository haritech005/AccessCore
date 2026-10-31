export interface AuthUserProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  user_type: string;
  status: string;
  groups: string[];
  tenant_scope: string[];
  has_wildcard_tenant: boolean;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const TOKEN_KEY = 'accesscore_session_token';

let memoryToken: string | null = null;

export function getStoredToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(TOKEN_KEY) || memoryToken;
  }
  return memoryToken;
}

export function setStoredToken(token: string | null): void {
  memoryToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }
}

export async function loginUser(
  emailOrId: string,
  password = ''
): Promise<{ user: AuthUserProfile; token: string }> {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ email: emailOrId, password }),
  });

  if (!res.ok) {
    let errorMsg = `Authentication failed (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson.error?.message) errorMsg = errJson.error.message;
    } catch {
      // Fallback
    }
    throw new Error(errorMsg);
  }

  const json = await res.json();
  const data = json.data as { user: AuthUserProfile; token: string };
  setStoredToken(data.token);
  return data;
}

export async function logoutUser(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Ignore network error during logout
  } finally {
    setStoredToken(null);
  }
}

export async function getCurrentUser(token?: string): Promise<AuthUserProfile | null> {
  const effectiveToken = token || getStoredToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (effectiveToken) {
    headers['Authorization'] = `Bearer ${effectiveToken}`;
  }

  const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    return null;
  }

  const json = await res.json();
  return json.data?.user || null;
}

