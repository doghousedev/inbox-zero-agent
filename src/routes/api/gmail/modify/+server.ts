import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getTokens, setTokens } from '$lib/oauth/session';
import { refreshAccessToken } from '$lib/oauth/google';

function isExpired(created_at: number, expires_in: number): boolean {
  const now = Date.now();
  return now >= created_at + (expires_in - 60) * 1000; // 60s buffer
}

async function ensureValidAccessToken(sessionId: string) {
  let tokens = getTokens(sessionId);
  if (!tokens) throw new Error('Session not found');
  if (isExpired(tokens.created_at, tokens.expires_in)) {
    if (!tokens.refresh_token) throw new Error('Access token expired and no refresh_token available');
    const refreshed = await refreshAccessToken({ refresh_token: tokens.refresh_token });
    const merged = { ...refreshed, refresh_token: refreshed.refresh_token || tokens.refresh_token };
    setTokens(sessionId, merged);
    tokens = getTokens(sessionId)!;
  }
  return tokens.access_token;
}

export const POST: RequestHandler = async (event) => {
  const sessionId = event.cookies.get('session_id');
  if (!sessionId) return json({ error: 'Not authenticated' }, { status: 401 });

  let body: { messageId?: string; removeLabelIds?: string[]; addLabelIds?: string[] };
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { messageId, removeLabelIds, addLabelIds } = body || {};
  if (!messageId) return json({ error: 'messageId is required' }, { status: 400 });

  try {
    const accessToken = await ensureValidAccessToken(sessionId);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ removeLabelIds, addLabelIds })
      }
    );

    const text = await res.text();
    if (!res.ok) {
      return json({ error: `Gmail modify failed (${res.status}): ${text}` }, { status: res.status });
    }

    // Return Gmail response JSON if possible; otherwise a generic ok
    try {
      return json(JSON.parse(text));
    } catch {
      return json({ ok: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 500 });
  }
};
