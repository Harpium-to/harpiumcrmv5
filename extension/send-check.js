// ============================================================
// May the panel send through the CRM, here and now? (Fase 4B)
//
// Pure, so it is tested (send-check.test.js). Loaded by content.js
// through a dynamic import, like chat-id.js.
//
// The rule, in the order a person would check it:
//   1. the CRM can send, and says from which number;
//   2. that number is the one logged in to this WhatsApp Web — else
//      the customer gets the message from a number other than the one
//      on the screen;
//   3. the open chat is with a person whose number is known;
//   4. that person is the CRM contact on the panel, by number — the
//      CRM finds who to send to by number, and must find this one.
//
// Every "no" carries a sentence for the person, or null when there is
// nothing worth saying (still loading).
// ============================================================

import { phoneDigits, samePhone } from "./phone.js";

/** The last four digits, to tell two numbers apart without showing them whole. */
export function phoneTail(phone) {
  return phoneDigits(phone).slice(-4);
}

const OFF = "o envio direto fica desligado";

/**
 * @param {object} args
 * @param {{status: string, provider?: string|null, phone?: string|null}|null} args.sender
 *   What the CRM said (GET /api/v1/whatsapp/sender). `status` is
 *   "loading", "ready", "denied" (the key may not send), "missing" (a
 *   CRM without the endpoint) or "error".
 * @param {string|null} args.myPhone  The number logged in to WhatsApp Web.
 * @param {{state: string, phone?: string|null}|null} args.chat  The open chat.
 * @param {{phone?: string|null}|null} args.contact  The CRM contact on the panel.
 * @returns {{ok: true, to: string} | {ok: false, why: string|null}}
 */
export function sendCheck({ sender, myPhone, chat, contact }) {
  if (!sender || sender.status === "loading" || sender.status === "idle") {
    return { ok: false, why: null };
  }
  if (sender.status === "denied") {
    return {
      ok: false,
      why: "Enviar direto pelo CRM ainda não foi liberado para a sua chave (atualização 062 do CRM). Use o campo de mensagem.",
    };
  }
  if (sender.status === "missing") {
    return { ok: false, why: "Este CRM ainda não envia pela extensão. Use o campo de mensagem." };
  }
  if (sender.status !== "ready") {
    return {
      ok: false,
      why: `Não consegui perguntar ao CRM de qual número a mensagem sairia, então ${OFF}.`,
    };
  }
  if (!sender.provider) {
    return { ok: false, why: `Nenhum WhatsApp está conectado ao CRM, então ${OFF}.` };
  }
  if (!sender.phone) {
    return {
      ok: false,
      why: `Não consegui confirmar o número conectado ao CRM, então ${OFF}.`,
    };
  }
  if (!myPhone) {
    return { ok: false, why: `Não consegui ler o número deste WhatsApp, então ${OFF}.` };
  }
  if (!samePhone(myPhone, sender.phone)) {
    return {
      ok: false,
      why:
        `Este WhatsApp (final ${phoneTail(myPhone)}) não é o número conectado ao CRM ` +
        `(final ${phoneTail(sender.phone)}). Para a mensagem não sair de outro número, ${OFF}.`,
    };
  }
  if (!chat || chat.state !== "user") {
    return { ok: false, why: "Abra a conversa com um contato para enviar direto." };
  }
  const to = phoneDigits(chat.phone);
  if (to.length < 8 || to.length > 15) {
    return { ok: false, why: `Não sei o número desta conversa, então ${OFF}.` };
  }
  if (!contact) {
    return {
      ok: false,
      why: "Para enviar direto, o painel precisa mostrar o contato do CRM desta conversa: escolha ou crie o contato.",
    };
  }
  if (!samePhone(to, contact.phone)) {
    return {
      ok: false,
      why: `O contato do CRM nesta conversa tem outro número, então ${OFF}.`,
    };
  }
  return { ok: true, to: `+${to}` };
}
