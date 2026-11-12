import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/leads/admin-client'
import {
  cleanLeadIds,
  deleteLeads,
  findTestContacts,
  loadLeadsToDelete,
} from '@/lib/leads/delete'

// Delete received leads (admins only), mostly tests.
//
//   { ids, preview: true }          → nothing is deleted; says which of
//                                     their contacts are test contacts
//                                     that could go with them.
//   { ids, delete_contacts?: bool } → deletes the leads and their notes;
//                                     with delete_contacts, the test
//                                     contacts too (see lib/leads/delete).
//
// The service role writes, but only after requireRole('admin') and
// always scoped to the caller's account.

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await request.json().catch(() => ({}))) as {
      ids?: unknown
      preview?: unknown
      delete_contacts?: unknown
    }
    const ids = cleanLeadIds(body.ids)
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Nenhum lead escolhido' }, { status: 400 })
    }
    const admin = supabaseAdmin()

    if (body.preview === true) {
      const leads = await loadLeadsToDelete(admin, ctx.accountId, ids)
      const tests = await findTestContacts(admin, ctx.accountId, leads)
      return NextResponse.json({
        ok: true,
        leads: leads.length,
        test_contacts: tests.map((t) => ({
          contact_id: t.contactId,
          name: t.name,
          lead_ids: t.leadIds,
        })),
      })
    }

    const result = await deleteLeads(admin, ctx.accountId, ids, {
      deleteContacts: body.delete_contacts === true,
    })
    return NextResponse.json({
      ok: true,
      leads_deleted: result.leadsDeleted,
      contacts_deleted: result.contactsDeleted,
      contacts_failed: result.contactsFailed,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
