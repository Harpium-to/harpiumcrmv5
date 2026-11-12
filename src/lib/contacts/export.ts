import type { SupabaseClient } from '@supabase/supabase-js';

import type { CsvColumn } from '@/lib/reports/csv';

// ============================================================
// The CRM's contacts as a CSV, for the client to use elsewhere
// (Fase 9 of docs/plano-extensao-chrome.md). What the Contacts screen
// shows — the same search, the same tag filter — every page of it,
// with the tags and the stage of the open deal.
//
// Read through the person's own session (RLS): an account sees only
// its own contacts.
// ============================================================

const CHUNK = 1000;

export interface ExportRow {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  company: string | null;
  temperature: string | null;
  created_at: string;
  /** Migration 066; absent before it. */
  opted_out_at?: string | null;
  tags: string[];
  stage: string | null;
}

const TEMPERATURE: Record<string, string> = { cold: 'Frio', warm: 'Morno', hot: 'Quente' };

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
}

export const EXPORT_COLUMNS: CsvColumn<ExportRow>[] = [
  { header: 'Nome', value: (c) => c.name },
  { header: 'Telefone', value: (c) => c.phone },
  { header: 'Email', value: (c) => c.email },
  { header: 'Empresa', value: (c) => c.company },
  { header: 'Temperatura', value: (c) => (c.temperature ? TEMPERATURE[c.temperature] ?? c.temperature : '') },
  { header: 'Etiquetas', value: (c) => c.tags.join(', ') },
  { header: 'Etapa do negócio', value: (c) => c.stage },
  { header: 'Não quer receber', value: (c) => (c.opted_out_at ? 'Sim' : '') },
  { header: 'Criado em', value: (c) => formatDate(c.created_at) },
];

/** Search and tags as the Contacts screen sends them. Pure. */
export function parseExportFilters(url: URL): { search: string | null; tagIds: string[] } {
  const search = url.searchParams.get('search')?.trim() || null;
  const tagIds = (url.searchParams.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => /^[0-9a-f-]{36}$/i.test(t));
  return { search, tagIds };
}

type Base = Omit<ExportRow, 'tags' | 'stage'>;

/** Every contact the filters match, newest first. */
async function matchingContacts(
  db: SupabaseClient,
  search: string | null,
  tagIds: string[],
): Promise<Base[]> {
  const rows: Base[] = [];
  for (let from = 0; ; from += CHUNK) {
    let page: Base[];
    if (tagIds.length > 0) {
      // The same server-side filter the screen uses (migration 025).
      const { data, error } = await db.rpc('filter_contacts_by_tags', {
        p_tag_ids: tagIds,
        p_search: search,
        p_limit: CHUNK,
        p_offset: from,
      });
      if (error) throw error;
      page = ((data ?? []) as { contact: Base }[]).map((r) => r.contact);
    } else {
      let query = db
        .from('contacts')
        // `*` so opted_out_at (066) comes along once it exists.
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, from + CHUNK - 1);
      if (search) {
        const like = `%${search}%`;
        query = query.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      page = (data ?? []) as Base[];
    }
    rows.push(...page);
    if (page.length < CHUNK) break;
  }
  return rows;
}

export async function buildContactExport(
  db: SupabaseClient,
  filters: { search: string | null; tagIds: string[] },
): Promise<ExportRow[]> {
  const contacts = await matchingContacts(db, filters.search, filters.tagIds);
  if (contacts.length === 0) return [];

  const tagsByContact = new Map<string, string[]>();
  const stageByContact = new Map<string, string>();
  const { data: tags } = await db.from('tags').select('id, name');
  const tagName = new Map(((tags ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));

  for (let i = 0; i < contacts.length; i += CHUNK) {
    const ids = contacts.slice(i, i + CHUNK).map((c) => c.id);
    const { data: links } = await db.from('contact_tags').select('contact_id, tag_id').in('contact_id', ids);
    for (const l of (links ?? []) as { contact_id: string; tag_id: string }[]) {
      const name = tagName.get(l.tag_id);
      if (!name) continue;
      tagsByContact.set(l.contact_id, [...(tagsByContact.get(l.contact_id) ?? []), name]);
    }
    // The stage of the newest open deal, when there is one.
    const { data: deals } = await db
      .from('deals')
      .select('contact_id, created_at, stage:pipeline_stages(name)')
      .eq('status', 'open')
      .in('contact_id', ids)
      .order('created_at', { ascending: false });
    for (const d of (deals ?? []) as { contact_id: string; stage: { name?: string } | null }[]) {
      if (!stageByContact.has(d.contact_id) && d.stage?.name) stageByContact.set(d.contact_id, d.stage.name);
    }
  }

  return contacts.map((c) => ({
    ...c,
    tags: (tagsByContact.get(c.id) ?? []).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    stage: stageByContact.get(c.id) ?? null,
  }));
}
