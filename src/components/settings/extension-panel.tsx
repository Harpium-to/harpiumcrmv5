'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Loader2,
  Puzzle,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import manifest from '../../../extension/manifest.json';

/** Set when the extension is published in the Chrome Web Store. */
const STORE_URL = process.env.NEXT_PUBLIC_EXTENSION_STORE_URL || null;
// The extension is called "Harpium CRM" now, but the zip and its folder
// keep the old name on purpose: Chrome identifies an unpacked extension
// by its folder's path, so a renamed folder is a different extension —
// everyone who updated would lose their connection and saved links.
const ZIP_URL = '/downloads/crm-connector.zip';

export interface ExtensionStatus {
  available: boolean;
  role?: string;
  viaAgency?: boolean;
  key?: { prefix: string; createdAt: string; lastUsedAt: string | null } | null;
}

/**
 * Settings → Extensão do Chrome (0B). Each person installs it in their
 * own browser and connects it with a personal key (migration 054) —
 * that is why it sits under "Conta", not "Espaço de trabalho".
 */
export function ExtensionPanel() {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [fresh, setFresh] = useState<{ key: string; crmUrl: string } | null>(null);
  const [busy, setBusy] = useState<'create' | 'revoke' | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/extension-key', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao carregar');
      setStatus(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao carregar');
      setStatus({ available: false });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (status?.key && !window.confirm('Gerar uma chave nova desconecta a extensão que usa a chave atual. Continuar?')) {
      return;
    }
    setBusy('create');
    try {
      const res = await fetch('/api/account/extension-key', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao gerar a chave');
      setFresh({ key: json.key, crmUrl: json.crmUrl ?? window.location.origin });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar a chave');
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    if (!window.confirm('Desconectar a extensão? Ela para de funcionar até você gerar outra chave.')) return;
    setBusy('revoke');
    try {
      const res = await fetch('/api/account/extension-key', { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao desconectar');
      setFresh(null);
      toast.success('Extensão desconectada.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao desconectar');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ExtensionPanelView
      status={status}
      fresh={fresh}
      busy={busy}
      onCreate={create}
      onRevoke={revoke}
    />
  );
}

export function ExtensionPanelView({
  status,
  fresh,
  busy,
  onCreate,
  onRevoke,
}: {
  status: ExtensionStatus | null;
  fresh: { key: string; crmUrl: string } | null;
  busy: 'create' | 'revoke' | null;
  onCreate: () => void;
  onRevoke: () => void;
}) {
  const canConnect =
    !!status?.available && !status.viaAgency && status.role !== 'viewer';

  return (
    <div className="space-y-5">
      <SettingsPanelHead
        title="Extensão do Chrome"
        description="O cliente do CRM ao lado da conversa no WhatsApp Web: veja quem é, crie o lead, mova o negócio no funil, responda, agende e dispare sequências sem trocar de aba."
      />

      <section className="grid gap-3 rounded-xl border border-border bg-card p-4 text-sm sm:grid-cols-2">
        <Feature title="Quem é">Nome, empresa, e-mail e etiquetas do contato da conversa aberta, com edição ali mesmo. Mostra se a IA está respondendo e deixa assumir a conversa.</Feature>
        <Feature title="Cadastro, anotações e tarefas">Contato novo vira lead com um clique. Anotações da equipe e tarefas com lembrete ficam na ficha.</Feature>
        <Feature title="Funil">Temperatura, etapa, novo negócio e fechamento como ganho ou perdido, direto do chat. E o quadro inteiro do funil, com arrastar e soltar.</Feature>
        <Feature title="Respostas rápidas">Os textos prontos do CRM (com foto, vídeo, áudio ou documento) a um clique do campo de mensagem, com o nome do contato preenchido — ou enviados direto pelo CRM, com a assinatura de quem atende.</Feature>
        <Feature title="Agendar e sequências">Mensagem para dia e hora, com follow-up se o cliente não responder, e sequências de mensagens com espera entre elas. Saem pelo agendador do CRM.</Feature>
        <Feature title="Robô na conversa">Vê se a IA ou um fluxo está respondendo, assume, devolve para a IA, pausa ou inicia um fluxo.</Feature>
        <p className="flex items-start gap-2 text-xs text-muted-foreground sm:col-span-2">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
          A extensão não lê suas conversas: ela só pega o número do chat aberto e o número
          logado no WhatsApp Web. Nenhum texto de mensagem é lido ou guardado por ela. Nada sai
          sozinho: enviar, agendar ou iniciar uma sequência pede confirmação, e só aparece quando
          o WhatsApp aberto é o número conectado ao CRM. A ficha não aparece em grupos.
        </p>
      </section>

      {/* Step 1 */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">1</span>
          Instalar
        </h3>
        {STORE_URL ? (
          <a href={STORE_URL} target="_blank" rel="noreferrer">
            <Button>
              <Puzzle className="size-4" />
              Adicionar ao Chrome
            </Button>
          </a>
        ) : (
          <>
            <a href={ZIP_URL} download>
              <Button>
                <Download className="size-4" />
                Baixar extensão (.zip) · versão {manifest.version}
              </Button>
            </a>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Descompacte o arquivo. Vai aparecer a pasta <strong className="text-foreground">crm-connector</strong>.</li>
              <li>
                Abra <code className="rounded bg-muted px-1">chrome://extensions</code> (cole na barra de endereço).
              </li>
              <li>Ligue o <strong className="text-foreground">Modo do desenvolvedor</strong>, no canto superior direito.</li>
              <li>
                Clique em <strong className="text-foreground">Carregar sem compactação</strong> e escolha a pasta crm-connector.
              </li>
              <li>
                Ela aparece na lista como <strong className="text-foreground">Harpium CRM</strong>. Abra o
                WhatsApp Web: o painel fica numa coluna à direita da conversa.
              </li>
            </ol>
            <p className="text-xs text-muted-foreground">
              Funciona no Chrome, Edge e Brave do computador. Guarde a pasta: o Chrome lê a
              extensão dela. Para atualizar, baixe de novo, troque a pasta e clique em
              atualizar em chrome://extensions.
            </p>
          </>
        )}
      </section>

      {/* Step 2 */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">2</span>
          Conectar ao seu CRM
        </h3>

        {status === null ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : !status.available ? (
          <p className="text-sm text-muted-foreground">
            Indisponível neste servidor: falta aplicar a migration 054.
          </p>
        ) : status.viaAgency ? (
          <p className="text-sm text-muted-foreground">
            A extensão é da equipe deste CRM. Você está aqui pela agência.
          </p>
        ) : status.role === 'viewer' ? (
          <p className="text-sm text-muted-foreground">
            A extensão é para quem atende. Peça a um administrador o papel de atendente.
          </p>
        ) : (
          <>
            <p className="text-sm">
              {status.key ? (
                <span className="inline-flex items-center gap-1.5">
                  <Check className="size-4 text-emerald-500" />
                  {status.key.lastUsedAt
                    ? `Conectada · último uso ${formatDistanceToNow(new Date(status.key.lastUsedAt), { addSuffix: true, locale: ptBR })}`
                    : 'Chave criada, a extensão ainda não usou'}
                  <span className="text-xs text-muted-foreground">({status.key.prefix}…)</span>
                </span>
              ) : (
                <span className="text-muted-foreground">Ainda não conectada.</span>
              )}
            </p>

            {fresh && (
              <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="text-sm font-medium">
                  Na extensão: Detalhes › Opções da extensão. Cole os dois campos, salve e
                  permita o acesso quando o Chrome pedir.
                </p>
                <CopyField label="Endereço do CRM" value={fresh.crmUrl} />
                <CopyField label="Chave" value={fresh.key} secret />
                <p className="text-xs text-muted-foreground">
                  A chave aparece só agora. Ela é sua: não compartilhe com a equipe — cada
                  pessoa gera a própria.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {canConnect && (
                <Button onClick={onCreate} disabled={busy !== null}>
                  {busy === 'create' ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  {status.key ? 'Gerar chave nova' : 'Gerar minha chave'}
                </Button>
              )}
              {status.key && (
                <Button variant="outline" onClick={onRevoke} disabled={busy !== null}>
                  {busy === 'revoke' ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}
                  Desconectar
                </Button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-medium">{title}</p>
      <p className="mt-0.5 text-muted-foreground">{children}</p>
    </div>
  );
}

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não consegui copiar. Selecione e copie à mão.');
    }
  };
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className={`min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 text-xs ${secret ? 'font-mono' : ''}`}>
          {value}
        </code>
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </div>
  );
}
