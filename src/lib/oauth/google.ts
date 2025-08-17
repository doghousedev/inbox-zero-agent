import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } from '$env/static/private';

export const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const DEFAULT_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly'
];

export function buildAuthURL(params: {
  state: string;
  code_challenge: string;
  scopes?: string[];
  accessType?: 'online' | 'offline';
  promptConsent?: boolean;
}): string {
  if (!GOOGLE_CLIENT_ID) throw new Error('Missing GOOGLE_CLIENT_ID');
  if (!GOOGLE_REDIRECT_URI) throw new Error('Missing GOOGLE_REDIRECT_URI');
  const {
    state,
    code_challenge,
    scopes = DEFAULT_SCOPES,
    accessType = 'offline',
    promptConsent = true
  } = params;

  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    access_type: accessType,
    include_granted_scopes: 'true',
    code_challenge: code_challenge,
    code_challenge_method: 'S256'
  });
  if (promptConsent) q.set('prompt', 'consent');
  return `${GOOGLE_AUTH_BASE}?${q.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  token_type: string;
}

export async function exchangeCodeForTokens(args: {
  code: string;
  code_verifier: string;
}): Promise<TokenResponse> {
  if (!GOOGLE_CLIENT_ID) throw new Error('Missing GOOGLE_CLIENT_ID');
  if (!GOOGLE_CLIENT_SECRET) throw new Error('Missing GOOGLE_CLIENT_SECRET');
  if (!GOOGLE_REDIRECT_URI) throw new Error('Missing GOOGLE_REDIRECT_URI');
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    code: args.code,
    code_verifier: args.code_verifier,
    grant_type: 'authorization_code',
    redirect_uri: GOOGLE_REDIRECT_URI
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(args: {
  refresh_token: string;
}): Promise<TokenResponse> {
  if (!GOOGLE_CLIENT_ID) throw new Error('Missing GOOGLE_CLIENT_ID');
  if (!GOOGLE_CLIENT_SECRET) throw new Error('Missing GOOGLE_CLIENT_SECRET');
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: args.refresh_token
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}
