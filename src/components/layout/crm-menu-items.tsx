'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, Check } from 'lucide-react'
import { toast } from 'sonner'

import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/hooks/use-auth'
import { CRM_STATUS_LABEL } from '@/lib/agencia/crm'
import type { MyAccount } from '@/types/platform'

const itemClass =
  'text-popover-foreground focus:bg-accent focus:text-accent-foreground'

/**
 * Profile-menu entries for the platform (049/050):
 *   - "Painel da agência" for the agency team
 *   - a CRM switcher when the person belongs to two or more CRMs
 * Renders nothing for everyone else, and before 049 (empty list).
 */
export function CrmMenuItems() {
  const router = useRouter()
  const { refreshProfile } = useAuth()
  const [accounts, setAccounts] = useState<MyAccount[]>([])
  const [isAgencia, setIsAgencia] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/account/mine')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json) return
        setAccounts(json.accounts ?? [])
        setIsAgencia(json.isAgencia === true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const switchTo = async (account: MyAccount) => {
    if (account.active) return
    try {
      const res = await fetch('/api/account/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: account.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao trocar de CRM')
      // Every screen reads the active CRM: reload the profile, then the
      // route, so nothing keeps showing the previous CRM's data.
      await refreshProfile()
      router.push('/dashboard')
      router.refresh()
      toast.success(`Agora em ${account.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao trocar de CRM')
    }
  }

  const showSwitcher = accounts.length >= 2
  if (!showSwitcher && !isAgencia) return null

  return (
    <>
      {showSwitcher && (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Seus CRMs</DropdownMenuLabel>
          {accounts.map((a) => (
            <DropdownMenuItem
              key={a.id}
              onClick={() => switchTo(a)}
              className={itemClass}
            >
              <Check
                className={`size-4 ${a.active ? 'opacity-100' : 'opacity-0'}`}
              />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              {a.status !== 'active' && (
                <span className="text-xs text-muted-foreground">
                  {CRM_STATUS_LABEL[a.status]}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      )}
      {isAgencia && (
        <DropdownMenuItem render={<Link href="/agencia" className={itemClass} />}>
          <Building2 className="size-4" />
          Painel da agência
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator className="bg-border" />
    </>
  )
}
