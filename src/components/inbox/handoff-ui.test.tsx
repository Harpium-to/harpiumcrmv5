import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, useTranslations } from 'next-intl';

import messages from '../../../messages/pt.json';
import type { Conversation } from '@/types';
import type { WaitingConversation } from '@/hooks/use-waiting-conversations';

let pathname = '/dashboard';
let waiting: { items: WaitingConversation[]; lateCount: number; now: number } = {
  items: [],
  lateCount: 0,
  now: Date.now(),
};

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: () => {} }),
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ accountId: null, user: { id: 'me' } }) }));
vi.mock('@/hooks/use-waiting-conversations', () => ({
  useWaitingConversations: () => waiting,
}));

import { AiThreadBanner } from './ai-thread-banner';
import { WaitingAlert } from './waiting-alert';
import { ConversationItem } from './conversation-list';
import { waitInfo } from '@/lib/inbox/handoff-wait';

// One reference time for the whole file; the components' own clock is
// a few milliseconds later, which never changes the whole minutes.
const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('AiThreadBanner — handed off, nobody answered', () => {
  const banner = (props: { since: string | null; assigned?: string | null; disabled?: boolean }) =>
    render(
      <AiThreadBanner
        conversationId="c1"
        disabled={props.disabled ?? true}
        handoffSummary="Cliente quer orçamento de clareamento"
        needsHumanSince={props.since}
        assignedAgentId={props.assigned ?? null}
        currentUserId="me"
      />,
    );

  it('asks someone to take it, with the wait and the AI note', () => {
    const html = banner({ since: minutesAgo(3) });
    expect(html).toContain('Alguém precisa assumir');
    expect(html).toContain('Esperando resposta há 3 min');
    expect(html).toContain('Cliente quer orçamento de clareamento');
    expect(html).toContain('Assumir conversa');
    expect(html).toContain('Retomar IA');
    expect(html).toContain('bg-amber-400');
    expect(html).not.toContain('atrasada');
  });

  it('turns red and says late after the threshold', () => {
    const html = banner({ since: minutesAgo(25) });
    expect(html).toContain('bg-red-600');
    expect(html).toContain('atrasada');
  });

  it('tells the person who took it to reply, without a take-over button', () => {
    const html = banner({ since: minutesAgo(2), assigned: 'me' });
    expect(html).toContain('Você assumiu esta conversa. Responda o cliente.');
    expect(html).not.toContain('Assumir conversa');
  });

  it('says when it was just handed off', () => {
    expect(banner({ since: minutesAgo(0) })).toContain('Acabou de ser passada para a equipe');
  });

  it('shows nothing of this once someone has answered', () => {
    const html = banner({ since: null });
    expect(html).not.toContain('Alguém precisa assumir');
  });
});

describe('WaitingAlert — every screen but the inbox', () => {
  const items: WaitingConversation[] = [
    { id: 'c-old', since: minutesAgo(12), contactName: 'Maria', assignedAgentId: null },
    { id: 'c-new', since: minutesAgo(1), contactName: 'João', assignedAgentId: null },
  ];

  it('points to the longest wait and goes red when one is late', () => {
    pathname = '/pipelines';
    waiting = { items, lateCount: 1, now: Date.now() };
    const html = render(<WaitingAlert />);
    expect(html).toContain('2 conversas esperando atendente');
    expect(html).toContain('Maria espera há 12 min');
    expect(html).toContain('atrasada');
    expect(html).toContain('href="/inbox?c=c-old"');
    expect(html).toContain('bg-red-600');
  });

  it('is amber while nothing is late', () => {
    pathname = '/dashboard';
    waiting = { items: [items[1]], lateCount: 0, now: Date.now() };
    const html = render(<WaitingAlert />);
    expect(html).toContain('1 conversa esperando atendente');
    expect(html).toContain('bg-amber-400');
  });

  it('stays out of the inbox and away when nobody waits', () => {
    pathname = '/inbox';
    waiting = { items, lateCount: 1, now: Date.now() };
    expect(render(<WaitingAlert />)).toBe('');
    pathname = '/dashboard';
    waiting = { items: [], lateCount: 0, now: Date.now() };
    expect(render(<WaitingAlert />)).toBe('');
  });
});

describe('ConversationItem — the inbox row', () => {
  function Row({ conv }: { conv: Conversation }) {
    const t = useTranslations('Inbox.conversationList');
    return (
      <ConversationItem
        conversation={conv}
        isActive={false}
        onSelect={() => {}}
        t={t}
        wait={waitInfo(conv.needs_human_since, NOW)}
        currentUserId="me"
      />
    );
  }
  const conv = (extra: Partial<Conversation>): Conversation => ({
    id: 'c1',
    user_id: 'u',
    contact_id: 'k',
    status: 'open',
    unread_count: 0,
    created_at: minutesAgo(60),
    updated_at: minutesAgo(1),
    last_message_text: 'Quero falar com alguém',
    contact: { id: 'k', name: 'Maria', phone: '5511' } as Conversation['contact'],
    ...extra,
  });

  it('flags a waiting row nobody took', () => {
    const html = render(<Row conv={conv({ needs_human_since: minutesAgo(4) })} />);
    expect(html).toContain('Ninguém assumiu · 4 min');
    expect(html).toContain('border-amber-400');
  });

  it('says it is yours, in red once late', () => {
    const html = render(
      <Row conv={conv({ needs_human_since: minutesAgo(40), assigned_agent_id: 'me' })} />,
    );
    expect(html).toContain('Com você, sem resposta · 40 min');
    expect(html).toContain('border-red-600');
  });

  it('leaves ordinary rows alone', () => {
    const html = render(<Row conv={conv({})} />);
    expect(html).not.toContain('sem resposta');
    expect(html).not.toContain('Ninguém assumiu');
  });
});
