const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function randomCode(length: number): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(length)),
    (byte) => CODE_ALPHABET[byte & 31],
  ).join('');
}

export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)!.join('-');
}

export function normalizeCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
