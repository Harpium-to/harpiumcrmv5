import { requireAgencia } from '@/lib/agencia/guard'
import { loadConsentGate } from '@/lib/agencia/consent'
import { ConsentWall } from '../consent-wall'
import { getAccountBoard, type BoardDeal } from '@/lib/agencia/queries'
import { BackToAccount } from '../parts'

export const dynamic = 'force-dynamic'

export default async function AgenciaPipelinePage({
  params,
}: {
  params: Promise<{ accountId: string }>
}) {
  const { accountId } = await params
  const { admin, userId, role } = await requireAgencia()
  // Deal titles and contact names are personal data: consent first.
  const gate = await loadConsentGate(admin, accountId, { userId, role })
  if (!gate.allowed) {
    return <ConsentWall accountId={accountId} gate={gate} what="os negócios do funil" />
  }
  const { stages } = await getAccountBoard(admin, accountId)

  return (
    <div className="space-y-5">
      <div>
        <BackToAccount accountId={accountId} />
        <h1 className="mt-2 text-2xl font-bold">Pipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Negócios por estágio · somente leitura
        </p>
      </div>

      {stages.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhum estágio de pipeline configurado.
        </p>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-3">
            {stages.map((s) => (
              <div
                key={s.id}
                className="flex w-72 shrink-0 flex-col rounded-xl border border-border bg-card"
              >
                <div className="border-b border-border px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{s.name}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {s.deals.length}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {s.pipelineName} · {formatAmount(s.total)}
                  </p>
                </div>
                <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-2">
                  {s.deals.length === 0 ? (
                    <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                      Vazio
                    </p>
                  ) : (
                    s.deals.map((d) => <DealCard key={d.id} deal={d} />)
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DealCard({ deal }: { deal: BoardDeal }) {
  return (
    <div className="rounded-lg border border-border bg-background p-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-tight">{deal.title}</p>
        {deal.status && deal.status !== 'active' && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${
              deal.status === 'won'
                ? 'bg-emerald-500/10 text-emerald-500'
                : deal.status === 'lost'
                  ? 'bg-red-500/10 text-red-500'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {deal.status}
          </span>
        )}
      </div>
      {deal.contactName && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {deal.contactName}
        </p>
      )}
      <p className="mt-1 text-xs font-medium text-muted-foreground">
        {deal.currency ? `${deal.currency} ` : ''}
        {formatAmount(deal.value)}
      </p>
    </div>
  )
}

function formatAmount(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
