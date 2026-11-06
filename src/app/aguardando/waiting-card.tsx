'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, Clock, Loader2, LogOut } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  AGENCY_ACCESS_DESCRIPTION,
  AGENCY_ACCESS_LABEL,
  isAgencyAccessLevel,
} from '@/lib/agencia/crm'
import { createClient } from '@/lib/supabase/client'
import type { MyInvitation } from '@/types/platform'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Dono',
  admin: 'Administrador',
  agent: 'Atendente',
  viewer: 'Leitor',
}

export function WaitingCard({
  email,
  isAgencia,
  invitations,
}: {
  email: string | null
  isAgencia: boolean
  invitations: MyInvitation[]
}) {
  const router = useRouter()
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  const accept = async (inv: MyInvitation) => {
    setAcceptingId(inv.id)
    try {
      const res = await fetch(`/api/invitations/mine/${inv.id}/accept`, {
        method: 'POST',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao aceitar o convite')
      toast.success(`Você entrou em ${inv.accountName}.`)
      router.push('/dashboard')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao aceitar o convite')
      setAcceptingId(null)
    }
  }

  const signOut = async () => {
    setSigningOut(true)
    await createClient().auth.signOut()
    router.push('/login')
  }

  return (
    <Card className="w-full max-w-md border-border bg-card">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Clock className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-xl">
          {invitations.length > 0 ? 'Você tem um convite' : 'Aguardando liberação'}
        </CardTitle>
        <CardDescription>
          {invitations.length > 0
            ? 'Aceite para entrar no CRM.'
            : 'Sua conta foi criada, mas ainda não está ligada a nenhum CRM. A equipe que administra o sistema vai liberar o seu acesso.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {invitations.map((inv) => {
          const level = isAgencyAccessLevel(inv.agencyLevel) ? inv.agencyLevel : null
          return (
            <div key={inv.id} className="space-y-3 rounded-xl border border-border p-4">
              <div>
                <p className="font-medium">{inv.accountName}</p>
                <p className="text-xs text-muted-foreground">
                  Como {ROLE_LABEL[inv.role] ?? inv.role} · até{' '}
                  {new Date(inv.expiresAt).toLocaleDateString('pt-BR')}
                </p>
              </div>
              {inv.role === 'owner' && level && (
                <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Acesso da agência: {AGENCY_ACCESS_LABEL[level]}.
                  </span>{' '}
                  {AGENCY_ACCESS_DESCRIPTION[level]}
                </p>
              )}
              <Button
                className="w-full"
                disabled={acceptingId !== null}
                onClick={() => accept(inv)}
              >
                {acceptingId === inv.id && <Loader2 className="h-4 w-4 animate-spin" />}
                Aceitar e entrar
              </Button>
            </div>
          )
        })}

        {invitations.length === 0 && email && (
          <p className="text-center text-xs text-muted-foreground">
            Conectado como <span className="text-foreground">{email}</span>. Se
            você recebeu um link de convite, abra o link com este e-mail.
          </p>
        )}

        {isAgencia && (
          <Link href="/agencia" className="block">
            <Button variant="outline" className="w-full">
              <Building2 className="h-4 w-4" />
              Ir para o painel da agência
            </Button>
          </Link>
        )}

        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          disabled={signingOut}
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          Sair
        </Button>
      </CardContent>
    </Card>
  )
}
