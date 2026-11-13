// ============================================================
// What the browser needs to know about the built-in quiz models,
// without the models themselves (those stay on the server, in
// templates.ts, and travel only as summaries).
// ============================================================

import type { CrmNiche } from '@/lib/agencia/crm'
import type { QuizRoute } from './types'

export type QuizModelGroup = 'nicho' | 'geral' | 'interno'

export const MODEL_GROUP_LABEL: Record<QuizModelGroup, string> = {
  nicho: 'Por nicho',
  geral: 'Formulários e pesquisas',
  interno: 'Uso interno da Harpium',
}

/** Drawn by the "Novo quiz" window (components/quiz/model-icon.tsx). */
export type QuizModelIcon =
  | 'stethoscope'
  | 'smile'
  | 'sparkles'
  | 'dumbbell'
  | 'house'
  | 'scale'
  | 'graduation'
  | 'shopping'
  | 'briefcase'
  | 'sun'
  | 'mail'
  | 'star'
  | 'blank'
  | 'sofa'

/** What "Novo quiz" shows of a model, without sending the whole definition. */
export interface QuizModelSummary {
  key: string
  name: string
  segment: string | null
  description: string
  group: QuizModelGroup
  niche: CrmNiche | null
  icon: QuizModelIcon
  questions: number
  results: { name: string; route: QuizRoute }[]
}
