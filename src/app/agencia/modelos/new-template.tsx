'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

/** Starts an empty template and opens it in the editor. */
export function NewTemplateButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const create = async () => {
    const name = window.prompt('Nome do novo modelo')
    if (!name?.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/agencia/modelos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao criar o modelo')
      router.push(`/agencia/modelos/${json.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao criar o modelo')
      setBusy(false)
    }
  }

  return (
    <Button onClick={create} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      Novo modelo
    </Button>
  )
}
