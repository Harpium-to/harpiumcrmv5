// ============================================================
// The one part of the extension that runs in WhatsApp Web's own
// JavaScript world (manifest: "world": "MAIN").
//
// WHY IT EXISTS
//   The page itself used to say which chat was open: every message
//   row carried `data-id="false_5511999999999@c.us_3EB0…"`. By
//   November 2026 WhatsApp had cut that down to the message id alone,
//   and no attribute anywhere in the page names the chat any more. The
//   only place left that knows is WhatsApp's own code — which a
//   content script, living in an isolated world, cannot call. This
//   file can.
//
// WHAT IT DOES
//   Answers one question, when content.js asks it: which chat is
//   open? The answer is the chat's id and, when WhatsApp addresses the
//   person by a `@lid`, the phone number WhatsApp itself has for that
//   contact. Alongside, the number logged in to this WhatsApp Web, so
//   the panel offers "Enviar pelo CRM" only when the CRM would send
//   from that same number. Nothing else leaves here — no message text,
//   no names, no list of chats.
//
// WHAT IT CANNOT DO
//   Anything with the CRM. There is no `chrome.*` API in this world
//   and no key: those stay in the service worker (background.js). A
//   script in this world is exactly as trusted as the page, so
//   content.js treats what it says as untrusted input and validates it
//   (chat-id.js, `chatFromPage`).
//
// WHEN WHATSAPP CHANGES AGAIN
//   `require("WAWebChatCollection")` is WhatsApp's internal module
//   registry, not a public API. If it moves, this answers "not ready",
//   and the panel says it could not identify the conversation — it
//   never guesses.
// ============================================================

(() => {
  const ASK = "harpium-crm:which-chat";
  const ANSWER = "harpium-crm:chat";

  /** The open chat as WhatsApp's own code sees it, or null for none. */
  function activeChat() {
    const chat = window.require("WAWebChatCollection").ChatCollection.getActive();
    if (!chat) return null;

    const id = chat.id || {};
    const answer = { server: String(id.server || ""), user: null, phone: null };
    // The id itself only for a chat with a person. A group's id would
    // be of no use to the panel, so it stays here.
    if (answer.server === "c.us" || answer.server === "lid") {
      answer.user = String(id.user || "");
    }
    if (answer.server === "lid") {
      const number = chat.contact && chat.contact.phoneNumber;
      if (number && number.server === "c.us") answer.phone = String(number.user || "");
    }
    return answer;
  }

  /** The number logged in to this WhatsApp Web, or null. */
  function myNumber() {
    try {
      const me = window.require("WAWebUserPrefsMeUser").getMaybeMePnUser();
      return me && me.server === "c.us" ? String(me.user || "") || null : null;
    } catch {
      // Moved or not loaded: the panel just won't offer to send.
      return null;
    }
  }

  // Asked and answered inside one `dispatchEvent` call: listeners run
  // synchronously, in both worlds, so content.js has the answer by the
  // time its own dispatch returns. A string, because an object in
  // `detail` does not cross between worlds.
  document.addEventListener(ASK, () => {
    let payload;
    try {
      payload = { v: 1, ready: true, chat: activeChat(), me: myNumber() };
    } catch {
      // Not loaded yet, or WhatsApp moved it.
      payload = { v: 1, ready: false, chat: null, me: null };
    }
    document.dispatchEvent(new CustomEvent(ANSWER, { detail: JSON.stringify(payload) }));
  });
})();
