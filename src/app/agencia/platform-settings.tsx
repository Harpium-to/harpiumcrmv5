'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Switch } from '@/components/ui/switch'

/**
 * Whether a brand-new signup gets an empty CRM of their own. Off is
 * the platform model: the person waits on /aguardando until the agency
 * creates or links their CRM. super_admin only (the API enforces it).
 */
export function PlatformSettings({
  autoPersonalAccount,
}: {
  autoPersonalAccount: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState(autoPersonalAccount)
  const [saving, setSaving] = useState(false)

  const toggle = async (next: boolean) => {
    setSaving(true)
    setValue(next)
    try {
      const res = await fetch('/api/agencia/plataforma', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoPersonalAccount: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao salvar')
      toast.success(
        next
          ? 'Cadastro novo volta a criar um CRM pessoal.'
          : 'Cadastro novo agora espera a agência liberar o CRM.',
      )
      router.refresh()
    } catch (err) {
      setValue(!next)
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <label className="flex items-start justify-between gap-4 px-4 py-3">
      <span>
        <span className="block text-sm font-medium">
          Cadastro novo cria um CRM pessoal
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          Desligado (recomendado): quem se cadastra fica aguardando até a
          agência criar ou vincular o CRM dele. Ligado: cada cadastro ganha um
          CRM vazio na hora.
        </span>
      </span>
      <Switch
        checked={value}
        disabled={saving}
        onCheckedChange={(checked) => toggle(checked === true)}
      />
    </label>
  )
}
