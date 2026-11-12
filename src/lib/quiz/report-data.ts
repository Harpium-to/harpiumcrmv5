// ============================================================
// Reading what a quiz's report is made of. Server only.
//
// The visits are read with the caller's own client, so RLS decides
// what they may see: members of the CRM, nobody else. Read in pages
// (PostgREST answers at most 1 000 rows at a time), newest first.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { fetchAllRows } from '@/lib/reports/fetch-all'
import { REPORT_COLUMNS, type ReportSession } from './report'
import { getQuiz, type QuizRow } from './store'
import { sanitizeDefinition } from './validate'
import type { QuizDefinition } from './types'

export interface ReportData {
  quiz: QuizRow
  /** What visitors were shown: the live definition, or the draft before the first publish. */
  definition: QuizDefinition
  sessions: ReportSession[]
}

export async function loadReportData(
  db: SupabaseClient,
  accountId: string,
  quizId: string,
  since: string | null,
): Promise<ReportData | null> {
  const quiz = await getQuiz(db, accountId, quizId)
  if (!quiz) return null

  const sessions = await fetchAllRows<ReportSession>((from, to) => {
    let query = db
      .from('quiz_sessions')
      .select(REPORT_COLUMNS)
      .eq('account_id', accountId)
      .eq('quiz_id', quizId)
      .order('created_at', { ascending: false })
      .range(from, to)
    if (since) query = query.gte('created_at', since)
    return query as unknown as PromiseLike<{ data: ReportSession[] | null; error: { message: string } | null }>
  })

  return {
    quiz,
    definition: sanitizeDefinition(quiz.published ?? quiz.draft),
    sessions,
  }
}
