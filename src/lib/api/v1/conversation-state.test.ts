import { describe, expect, it } from 'vitest';

import { aiStateOf, serializeConversationState } from './conversation-state';

describe('aiStateOf', () => {
  it('is off when the account has no auto-reply, whatever the conversation says', () => {
    expect(aiStateOf({}, false)).toBe('off');
    expect(aiStateOf({ ai_autoreply_disabled: true, assigned_agent_id: 'u1' }, false)).toBe('off');
  });

  it('is answering only while nothing stands the bot down', () => {
    expect(aiStateOf({}, true)).toBe('answering');
    expect(aiStateOf({ ai_autoreply_disabled: false, assigned_agent_id: null }, true)).toBe(
      'answering'
    );
  });

  it('is paused when the conversation is paused or a person owns it', () => {
    expect(aiStateOf({ ai_autoreply_disabled: true }, true)).toBe('paused');
    expect(aiStateOf({ assigned_agent_id: 'u1' }, true)).toBe('paused');
  });
});

describe('serializeConversationState', () => {
  const row = {
    id: 'conv1',
    status: 'open',
    channel: 'whatsapp',
    account_id: 'acc', // internal — must not leak
    contact_id: 'c1',
    assigned_agent_id: 'u1',
    ai_autoreply_disabled: true,
    ai_handoff_summary: 'Quer falar de preço com uma pessoa.',
    needs_human_since: '2026-11-10T12:00:00Z',
    last_message_at: '2026-11-10T12:05:00Z',
    last_message_text: 'oi', // message text stays out of this endpoint
  };

  it('projects the public shape', () => {
    expect(
      serializeConversationState(row, { botOn: true, personId: 'u1', assigneeName: 'Ana Lima' })
    ).toEqual({
      id: 'conv1',
      status: 'open',
      channel: 'whatsapp',
      ai: 'paused',
      handoff_summary: 'Quer falar de preço com uma pessoa.',
      waiting_since: '2026-11-10T12:00:00Z',
      assigned_to: { id: 'u1', name: 'Ana Lima' },
      assigned_to_me: true,
      last_message_at: '2026-11-10T12:05:00Z',
      flow: null,
    });
  });

  it('knows when it belongs to someone else, or to nobody', () => {
    const other = serializeConversationState(row, {
      botOn: true,
      personId: 'u2',
      assigneeName: 'Ana Lima',
    });
    expect(other.assigned_to_me).toBe(false);

    const noKeyOwner = serializeConversationState(row, {
      botOn: true,
      personId: null,
      assigneeName: 'Ana Lima',
    });
    expect(noKeyOwner.assigned_to_me).toBe(false);

    const free = serializeConversationState(
      { ...row, assigned_agent_id: null, ai_autoreply_disabled: false },
      { botOn: true, personId: 'u1', assigneeName: null }
    );
    expect(free.assigned_to).toBeNull();
    expect(free.assigned_to_me).toBe(false);
    expect(free.ai).toBe('answering');
  });

  it('reads as nobody waiting on a database without migration 058', () => {
    const { needs_human_since: _absent, ...before058 } = row;
    void _absent;
    expect(
      serializeConversationState(before058, { botOn: true, personId: 'u1', assigneeName: null })
        .waiting_since
    ).toBeNull();
  });
});

describe('serializeConversationState — the flow running', () => {
  it('carries the flow it was given', () => {
    const flow = { run_id: 'r1', flow_id: 'f1', name: 'Triagem' };
    expect(
      serializeConversationState(
        { id: 'c', status: 'open' },
        { botOn: false, personId: null, assigneeName: null, flow },
      ).flow,
    ).toEqual(flow);
  });
});
