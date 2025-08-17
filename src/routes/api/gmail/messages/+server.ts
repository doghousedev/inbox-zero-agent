import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getTokens, setTokens } from '$lib/oauth/session';
import { refreshAccessToken } from '$lib/oauth/google';

function isExpired(created_at: number, expires_in: number): boolean {
  // 60s buffer
  const now = Date.now();
  return now >= created_at + (expires_in - 60) * 1000;
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

export const GET: RequestHandler = async (event) => {
  const sessionId = event.cookies.get('session_id');
  if (!sessionId) return json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const accessToken = await ensureValidAccessToken(sessionId);

    // First list message IDs (newest first)
    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&labelIds=INBOX',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!listRes.ok) {
      const text = await listRes.text();
      return json({ error: `Gmail list failed (${listRes.status}): ${text}` }, { status: listRes.status });
    }
    const listJson = (await listRes.json()) as { messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string };
    const ids = listJson.messages?.map((m) => m.id) ?? [];

    // Fetch minimal details for each message
    type GmailMessage = {
      id: string;
      threadId: string;
      snippet: string;
      payload?: {
        headers?: Array<{ name: string; value: string }>;
      };
    };

    const details = await Promise.all(
      ids.map(async (id) => {
        const mRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!mRes.ok) {
          const text = await mRes.text();
          return { id, error: `get failed (${mRes.status}) ${text}` } as const;
        }
        const m = (await mRes.json()) as GmailMessage;
        const headers: Record<string, string> = {};
        for (const h of m.payload?.headers ?? []) headers[h.name] = h.value;
        return {
          id: m.id,
          threadId: m.threadId,
          snippet: m.snippet,
          subject: headers['Subject'] || '',
          from: headers['From'] || '',
          date: headers['Date'] || ''
        };
      })
    );

    return json({ items: details, nextPageToken: listJson.nextPageToken });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 500 });
  }
};
