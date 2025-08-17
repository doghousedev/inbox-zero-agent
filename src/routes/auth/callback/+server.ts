import type { RequestHandler } from './$types';
import { redirect, json } from '@sveltejs/kit';
import { exchangeCodeForTokens } from '$lib/oauth/google';
import { createSessionId, setTokens } from '$lib/oauth/session';

export const GET: RequestHandler = async (event) => {
  const url = new URL(event.request.url);
  const code = url.searchParams.get('code');
  const incomingState = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    console.error('[/auth/callback] OAuth provider returned error:', error);
    return json({ error }, { status: 400 });
  }
  if (!code || !incomingState) {
    console.error('[/auth/callback] Missing code or state', { hasCode: !!code, hasState: !!incomingState });
    return json({ error: 'Missing code or state' }, { status: 400 });
  }

  const cookieState = event.cookies.get('oauth_state');
  const code_verifier = event.cookies.get('oauth_verifier');
  if (!cookieState || !code_verifier) {
    console.error('[/auth/callback] Missing cookies', { hasStateCookie: !!cookieState, hasVerifier: !!code_verifier });
    return json({ error: 'OAuth state or verifier cookie missing/expired' }, { status: 400 });
  }
  if (cookieState !== incomingState) {
    console.error('[/auth/callback] State mismatch', { cookieState, incomingState });
    return json({ error: 'State mismatch' }, { status: 400 });
  }

  try {
    const tokens = await exchangeCodeForTokens({ code, code_verifier });

    // Create app session and store tokens (in-memory for dev)
    const sessionId = createSessionId();
    setTokens(sessionId, tokens);

    // Clear transient cookies
    event.cookies.delete('oauth_state', { path: '/' });
    event.cookies.delete('oauth_verifier', { path: '/' });

    // Set a session cookie
    event.cookies.set('session_id', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 // 1 day for dev
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/auth/callback] Token exchange error:', err);
    return json({ error: message }, { status: 500 });
  }

  // Redirect home (or to a dashboard). Important: outside of try/catch so it's not swallowed.
  throw redirect(302, '/');
};
