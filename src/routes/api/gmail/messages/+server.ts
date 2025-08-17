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

    // Fetch details for each message (format=full) and extract plain text body
    type GmailMessage = {
      id: string;
      threadId: string;
      snippet: string;
      payload?: GmailPayload;
    };

    type GmailPayload = {
      mimeType?: string;
      body?: { size?: number; data?: string };
      parts?: GmailPayload[];
      headers?: Array<{ name: string; value: string }>;
    };

    function decodeBase64Url(b64url: string | undefined): string {
      if (!b64url) return '';
      const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
      const buff = Buffer.from(b64, 'base64');
      return buff.toString('utf8');
    }

    function extractPlainText(payload?: GmailPayload): string {
      if (!payload) return '';
      // If this node is text/plain with data
      if (payload.mimeType === 'text/plain' && payload.body?.data) {
        return decodeBase64Url(payload.body.data);
      }
      // If multipart, search parts preferring text/plain, else fallback to text/html
      if (payload.parts && payload.parts.length) {
        // prefer text/plain
        for (const p of payload.parts) {
          const t = extractPlainText(p);
          if (t) return t;
        }
        // fallback: find html and strip tags
        for (const p of payload.parts) {
          const html = extractHtml(p);
          if (html) return stripHtml(html);
        }
      }
      // Single-part html
      const html = extractHtml(payload);
      if (html) return stripHtml(html);
      // Last resort: decode body
      if (payload.body?.data) return decodeBase64Url(payload.body.data);
      return '';
    }

    function extractHtml(payload?: GmailPayload): string {
      if (!payload) return '';
      if (payload.mimeType === 'text/html' && payload.body?.data) {
        return decodeBase64Url(payload.body.data);
      }
      if (payload.parts) {
        for (const p of payload.parts) {
          const html = extractHtml(p);
          if (html) return html;
        }
      }
      return '';
    }

    function stripHtml(html: string): string {
      return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const details = await Promise.all(
      ids.map(async (id) => {
        const mRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!mRes.ok) {
          const text = await mRes.text();
          return { id, error: `get failed (${mRes.status}) ${text}` } as const;
        }
        const m = (await mRes.json()) as GmailMessage;
        const headers: Record<string, string> = {};
        for (const h of m.payload?.headers ?? []) headers[h.name] = h.value;
        const bodyText = extractPlainText(m.payload);
        return {
          id: m.id,
          threadId: m.threadId,
          snippet: m.snippet,
          subject: headers['Subject'] || '',
          from: headers['From'] || '',
          date: headers['Date'] || '',
          bodyText
        };
      })
    );

    return json({ items: details, nextPageToken: listJson.nextPageToken });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 500 });
  }
};
