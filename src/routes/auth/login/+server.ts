import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { createPkcePair, randomString } from '$lib/oauth/pkce';
import { buildAuthURL } from '$lib/oauth/google';

export const GET: RequestHandler = async (event) => {
  const state = randomString(16);
  const { code_verifier, code_challenge } = await createPkcePair();

  // Short-lived cookies to carry state and PKCE verifier through the round-trip
  event.cookies.set('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600
  });
  event.cookies.set('oauth_verifier', code_verifier, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600
  });

  const url = buildAuthURL({ state, code_challenge });
  throw redirect(302, url);
};
