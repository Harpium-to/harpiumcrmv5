// ============================================================
// Agency console data access — all reads go through the service-role
// `admin` client (RLS-bypassing), so these helpers must ONLY be called
// from a context that already passed `requireAgencia()`/`loadAgencia()`.
//
// The overview deliberately avoids an N+1 over accounts: it pulls one
// slim column set per domain table and tallies in JS. Fine for the
// instance-wide operator view; revisit with a SQL view/RPC if account
// counts grow into the thousands.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import type { CrmStatus } from './crm'
import { loadAccountRows, loadPendingOwnerInvites } from './crms'

interface Membership {
  user_id: string
  account_id: string
  role: string
}

/**
 * Who belongs to which CRM. Since migration 049 that is
 * `account_members` (a user can be in several CRMs, and
 * `profiles.account_id` is only the one they have open). Before 049
 * the table doesn't exist and the profile row is the membership.
 */
async function loadMemberships(
  admin: SupabaseClient,
  accountId?: string,
): Promise<Membership[]> {
  let q = admin.from('account_members').select('user_id, account_id, role')
  if (accountId) q = q.eq('account_id', accountId)
  const { data, error } = await q
  if (!error) return data ?? []
  if (!isMissingTable(error)) throw error

  let legacy = admin.from('profiles').select('user_id, account_id, account_role')
  if (accountId) legacy = legacy.eq('account_id', accountId)
  const { data: rows, error: legacyErr } = await legacy
  if (legacyErr) throw legacyErr
  return (rows ?? [])
    .filter((r) => r.account_id && r.account_role)
    .map((r) => ({ user_id: r.user_id, account_id: r.account_id, role: r.account_role }))
}

export interface AccountOverview {
  id: string
  name: string
  ownerUserId: string
  /** Email of the member who owns it; null while the owner hasn't accepted. */
  ownerEmail: string | null
  /** Open owner invitation (050), when there is one. */
  pendingOwnerEmail: string | null
  status: CrmStatus
  niche: string | null
  managerUserId: string | null
  managerEmail: string | null
  /** When the status last changed (050); null before. */
  statusChangedAt: string | null
  createdAt: string
  memberCount: number
  contactCount: number
  openConversationCount: number
  openDealCount: number
  openDealValue: number
}

/**
 * One row per account (client) with rolled-up counts for the console
 * landing table. Five queries total, independent of account count.
 */
export async function listAccountsOverview(
  admin: SupabaseClient,
): Promise<AccountOverview[]> {
  const [
    accounts,
    pendingOwners,
    profilesRes,
    memberships,
    contactsRes,
    conversationsRes,
    dealsRes,
  ] = await Promise.all([
    loadAccountRows(admin),
    loadPendingOwnerInvites(admin),
    admin.from('profiles').select('user_id, email'),
    loadMemberships(admin),
    admin.from('contacts').select('account_id'),
    admin.from('conversations').select('account_id, status'),
    admin.from('deals').select('account_id, value, status'),
  ])

  if (profilesRes.error) throw profilesRes.error
  if (contactsRes.error) throw contactsRes.error
  if (conversationsRes.error) throw conversationsRes.error
  if (dealsRes.error) throw dealsRes.error

  const emailByUser = new Map<string, string | null>()
  for (const p of profilesRes.data ?? []) {
    emailByUser.set(p.user_id, p.email ?? null)
  }
  const memberCount = tally(memberships, (m) => m.account_id)
  // The owner is whoever holds the owner membership. accounts.owner_user_id
  // can be the agency's placeholder until the client accepts (050).
  const ownerByAccount = new Map<string, string>()
  for (const m of memberships) {
    if (m.role === 'owner') ownerByAccount.set(m.account_id, m.user_id)
  }

  const contactCount = tally(contactsRes.data ?? [], (r) => r.account_id)

  const openConversationCount = tally(
    (conversationsRes.data ?? []).filter((c) => c.status !== 'closed'),
    (r) => r.account_id,
  )

  const openDeals = (dealsRes.data ?? []).filter(
    (d) => d.status !== 'won' && d.status !== 'lost',
  )
  const openDealCount = tally(openDeals, (r) => r.account_id)
  const openDealValue = new Map<string, number>()
  for (const d of openDeals) {
    openDealValue.set(
      d.account_id,
      (openDealValue.get(d.account_id) ?? 0) + Number(d.value ?? 0),
    )
  }

  return accounts.map((a) => {
    const owner = ownerByAccount.get(a.id)
    return {
      id: a.id,
      name: a.name,
      ownerUserId: owner ?? a.owner_user_id,
      ownerEmail: owner ? (emailByUser.get(owner) ?? null) : null,
      pendingOwnerEmail: pendingOwners.get(a.id)?.email ?? null,
      status: a.status,
      niche: a.niche,
      managerUserId: a.manager_user_id,
      managerEmail: a.manager_user_id
        ? (emailByUser.get(a.manager_user_id) ?? null)
        : null,
      statusChangedAt: a.status_changed_at,
      createdAt: a.created_at,
      memberCount: memberCount.get(a.id) ?? 0,
      contactCount: contactCount.get(a.id) ?? 0,
      openConversationCount: openConversationCount.get(a.id) ?? 0,
      openDealCount: openDealCount.get(a.id) ?? 0,
      openDealValue: openDealValue.get(a.id) ?? 0,
    }
  })
}

export interface AccountContactRow {
  id: string
  name: string | null
  phone: string
  email: string | null
  company?: string | null
  createdAt: string
}

export interface AccountConversationRow {
  id: string
  contactName: string | null
  status: string
  lastMessageText: string | null
  lastMessageAt: string | null
}

export interface AccountStageRow {
  id: string
  pipelineName: string
  name: string
  dealCount: number
  dealValue: number
}

export interface AccountDetail {
  account: { id: string; name: string; ownerEmail: string | null; createdAt: string }
  members: { email: string | null; role: string }[]
  stats: {
    contactCount: number
    openConversationCount: number
    openDealCount: number
    openDealValue: number
  }
  recentContacts: AccountContactRow[]
  recentConversations: AccountConversationRow[]
  stages: AccountStageRow[]
}

/**
 * Full supervision view of a single account: header, members, headline
 * stats, pipeline (stages with deal roll-ups), and recent
 * contacts/conversations. Returns null when the account id is unknown.
 *
 * `personal: false` (the CRM owner granted the agency only metrics,
 * Fase 3) skips every read of personal data: no recent contacts or
 * conversations are fetched, and members come back without emails.
 */
export async function getAccountDetail(
  admin: SupabaseClient,
  accountId: string,
  opts: { personal?: boolean } = {},
): Promise<AccountDetail | null> {
  const personal = opts.personal ?? true
  const none = Promise.resolve({ data: [], error: null })
  const { data: account, error: accountErr } = await admin
    .from('accounts')
    .select('id, name, owner_user_id, created_at')
    .eq('id', accountId)
    .maybeSingle()
  if (accountErr) throw accountErr
  if (!account) return null

  const memberships = await loadMemberships(admin, accountId)
  const memberIds = memberships.map((m) => m.user_id)

  const [
    profilesRes,
    contactsRes,
    conversationsRes,
    pipelinesRes,
    dealsRes,
  ] = await Promise.all([
    admin
      .from('profiles')
      .select('user_id, email')
      .in('user_id', [...new Set([...memberIds, account.owner_user_id])]),
    personal
      ? admin
          .from('contacts')
          .select('id, name, phone, email, created_at')
          .eq('account_id', accountId)
          .order('created_at', { ascending: false })
          .limit(10)
      : none,
    personal
      ? admin
          .from('conversations')
          .select('id, contact_id, status, last_message_text, last_message_at')
          .eq('account_id', accountId)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(10)
      : none,
    admin.from('pipelines').select('id, name').eq('account_id', accountId),
    admin
      .from('deals')
      .select('id, stage_id, value, status')
      .eq('account_id', accountId),
  ])

  if (profilesRes.error) throw profilesRes.error
  if (contactsRes.error) throw contactsRes.error
  if (conversationsRes.error) throw conversationsRes.error
  if (pipelinesRes.error) throw pipelinesRes.error
  if (dealsRes.error) throw dealsRes.error

  // The owner membership, not accounts.owner_user_id: for a CRM the
  // agency created that is a placeholder until the client accepts (050).
  const ownerId = memberships.find((m) => m.role === 'owner')?.user_id
  const ownerEmail = ownerId
    ? ((profilesRes.data ?? []).find((p) => p.user_id === ownerId)?.email ??
      null)
    : null

  // Resolve contact names for the recent conversations in one round trip.
  const convContactIds = Array.from(
    new Set(
      (conversationsRes.data ?? [])
        .map((c) => c.contact_id)
        .filter((id): id is string => Boolean(id)),
    ),
  )
  const contactNameById = new Map<string, string | null>()
  if (convContactIds.length > 0) {
    const { data: convContacts, error: convContactsErr } = await admin
      .from('contacts')
      .select('id, name, phone')
      .in('id', convContactIds)
    if (convContactsErr) throw convContactsErr
    for (const c of convContacts ?? []) {
      contactNameById.set(c.id, c.name ?? c.phone ?? null)
    }
  }

  // Pipeline stages, keyed to their pipeline for display.
  const pipelineNameById = new Map<string, string>()
  for (const p of pipelinesRes.data ?? []) pipelineNameById.set(p.id, p.name)
  const pipelineIds = (pipelinesRes.data ?? []).map((p) => p.id)

  let stages: AccountStageRow[] = []
  if (pipelineIds.length > 0) {
    const { data: stageRows, error: stagesErr } = await admin
      .from('pipeline_stages')
      .select('id, pipeline_id, name, position')
      .in('pipeline_id', pipelineIds)
      .order('position', { ascending: true })
    if (stagesErr) throw stagesErr

    const dealCountByStage = new Map<string, number>()
    const dealValueByStage = new Map<string, number>()
    for (const d of dealsRes.data ?? []) {
      if (!d.stage_id) continue
      dealCountByStage.set(d.stage_id, (dealCountByStage.get(d.stage_id) ?? 0) + 1)
      dealValueByStage.set(
        d.stage_id,
        (dealValueByStage.get(d.stage_id) ?? 0) + Number(d.value ?? 0),
      )
    }

    stages = (stageRows ?? []).map((s) => ({
      id: s.id,
      pipelineName: pipelineNameById.get(s.pipeline_id) ?? '—',
      name: s.name,
      dealCount: dealCountByStage.get(s.id) ?? 0,
      dealValue: dealValueByStage.get(s.id) ?? 0,
    }))
  }

  const openDeals = (dealsRes.data ?? []).filter(
    (d) => d.status !== 'won' && d.status !== 'lost',
  )

  // contactCount / openConversationCount are full-account totals, so they
  // use exact head counts rather than the limited recent lists above.
  const [contactCountRes, openConvCountRes] = await Promise.all([
    admin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId),
    admin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .neq('status', 'closed'),
  ])
  if (contactCountRes.error) throw contactCountRes.error
  if (openConvCountRes.error) throw openConvCountRes.error

  return {
    account: {
      id: account.id,
      name: account.name,
      ownerEmail,
      createdAt: account.created_at,
    },
    members: memberships.map((m) => ({
      email: personal
        ? ((profilesRes.data ?? []).find((p) => p.user_id === m.user_id)
            ?.email ?? null)
        : null,
      role: m.role ?? '—',
    })),
    stats: {
      contactCount: contactCountRes.count ?? 0,
      openConversationCount: openConvCountRes.count ?? 0,
      openDealCount: openDeals.length,
      openDealValue: openDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0),
    },
    recentContacts: (contactsRes.data ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? null,
      phone: c.phone,
      email: c.email ?? null,
      createdAt: c.created_at,
    })),
    recentConversations: (conversationsRes.data ?? []).map((c) => ({
      id: c.id,
      contactName: c.contact_id
        ? contactNameById.get(c.contact_id) ?? null
        : null,
      status: c.status,
      lastMessageText: c.last_message_text ?? null,
      lastMessageAt: c.last_message_at ?? null,
    })),
    stages,
  }
}

export interface AgencyAttention {
  accountId: string
  name: string
  /** No message in the last 14 days. */
  inactive: boolean
  /** Open/pending conversations with no assigned agent. */
  backlog: number
  /** No connected whatsapp_config. */
  whatsappDisconnected: boolean
}

export interface AgencyOverview {
  wonDealCount30d: number
  wonDealValue30d: number
  /** 30-day global message volume, oldest first. */
  dailyMessages: { day: string; incoming: number; outgoing: number }[]
  /** Accounts ranked by message volume over the window, most first. */
  ranking: { accountId: string; name: string; messageCount: number }[]
  /** Accounts with at least one attention signal, most-actionable first. */
  attention: AgencyAttention[]
}

const INACTIVE_DAYS = 14
const RANKING_LIMIT = 5

/** Allowed metric windows (days) for the period selector. */
export const METRIC_WINDOWS = [7, 30, 90] as const
export type MetricWindow = (typeof METRIC_WINDOWS)[number]

export function parseMetricWindow(value: string | undefined): MetricWindow {
  const n = Number(value)
  return (METRIC_WINDOWS as readonly number[]).includes(n)
    ? (n as MetricWindow)
    : 30
}

/**
 * Agency-wide roll-up for the /agencia home band: totals come from
 * `listAccountsOverview` (summed in the page); this adds the
 * cross-account message volume, the activity ranking, and the
 * "went quiet" list — all from a single 30-day message pull (messages
 * has no account_id, so it's joined to its parent conversation).
 * Global scale for now; move to a SQL view/RPC if volume explodes.
 */
export async function getAgencyOverview(
  admin: SupabaseClient,
  windowDays: number = 30,
): Promise<AgencyOverview> {
  const now = Date.now()
  const sinceWindow = new Date(now - windowDays * DAY_MS).toISOString()
  const since14 = new Date(now - INACTIVE_DAYS * DAY_MS).toISOString()
  // Fetch messages far enough back to keep the 14-day inactivity check
  // correct even when the metric window is shorter (e.g. 7 days).
  const sinceFetch = new Date(
    now - Math.max(windowDays, INACTIVE_DAYS) * DAY_MS,
  ).toISOString()

  const dayKeys: string[] = []
  for (let i = windowDays - 1; i >= 0; i--) {
    dayKeys.push(new Date(now - i * DAY_MS).toISOString().slice(0, 10))
  }

  const [accountsRes, wonRes, msgsRes, convRes, waRes] = await Promise.all([
    admin.from('accounts').select('id, name'),
    admin
      .from('deals')
      .select('value')
      .eq('status', 'won')
      .gte('updated_at', sinceWindow),
    admin
      .from('messages')
      .select('sender_type, created_at, conversations!inner(account_id)')
      .gte('created_at', sinceFetch),
    admin
      .from('conversations')
      .select('account_id, status, assigned_agent_id')
      .neq('status', 'closed'),
    admin.from('whatsapp_config').select('account_id, status'),
  ])

  if (accountsRes.error) throw accountsRes.error
  if (wonRes.error) throw wonRes.error
  if (msgsRes.error) throw msgsRes.error
  if (convRes.error) throw convRes.error
  if (waRes.error) throw waRes.error

  const nameById = new Map<string, string>()
  for (const a of accountsRes.data ?? []) nameById.set(a.id, a.name)

  const daily = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of dayKeys) daily.set(k, { incoming: 0, outgoing: 0 })

  const msgCountByAccount = new Map<string, number>()
  const activeIn14 = new Set<string>()

  for (const m of (msgsRes.data ?? []) as Array<{
    sender_type: string
    created_at: string
    conversations: { account_id: string } | { account_id: string }[] | null
  }>) {
    const conv = Array.isArray(m.conversations)
      ? m.conversations[0]
      : m.conversations
    const accountId = conv?.account_id
    const inbound = m.sender_type === 'customer'

    const bucket = daily.get(m.created_at.slice(0, 10))
    if (bucket) {
      if (inbound) bucket.incoming++
      else bucket.outgoing++
    }

    if (accountId) {
      // Ranking counts messages within the selected window; inactivity
      // uses the fixed 14-day threshold.
      if (m.created_at >= sinceWindow) {
        msgCountByAccount.set(
          accountId,
          (msgCountByAccount.get(accountId) ?? 0) + 1,
        )
      }
      if (m.created_at >= since14) activeIn14.add(accountId)
    }
  }

  const ranking = [...msgCountByAccount.entries()]
    .map(([accountId, messageCount]) => ({
      accountId,
      name: nameById.get(accountId) ?? '—',
      messageCount,
    }))
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, RANKING_LIMIT)

  // Backlog: open/pending conversations (status already filtered to
  // non-closed) with no agent assigned, counted per account.
  const backlogByAccount = new Map<string, number>()
  for (const c of (convRes.data ?? []) as Array<{
    account_id: string
    assigned_agent_id: string | null
  }>) {
    if (!c.assigned_agent_id) {
      backlogByAccount.set(
        c.account_id,
        (backlogByAccount.get(c.account_id) ?? 0) + 1,
      )
    }
  }

  // An account counts as WhatsApp-connected only if it has a config row
  // whose status is 'connected'. Missing row or 'disconnected' → flagged.
  const connected = new Set<string>()
  for (const w of (waRes.data ?? []) as Array<{
    account_id: string
    status: string
  }>) {
    if (w.status === 'connected') connected.add(w.account_id)
  }

  const attention = (accountsRes.data ?? [])
    .map((a) => ({
      accountId: a.id,
      name: a.name,
      inactive: !activeIn14.has(a.id),
      backlog: backlogByAccount.get(a.id) ?? 0,
      whatsappDisconnected: !connected.has(a.id),
    }))
    .filter((a) => a.inactive || a.backlog > 0 || a.whatsappDisconnected)
    // Most actionable first: biggest backlog, then disconnected, then quiet.
    .sort(
      (a, b) =>
        b.backlog - a.backlog ||
        Number(b.whatsappDisconnected) - Number(a.whatsappDisconnected) ||
        Number(b.inactive) - Number(a.inactive),
    )

  return {
    wonDealCount30d: (wonRes.data ?? []).length,
    wonDealValue30d: (wonRes.data ?? []).reduce(
      (sum, d) => sum + Number(d.value ?? 0),
      0,
    ),
    dailyMessages: dayKeys.map((day) => ({ day, ...daily.get(day)! })),
    ranking,
    attention,
  }
}

export interface AccountMetrics {
  windowDays: number
  newContacts: number
  newConversations: number
  incomingMessages: number
  outgoingMessages: number
  wonDealsCount: number
  wonDealsValue: number
  /** Last 14 days of message volume, oldest first, for the mini chart. */
  dailyMessages: { day: string; incoming: number; outgoing: number }[]
}

const DAY_MS = 86_400_000

/**
 * Rolled-up analysis KPIs for a single account over the selected window,
 * plus a matching daily message-volume series. `messages` has no
 * account_id, so it's filtered through an inner join on its parent
 * conversation. Day bucketing uses UTC — good enough for a supervision
 * overview.
 */
export async function getAccountMetrics(
  admin: SupabaseClient,
  accountId: string,
  windowDays: number = 30,
): Promise<AccountMetrics> {
  const now = Date.now()
  const since = new Date(now - windowDays * DAY_MS).toISOString()

  const dayKeys: string[] = []
  for (let i = windowDays - 1; i >= 0; i--) {
    dayKeys.push(new Date(now - i * DAY_MS).toISOString().slice(0, 10))
  }

  const [contactsRes, convRes, msgsRes, dealsRes] = await Promise.all([
    admin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .gte('created_at', since),
    admin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .gte('created_at', since),
    admin
      .from('messages')
      .select('sender_type, created_at, conversations!inner(account_id)')
      .eq('conversations.account_id', accountId)
      .gte('created_at', since),
    admin.from('deals').select('value, status').eq('account_id', accountId),
  ])

  if (contactsRes.error) throw contactsRes.error
  if (convRes.error) throw convRes.error
  if (msgsRes.error) throw msgsRes.error
  if (dealsRes.error) throw dealsRes.error

  const daily = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of dayKeys) daily.set(k, { incoming: 0, outgoing: 0 })

  let incomingMessages = 0
  let outgoingMessages = 0
  for (const m of (msgsRes.data ?? []) as { sender_type: string; created_at: string }[]) {
    const inbound = m.sender_type === 'customer'
    if (inbound) incomingMessages++
    else outgoingMessages++
    const bucket = daily.get(m.created_at.slice(0, 10))
    if (bucket) {
      if (inbound) bucket.incoming++
      else bucket.outgoing++
    }
  }

  const wonDeals = (dealsRes.data ?? []).filter((d) => d.status === 'won')

  return {
    windowDays,
    newContacts: contactsRes.count ?? 0,
    newConversations: convRes.count ?? 0,
    incomingMessages,
    outgoingMessages,
    wonDealsCount: wonDeals.length,
    wonDealsValue: wonDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0),
    dailyMessages: dayKeys.map((day) => ({ day, ...daily.get(day)! })),
  }
}

export interface ThreadMessage {
  id: string
  senderType: 'customer' | 'agent' | 'bot'
  contentType: string
  contentText: string | null
  mediaUrl: string | null
  templateName: string | null
  status: string
  createdAt: string
}

export interface ConversationThread {
  conversation: { id: string; status: string; createdAt: string }
  contact: {
    id: string
    name: string | null
    phone: string
    email: string | null
  } | null
  messages: ThreadMessage[]
}

// Cap on messages loaded for a single thread. Read-only analysis view;
// a 500-message window is deep enough to review a conversation without
// shipping an unbounded payload for pathologically long threads.
const THREAD_MESSAGE_LIMIT = 500

/**
 * Full read-only message thread for one conversation, scoped to the
 * account so a conversation id from another account can't be opened.
 * Returns null when the conversation doesn't belong to `accountId`.
 */
export async function getConversationThread(
  admin: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<ConversationThread | null> {
  const { data: conversation, error: convErr } = await admin
    .from('conversations')
    .select('id, account_id, contact_id, status, created_at')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (convErr) throw convErr
  if (!conversation) return null

  const [contactRes, messagesRes] = await Promise.all([
    conversation.contact_id
      ? admin
          .from('contacts')
          .select('id, name, phone, email')
          .eq('id', conversation.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from('messages')
      .select(
        'id, sender_type, content_type, content_text, media_url, template_name, status, created_at',
      )
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(THREAD_MESSAGE_LIMIT),
  ])
  if (contactRes.error) throw contactRes.error
  if (messagesRes.error) throw messagesRes.error

  return {
    conversation: {
      id: conversation.id,
      status: conversation.status,
      createdAt: conversation.created_at,
    },
    contact: contactRes.data
      ? {
          id: contactRes.data.id,
          name: contactRes.data.name ?? null,
          phone: contactRes.data.phone,
          email: contactRes.data.email ?? null,
        }
      : null,
    messages: (messagesRes.data ?? []).map((m) => ({
      id: m.id,
      senderType: m.sender_type,
      contentType: m.content_type,
      contentText: m.content_text ?? null,
      mediaUrl: m.media_url ?? null,
      templateName: m.template_name ?? null,
      status: m.status,
      createdAt: m.created_at,
    })),
  }
}

// ============================================================
// Full paginated lists + pipeline board for the deep per-account views.
// ============================================================

export interface Paged<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

function pageRange(page: number, pageSize: number): [number, number] {
  const from = (page - 1) * pageSize
  return [from, from + pageSize - 1]
}

// PostgREST's `or=(...)` filter is a single parsed string, so commas /
// parens / wildcards in the user's query would break it. Strip them.
function sanitizeOrTerm(q: string): string {
  return q.replace(/[,()%*\\]/g, ' ').trim()
}

export interface ContactListOpts {
  page?: number
  pageSize?: number
  q?: string
}

/** Full contacts list for an account, newest first, paginated + searchable. */
export async function listAccountContacts(
  admin: SupabaseClient,
  accountId: string,
  { page = 1, pageSize = 50, q }: ContactListOpts = {},
): Promise<Paged<AccountContactRow>> {
  const [from, to] = pageRange(page, pageSize)
  let query = admin
    .from('contacts')
    .select('id, name, phone, email, company, created_at', { count: 'exact' })
    .eq('account_id', accountId)

  const term = q ? sanitizeOrTerm(q) : ''
  if (term) {
    query = query.or(
      `name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,company.ilike.%${term}%`,
    )
  }

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) throw error

  return {
    rows: (data ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? null,
      phone: c.phone,
      email: c.email ?? null,
      company: c.company ?? null,
      createdAt: c.created_at,
    })),
    total: count ?? 0,
    page,
    pageSize,
  }
}

export type ConversationStatusFilter = 'all' | 'open' | 'pending' | 'closed'

export interface ConversationListOpts {
  page?: number
  pageSize?: number
  q?: string
  status?: ConversationStatusFilter
}

/** Full conversations list for an account, most recent first, paginated + filterable. */
export async function listAccountConversations(
  admin: SupabaseClient,
  accountId: string,
  { page = 1, pageSize = 25, q, status = 'all' }: ConversationListOpts = {},
): Promise<Paged<AccountConversationRow & { id: string }>> {
  const [from, to] = pageRange(page, pageSize)
  let query = admin
    .from('conversations')
    .select('id, contact_id, status, last_message_text, last_message_at', {
      count: 'exact',
    })
    .eq('account_id', accountId)

  if (status !== 'all') query = query.eq('status', status)
  if (q && q.trim()) query = query.ilike('last_message_text', `%${q.trim()}%`)

  const { data, count, error } = await query
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range(from, to)
  if (error) throw error

  const contactIds = Array.from(
    new Set(
      (data ?? [])
        .map((c) => c.contact_id)
        .filter((id): id is string => Boolean(id)),
    ),
  )
  const nameById = new Map<string, string | null>()
  if (contactIds.length > 0) {
    const { data: contacts, error: cErr } = await admin
      .from('contacts')
      .select('id, name, phone')
      .in('id', contactIds)
    if (cErr) throw cErr
    for (const c of contacts ?? []) nameById.set(c.id, c.name ?? c.phone ?? null)
  }

  return {
    rows: (data ?? []).map((c) => ({
      id: c.id,
      contactName: c.contact_id ? nameById.get(c.contact_id) ?? null : null,
      status: c.status,
      lastMessageText: c.last_message_text ?? null,
      lastMessageAt: c.last_message_at ?? null,
    })),
    total: count ?? 0,
    page,
    pageSize,
  }
}

export interface BoardDeal {
  id: string
  title: string
  value: number
  currency: string | null
  status: string | null
  contactName: string | null
}

export interface BoardStage {
  id: string
  name: string
  pipelineName: string
  deals: BoardDeal[]
  total: number
}

/**
 * Pipeline board for an account: every stage with its deals grouped
 * into columns, for a kanban-style read-only view.
 */
export async function getAccountBoard(
  admin: SupabaseClient,
  accountId: string,
): Promise<{ stages: BoardStage[] }> {
  const [pipelinesRes, dealsRes] = await Promise.all([
    admin.from('pipelines').select('id, name').eq('account_id', accountId),
    admin
      .from('deals')
      .select('id, stage_id, title, value, currency, status, contact_id')
      .eq('account_id', accountId),
  ])
  if (pipelinesRes.error) throw pipelinesRes.error
  if (dealsRes.error) throw dealsRes.error

  const pipelineIds = (pipelinesRes.data ?? []).map((p) => p.id)
  if (pipelineIds.length === 0) return { stages: [] }

  const { data: stageRows, error: stagesErr } = await admin
    .from('pipeline_stages')
    .select('id, pipeline_id, name, position')
    .in('pipeline_id', pipelineIds)
    .order('position', { ascending: true })
  if (stagesErr) throw stagesErr

  // Contact names for the deals, resolved in one round trip.
  const contactIds = Array.from(
    new Set(
      (dealsRes.data ?? [])
        .map((d) => d.contact_id)
        .filter((id): id is string => Boolean(id)),
    ),
  )
  const nameById = new Map<string, string | null>()
  if (contactIds.length > 0) {
    const { data: contacts, error: cErr } = await admin
      .from('contacts')
      .select('id, name, phone')
      .in('id', contactIds)
    if (cErr) throw cErr
    for (const c of contacts ?? []) nameById.set(c.id, c.name ?? c.phone ?? null)
  }

  const pipelineNameById = new Map<string, string>()
  for (const p of pipelinesRes.data ?? []) pipelineNameById.set(p.id, p.name)

  const dealsByStage = new Map<string, BoardDeal[]>()
  for (const d of dealsRes.data ?? []) {
    if (!d.stage_id) continue
    const list = dealsByStage.get(d.stage_id) ?? []
    list.push({
      id: d.id,
      title: d.title,
      value: Number(d.value ?? 0),
      currency: d.currency ?? null,
      status: d.status ?? null,
      contactName: d.contact_id ? nameById.get(d.contact_id) ?? null : null,
    })
    dealsByStage.set(d.stage_id, list)
  }

  const stages: BoardStage[] = (stageRows ?? []).map((s) => {
    const deals = dealsByStage.get(s.id) ?? []
    return {
      id: s.id,
      name: s.name,
      pipelineName: pipelineNameById.get(s.pipeline_id) ?? '—',
      deals,
      total: deals.reduce((sum, d) => sum + d.value, 0),
    }
  })

  return { stages }
}

// ============================================================
// Access audit log (migration 038).
// ============================================================

export type AgenciaAction =
  | 'view_account'
  | 'view_conversation'
  | 'export_contacts'

/**
 * Record a privileged access. Fire-and-forget from the caller's point of
 * view — it never throws, so a missing audit table (migration 038 not yet
 * applied) or a transient error can't break the page it's logging.
 */
export async function logAgenciaAccess(
  admin: SupabaseClient,
  entry: {
    actorUserId: string
    action: AgenciaAction
    accountId?: string
    conversationId?: string
  },
): Promise<void> {
  const { error } = await admin.from('agencia_auditoria').insert({
    actor_user_id: entry.actorUserId,
    account_id: entry.accountId ?? null,
    conversation_id: entry.conversationId ?? null,
    action: entry.action,
  })
  if (error) {
    console.warn('[agencia audit] insert failed:', error.message)
  }
}

export interface AuditRow {
  id: string
  action: string
  createdAt: string
  actorEmail: string | null
  accountName: string | null
  conversationId: string | null
}

function isMissingTable(err: { code?: string; message?: string }): boolean {
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    /schema cache|does not exist/i.test(err.message ?? '')
  )
}

/**
 * Paginated audit log with actor email + account name resolved. Returns
 * `available: false` (rather than throwing) when the table doesn't exist
 * yet, so the page can prompt to apply migration 038.
 */
export async function listAudit(
  admin: SupabaseClient,
  page = 1,
  pageSize = 50,
): Promise<Paged<AuditRow> & { available: boolean }> {
  const [from, to] = pageRange(page, pageSize)
  const { data, count, error } = await admin
    .from('agencia_auditoria')
    .select(
      'id, actor_user_id, account_id, conversation_id, action, created_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    if (isMissingTable(error)) {
      return { available: false, rows: [], total: 0, page, pageSize }
    }
    throw error
  }

  const userIds = Array.from(
    new Set((data ?? []).map((r) => r.actor_user_id).filter(Boolean)),
  )
  const accountIds = Array.from(
    new Set(
      (data ?? [])
        .map((r) => r.account_id)
        .filter((id): id is string => Boolean(id)),
    ),
  )

  const emailById = new Map<string, string | null>()
  const accountNameById = new Map<string, string>()
  await Promise.all([
    userIds.length > 0
      ? admin
          .from('profiles')
          .select('user_id, email')
          .in('user_id', userIds)
          .then(({ data: profs }) => {
            for (const p of profs ?? []) emailById.set(p.user_id, p.email ?? null)
          })
      : Promise.resolve(),
    accountIds.length > 0
      ? admin
          .from('accounts')
          .select('id, name')
          .in('id', accountIds)
          .then(({ data: accs }) => {
            for (const a of accs ?? []) accountNameById.set(a.id, a.name)
          })
      : Promise.resolve(),
  ])

  return {
    available: true,
    rows: (data ?? []).map((r) => ({
      id: r.id,
      action: r.action,
      createdAt: r.created_at,
      actorEmail: emailById.get(r.actor_user_id) ?? null,
      accountName: r.account_id ? accountNameById.get(r.account_id) ?? null : null,
      conversationId: r.conversation_id ?? null,
    })),
    total: count ?? 0,
    page,
    pageSize,
  }
}

function tally<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    const k = key(r)
    out.set(k, (out.get(k) ?? 0) + 1)
  }
  return out
}
