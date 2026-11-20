// ============================================================
// Platform keys — the credential the agency's internal system (Agency
// OS) uses to read the CRM through /api/plataforma/v1.
//
// Same recipe as the per-CRM API keys (src/lib/api-keys/keys.ts):
// 32 bytes of CSPRNG, base64url, SHA-256 stored, plaintext shown once.
// A different prefix keeps the two kinds from ever being confused —
// a CRM key never authenticates here and vice versa.
// ============================================================

import { randomBytes } from 'crypto';

import { hashApiKey } from '@/lib/api-keys/keys';

export const PLATFORM_KEY_PREFIX = 'hpk_live_';

/** Characters of the secret part shown in the console next to the name. */
const DISPLAY_BODY_CHARS = 6;

export interface GeneratedPlatformKey {
  plaintext: string;
  hash: string;
  prefix: string;
}

export function generatePlatformKey(): GeneratedPlatformKey {
  const body = randomBytes(32).toString('base64url');
  const plaintext = `${PLATFORM_KEY_PREFIX}${body}`;
  return {
    plaintext,
    hash: hashPlatformKey(plaintext),
    prefix: `${PLATFORM_KEY_PREFIX}${body.slice(0, DISPLAY_BODY_CHARS)}`,
  };
}

export function hashPlatformKey(plaintext: string): string {
  return hashApiKey(plaintext);
}

export function looksLikePlatformKey(value: string): boolean {
  return value.startsWith(PLATFORM_KEY_PREFIX) && value.length > PLATFORM_KEY_PREFIX.length + 20;
}
