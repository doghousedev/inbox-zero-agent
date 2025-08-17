import { randomBytes } from 'node:crypto';

type Tokens = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  token_type: string;
  created_at: number; // epoch ms
};

const store = new Map<string, Tokens>();

export function createSessionId(): string {
  const arr = randomBytes(16);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function setTokens(sessionId: string, tokens: Omit<Tokens, 'created_at'>) {
  store.set(sessionId, { ...tokens, created_at: Date.now() });
}

export function getTokens(sessionId: string): Tokens | undefined {
  return store.get(sessionId);
}

export function clearSession(sessionId: string) {
  store.delete(sessionId);
}
