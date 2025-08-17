import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getTokens, setTokens } from '$lib/oauth/session';
import { refreshAccessToken } from '$lib/oauth/google';

function isExpired(created_at: number, expires_in: number): boolean {
  // Add a 60s buffer to proactively refresh
  const now = Date.now();
  return now >= created_at + (expires_in - 60) * 1000;
}

export const GET: RequestHandler = async (event) => {
  const sessionId = event.cookies.get('session_id');
  if (!sessionId) return json({ error: 'Not authenticated' }, { status: 401 });

  let tokens = getTokens(sessionId);
  if (!tokens) return json({ error: 'Session not found' }, { status: 401 });

  try {
    // Refresh if expired and we have a refresh_token
    if (isExpired(tokens.created_at, tokens.expires_in)) {
      if (!tokens.refresh_token)
        return json({ error: 'Access token expired and no refresh_token available' }, { status: 401 });
      const refreshed = await refreshAccessToken({ refresh_token: tokens.refresh_token });
      // Preserve original refresh_token if not returned
      const merged = {
        ...refreshed,
        refresh_token: refreshed.refresh_token || tokens.refresh_token
      };
      setTokens(sessionId, merged);
      tokens = getTokens(sessionId)!;
    }

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    if (!res.ok) {
      const text = await res.text();
      return json({ error: `Gmail profile failed (${res.status}): ${text}` }, { status: res.status });
    }
    const data = await res.json();
    return json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 500 });
  }
};
