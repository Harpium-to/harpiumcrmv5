// ============================================================
// The Radar (docs/plano-radar-monitoramento.md). Importing this module
// wires the daily steps of every phase into the scheduler, in order:
// anomalies (Fase 2) → chances (Fase 3) → the weekly digest (Fase 4).
// ============================================================

import { detectarStep } from './alertas'
import { chancesStep } from './chance'
import { registerDailyStep } from './livro'
import { resumoStep } from './resumo'

registerDailyStep(detectarStep)
registerDailyStep(chancesStep)
registerDailyStep(resumoStep)

export { processarRadar } from './livro'
