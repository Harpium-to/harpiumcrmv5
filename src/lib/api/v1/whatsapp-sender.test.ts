import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { WhatsAppRouteFacts } from '@/lib/channels/whatsapp-route';

import { getWhatsAppSender, senderDigits, type SenderDeps } from './whatsapp-sender';

describe('senderDigits', () => {
  it('reads Meta display numbers and WhatsApp ids', () => {
    expect(senderDigits('+55 63 9228-6787')).toBe('556392286787');
    expect(senderDigits('5563992286787')).toBe('5563992286787');
    expect(senderDigits('556392286787:12@s.whatsapp.net')).toBe('556392286787');
    expect(senderDigits('556392286787@c.us')).toBe('556392286787');
  });

  it('is null for anything that is not a phone number', () => {
    expect(senderDigits(null)).toBeNull();
    expect(senderDigits(5563992286787)).toBeNull();
    expect(senderDigits('')).toBeNull();
    expect(senderDigits('1234567')).toBeNull();
    expect(senderDigits('1234567890123456')).toBeNull();
  });
});

/** Rows per table, served by `.from(t).select().eq().maybeSingle()`. */
function fakeDb(rows: Record<string, unknown>) {
  return {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

function deps(facts: WhatsAppRouteFacts, overrides: Partial<SenderDeps> = {}): SenderDeps {
  return {
    loadRouteFacts: vi.fn(async () => facts),
    verifyPhoneNumber: vi.fn(async () => ({
      id: 'pn1',
      display_phone_number: '+55 63 9228-6787',
    })),
    getUazapiStatus: vi.fn(async () => ({
      status: 'connected',
      connected: true,
      loggedIn: true,
      qrcode: null,
      paircode: null,
      phone: '5511987654321',
      profileName: null,
    })),
    decrypt: vi.fn((value: string) => `plain:${value}`),
    ...overrides,
  } as SenderDeps;
}

const META = { whatsapp_config: { phone_number_id: 'pn1', access_token: 'enc-meta' } };
const UAZ = { uazapi_config: { base_url: 'https://uaz.example', instance_token: 'enc-uaz' } };

describe('getWhatsAppSender', () => {
  it('asks Meta for the official number', async () => {
    const d = deps({ path: 'oficial', uazapiReady: true, evolutionReady: false });
    const sender = await getWhatsAppSender(fakeDb({ ...META, ...UAZ }), 'acc', d);
    expect(sender).toEqual({ provider: 'meta', path: 'oficial', phone: '556392286787' });
    expect(d.verifyPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: 'pn1',
      accessToken: 'plain:enc-meta',
    });
    // The path decides: a QR-code instance left on is not asked.
    expect(d.getUazapiStatus).not.toHaveBeenCalled();
  });

  it('asks the QR-code instance for its number, live', async () => {
    const d = deps({ path: 'nao_oficial', uazapiReady: true, evolutionReady: false });
    const sender = await getWhatsAppSender(fakeDb({ ...META, ...UAZ }), 'acc', d);
    expect(sender).toEqual({ provider: 'uazapi', path: 'nao_oficial', phone: '5511987654321' });
    expect(d.getUazapiStatus).toHaveBeenCalledWith({
      baseUrl: 'https://uaz.example',
      token: 'plain:enc-uaz',
    });
    expect(d.verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('follows the old rule when no path was chosen', async () => {
    const d = deps({ path: null, uazapiReady: true, evolutionReady: false });
    const sender = await getWhatsAppSender(fakeDb({ ...META, ...UAZ }), 'acc', d);
    expect(sender.provider).toBe('uazapi');
    expect(sender.path).toBeNull();
  });

  it('has no number when the QR-code phone is not connected', async () => {
    const d = deps(
      { path: 'nao_oficial', uazapiReady: true, evolutionReady: false },
      {
        getUazapiStatus: vi.fn(async () => ({
          status: 'disconnected',
          connected: false,
          loggedIn: false,
          qrcode: null,
          paircode: null,
          phone: '5511987654321',
          profileName: null,
        })),
      }
    );
    const sender = await getWhatsAppSender(fakeDb(UAZ), 'acc', d);
    expect(sender.phone).toBeNull();
  });

  it('has no number when the provider refuses, instead of failing', async () => {
    const d = deps(
      { path: 'oficial', uazapiReady: false, evolutionReady: false },
      {
        verifyPhoneNumber: vi.fn(async () => {
          throw new Error('token expirado');
        }),
      }
    );
    const sender = await getWhatsAppSender(fakeDb(META), 'acc', d);
    expect(sender).toEqual({ provider: 'meta', path: 'oficial', phone: null });
  });

  it('has no number when the stored token cannot be read', async () => {
    const d = deps(
      { path: 'oficial', uazapiReady: false, evolutionReady: false },
      {
        decrypt: vi.fn(() => {
          throw new Error('chave mudou');
        }),
      }
    );
    const sender = await getWhatsAppSender(fakeDb(META), 'acc', d);
    expect(sender.phone).toBeNull();
    expect(d.verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('has no number when Meta is the door but nothing is saved', async () => {
    const d = deps({ path: null, uazapiReady: false, evolutionReady: false });
    const sender = await getWhatsAppSender(fakeDb({}), 'acc', d);
    expect(sender).toEqual({ provider: 'meta', path: null, phone: null });
    expect(d.verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('has no provider on the QR-code path with nothing connected', async () => {
    const d = deps({ path: 'nao_oficial', uazapiReady: false, evolutionReady: false });
    const sender = await getWhatsAppSender(fakeDb(META), 'acc', d);
    expect(sender).toEqual({ provider: null, path: 'nao_oficial', phone: null });
  });

  it('cannot tell an Evolution number', async () => {
    const d = deps({ path: 'nao_oficial', uazapiReady: false, evolutionReady: true });
    const sender = await getWhatsAppSender(fakeDb({}), 'acc', d);
    expect(sender).toEqual({ provider: 'evolution', path: 'nao_oficial', phone: null });
  });
});
