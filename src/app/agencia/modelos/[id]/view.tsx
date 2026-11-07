import { parseTemplateContent, TRIGGER_LABEL, type TemplateStep } from '@/lib/agencia/templates'

/** What a template will create, readable — no JSON. */
export function TemplateView({ content }: { content: unknown }) {
  const parsed = parseTemplateContent(content)
  if (!parsed.ok) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm">
        <p className="font-medium">Este modelo tem problemas e pode chegar quebrado num CRM:</p>
        <ul className="mt-2 list-disc pl-5">
          {parsed.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    )
  }
  const c = parsed.content

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Block title="Funis e etapas" empty={c.pipelines.length === 0}>
        {c.pipelines.map((p) => (
          <div key={p.name} className="space-y-2">
            <p className="font-medium">{p.name}</p>
            <ol className="flex flex-wrap gap-1.5">
              {p.stages.map((s, i) => (
                <li
                  key={s.name}
                  className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: s.color ?? '#3b82f6' }}
                  />
                  {i + 1}. {s.name}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </Block>

      <Block title="Etiquetas e campos" empty={c.tags.length + c.custom_fields.length === 0}>
        {c.tags.length > 0 && (
          <p className="flex flex-wrap gap-1.5">
            {c.tags.map((t) => (
              <span
                key={t.name}
                className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: t.color ?? '#3b82f6' }} />
                {t.name}
              </span>
            ))}
          </p>
        )}
        {c.custom_fields.length > 0 && (
          <ul className="space-y-1 text-sm">
            {c.custom_fields.map((f) => (
              <li key={f.name}>
                <span className="font-medium">{f.name}</span>
                {f.options?.length ? (
                  <span className="text-xs text-muted-foreground"> · {f.options.join(', ')}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Respostas rápidas" empty={c.quick_replies.length === 0}>
        <ul className="space-y-3 text-sm">
          {c.quick_replies.map((q) => (
            <li key={q.title}>
              <p className="font-medium">{q.title}</p>
              <p className="text-muted-foreground">{q.text}</p>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Automações (chegam desligadas)" empty={c.automations.length === 0}>
        <ul className="space-y-3 text-sm">
          {c.automations.map((a) => (
            <li key={a.name}>
              <p className="font-medium">{a.name}</p>
              <p className="text-xs text-muted-foreground">
                Quando: {TRIGGER_LABEL[a.trigger]}
                {Array.isArray(a.trigger_config?.keywords) &&
                  ` (${(a.trigger_config.keywords as string[]).join(', ')})`}
              </p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
                {a.steps.map((s, i) => (
                  <li key={i}>{describeStep(s)}</li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </Block>
    </div>
  )
}

function describeStep(s: TemplateStep): string {
  const c = s.config as Record<string, unknown>
  switch (s.type) {
    case 'send_message':
      return `Envia: “${String(c.text ?? '')}”`
    case 'add_tag':
      return `Marca a etiqueta “${String(c.tag ?? '')}”`
    case 'remove_tag':
      return `Tira a etiqueta “${String(c.tag ?? '')}”`
    case 'create_deal':
      return `Cria negócio “${String(c.title ?? '')}” em ${String(c.pipeline ?? '')} › ${String(c.stage ?? '')}`
    case 'wait': {
      const unit = { minutes: 'minutos', hours: 'horas', days: 'dias' }[String(c.unit)] ?? String(c.unit)
      return `Espera ${String(c.amount ?? '')} ${unit}`
    }
    case 'close_conversation':
      return 'Fecha a conversa'
  }
}

function Block({
  title,
  empty,
  children,
}: {
  title: string
  empty: boolean
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">{title}</h2>
      <div className="space-y-3 p-4">
        {empty ? <p className="text-sm text-muted-foreground">Nada.</p> : children}
      </div>
    </section>
  )
}
