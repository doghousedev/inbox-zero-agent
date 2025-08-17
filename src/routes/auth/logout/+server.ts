import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { clearSession } from '$lib/oauth/session';

export const GET: RequestHandler = async (event) => {
  const sessionId = event.cookies.get('session_id');
  if (sessionId) {
    clearSession(sessionId);
  }
  event.cookies.delete('session_id', { path: '/' });
  throw redirect(302, '/');
};
