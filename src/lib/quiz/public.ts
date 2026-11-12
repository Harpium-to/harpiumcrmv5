// ============================================================
// What the public page is allowed to know about a quiz.
//
// The browser needs the screens, the conditions and the rules, to show
// the next screen and the result at once. It does not need what the
// team calls things: the names of the results ("C · Desqualificado"),
// the tags ("verba-baixa") or the tag rules. Those stay on the server,
// which works the result out again on its own (submit.ts).
//
// Pure — no I/O.
// ============================================================

import type { QuizDefinition } from './types'

export interface PublicQuiz {
  slug: string
  /** The business the quiz belongs to, shown when there is no logo. */
  business: string
  definition: QuizDefinition
}

export function publicDefinition(def: QuizDefinition): QuizDefinition {
  return {
    ...def,
    results: def.results.map((r) => ({ ...r, name: '', tags: [] })),
    tagRules: [],
    settings: {
      pixelId: def.settings.pixelId,
      submittingText: def.settings.submittingText,
      privacyNote: def.settings.privacyNote,
      consentText: def.settings.consentText,
      privacyUrl: def.settings.privacyUrl,
      tags: [],
    },
  }
}
