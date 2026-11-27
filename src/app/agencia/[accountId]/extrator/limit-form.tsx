'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** The agency's monthly ceiling for one CRM (migration 073). */
export function LimitForm({
  accountId,
  current,
  custom,
  fallback,
}: {
  accountId: string
  current: number
  custom: boolean
  fallback: number
}) {
  const router = useRouter()
  const [value, setValue] = useState(custom ? String(current) : '')
  const [busy, setBusy] = useState(false)

  const save = async (limit: number | null) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/agencia/crms/${accountId}/extrator`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyLimit: limit }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Não consegui salvar.')
      toast.success(limit === null ? `Limite voltou ao padrão (${fallback})` : 'Limite salvo')
      if (limit === null) setValue('')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não consegui salvar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void save(value.trim() === '' ? null : Number(value))
      }}
    >
      <label className="space-y-1">
        <span className="block text-xs text-muted-foreground">Leads por mês</span>
        <Input
          inputMode="numeric"
          className="w-36"
          value={value}
          placeholder={`Padrão: ${fallback}`}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
        />
      </label>
      <Button type="submit" size="sm" disabled={busy}>
        Salvar
      </Button>
      {custom ? (
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>
          Voltar ao padrão
        </Button>
      ) : null}
    </form>
  )
}
