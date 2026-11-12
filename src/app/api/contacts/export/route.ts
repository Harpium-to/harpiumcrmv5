import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { buildContactExport, EXPORT_COLUMNS, parseExportFilters } from '@/lib/contacts/export';
import { csvResponse, slugForFilename, toCsv } from '@/lib/reports/csv';

// GET /api/contacts/export?search=&tags=<id,id> — the Contacts screen's
// list as a CSV (Fase 9): the same search and tag filter, every page,
// with tags and the open deal's stage. Admins only: it hands out the
// whole contact list at once. Read through the admin's own session, so
// RLS keeps it to their CRM.
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const rows = await buildContactExport(supabase, parseExportFilters(new URL(request.url)));
    const { data: account } = await supabase
      .from('accounts')
      .select('name')
      .eq('id', accountId)
      .maybeSingle();
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `contatos-${slugForFilename((account?.name as string | undefined) ?? 'crm')}-${stamp}.csv`;
    return csvResponse(toCsv(rows, EXPORT_COLUMNS), filename);
  } catch (err) {
    return toErrorResponse(err);
  }
}
