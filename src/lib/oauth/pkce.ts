import { randomBytes, webcrypto as nodeWebcrypto } from 'node:crypto';

function getWebCrypto(): Crypto {
  // Prefer Web Crypto if available (browser-like or Node >=18)
  if (typeof globalThis !== 'undefined' && (globalThis as any).crypto) {
    return (globalThis as unknown as { crypto: Crypto }).crypto;
  }
  // Fallback to node:crypto webcrypto which implements the Web Crypto API
  return nodeWebcrypto as unknown as Crypto;
}

export function randomString(bytes = 32): string {
  const wc = getWebCrypto();
  let arr = new Uint8Array(bytes);
  if (wc && typeof wc.getRandomValues === 'function') {
    wc.getRandomValues(arr);
  } else {
    // Fallback for environments without Web Crypto getRandomValues
    arr = new Uint8Array(randomBytes(bytes));
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(input: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const wc = getWebCrypto();
  return wc.subtle.digest('SHA-256', enc.encode(input));
}

export function base64urlFromArrayBuffer(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function createPkcePair(): Promise<{ code_verifier: string; code_challenge: string }> {
  const code_verifier = randomString(32);
  const hash = await sha256(code_verifier);
  const code_challenge = base64urlFromArrayBuffer(hash);
  return { code_verifier, code_challenge };
}
