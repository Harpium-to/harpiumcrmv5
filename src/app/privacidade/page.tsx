import type { Metadata } from "next";

// Public privacy policy. Meta requires one (plus data-deletion
// instructions) before an app can go live, and both point at this same
// URL — the deletion section has its own anchor, #exclusao-de-dados.
// Kept outside the proxy's protected paths so it opens without login.

export const metadata: Metadata = {
  title: "Política de privacidade",
};

const CONTACT_EMAIL = "harpiumdigital@gmail.com";
const UPDATED_AT = "12 de novembro de 2026";

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8 space-y-3">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  const mail = (
    <a href={`mailto:${CONTACT_EMAIL}`} className="text-foreground underline underline-offset-2">
      {CONTACT_EMAIL}
    </a>
  );

  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <article className="mx-auto max-w-2xl space-y-10">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">Política de privacidade</h1>
          <p className="text-sm text-muted-foreground">
            Harpium · atualizada em {UPDATED_AT}
          </p>
        </header>

        <Section title="Quem somos">
          <p>
            A Harpium oferece este CRM para empresas atenderem seus clientes pelo WhatsApp e
            outros canais. Esta política explica quais dados o sistema trata, para quê e como
            pedir a exclusão deles. Ela segue a Lei Geral de Proteção de Dados (LGPD, Lei
            13.709/2018).
          </p>
        </Section>

        <Section title="Dados que tratamos">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-foreground">Dados da conta:</strong> nome, e-mail e foto
              de quem usa o CRM, e as configurações da empresa.
            </li>
            <li>
              <strong className="text-foreground">Contatos e conversas:</strong> nome, telefone
              e mensagens trocadas com os clientes da empresa pelo WhatsApp (API oficial da Meta
              ou outro provedor conectado), além de dados que a própria empresa cadastra, como
              etiquetas, negócios e anotações.
            </li>
            <li>
              <strong className="text-foreground">Leads de anúncios:</strong> quando a empresa
              conecta o Facebook Lead Ads, os dados preenchidos nos formulários dos anúncios.
            </li>
            <li>
              <strong className="text-foreground">Google Agenda:</strong> quando um profissional
              conecta a conta Google, os dados descritos em{" "}
              <a href="#google" className="text-foreground underline underline-offset-2">
                Dados do Google Agenda
              </a>
              .
            </li>
            <li>
              <strong className="text-foreground">Credenciais de integração:</strong> tokens de
              acesso da Meta e do Google e chaves de IA, guardados cifrados.
            </li>
          </ul>
        </Section>

        <Section title="Para que usamos">
          <p>
            Somente para prestar o serviço: receber e enviar mensagens, organizar contatos e
            negócios, gerar relatórios e, quando a empresa ativa, responder com assistentes de
            IA. Não vendemos dados nem os usamos para publicidade.
          </p>
        </Section>

        <Section title="Com quem compartilhamos">
          <p>Apenas com os serviços necessários para o CRM funcionar:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Meta (WhatsApp e Facebook), para enviar e receber mensagens e leads;</li>
            <li>
              Google, quando o profissional conecta o Google Agenda, para colocar os agendamentos na
              agenda dele;
            </li>
            <li>Supabase, que hospeda o banco de dados;</li>
            <li>Netlify, que hospeda o aplicativo;</li>
            <li>
              OpenAI ou Anthropic, só quando a empresa configura um assistente de IA, com a
              chave da própria empresa.
            </li>
          </ul>
        </Section>

        <Section id="google" title="Dados do Google Agenda">
          <p>
            Um profissional pode ligar uma agenda do CRM à conta Google dele. Isso só acontece quando
            ele mesmo autoriza, na tela de permissão do Google.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-foreground">O que acessamos:</strong> o e-mail da conta, para
              mostrar qual está conectada; a lista de agendas da conta, para escolher onde os
              agendamentos entram; e os eventos das agendas que a pessoa possui, para criar, mudar e
              apagar os agendamentos que o CRM marcou.
            </li>
            <li>
              <strong className="text-foreground">O que guardamos:</strong> a autorização do Google,
              cifrada; o e-mail da conta; as agendas escolhidas; e o identificador de cada evento que o
              CRM criou. Não guardamos título, descrição, local nem participantes dos compromissos do
              Google.
            </li>
            <li>
              <strong className="text-foreground">O que nunca fazemos:</strong> vender esses dados,
              usá-los para publicidade ou para treinar modelos de inteligência artificial, ou
              repassá-los a terceiros.
            </li>
            <li>
              <strong className="text-foreground">Como desconectar:</strong> em Agenda › engrenagem ›
              Desconectar, o que apaga do CRM a autorização. Também dá para remover o acesso em{" "}
              <a
                href="https://myaccount.google.com/connections"
                className="text-foreground underline underline-offset-2"
              >
                myaccount.google.com/connections
              </a>
              .
            </li>
          </ul>
          <p>
            O uso e a transferência, pelo Harpium CRM, de informações recebidas das APIs do Google para
            qualquer outro app seguem a{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="text-foreground underline underline-offset-2"
            >
              Política de Dados do Usuário dos Serviços de API do Google
            </a>
            , incluindo os requisitos de Uso Limitado.
          </p>
          <p>
            A versão oficial desta política, publicada para o Google, fica em{" "}
            <a
              href="https://harpium.com.br/privacidade/"
              className="text-foreground underline underline-offset-2"
            >
              harpium.com.br/privacidade
            </a>
            .
          </p>
        </Section>

        <Section title="Por quanto tempo guardamos">
          <p>
            Enquanto a conta da empresa estiver ativa, ou até que a empresa ou o titular peça a
            exclusão. Depois do pedido, os dados são apagados em até 30 dias, salvo o que a lei
            obrigar a manter.
          </p>
        </Section>

        <Section title="Seus direitos">
          <p>
            Você pode pedir acesso, correção, portabilidade ou exclusão dos seus dados, e
            informações sobre o uso deles, escrevendo para {mail}.
          </p>
        </Section>

        <Section id="exclusao-de-dados" title="Como pedir a exclusão dos dados">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Envie um e-mail para {mail} com o assunto <em>Exclusão de dados</em>.
            </li>
            <li>
              Informe o telefone ou e-mail ligado aos dados, e, se souber, o nome da empresa com
              quem você conversou.
            </li>
            <li>
              Confirmamos o recebimento e apagamos os dados em até 30 dias, avisando por e-mail
              quando terminar.
            </li>
          </ol>
          <p>
            Se você conectou o Facebook a este app, também pode removê-lo em Configurações do
            Facebook › Apps e sites.
          </p>
        </Section>

        <Section title="Contato">
          <p>Dúvidas sobre esta política: {mail}.</p>
        </Section>
      </article>
    </main>
  );
}
