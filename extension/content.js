// ============================================================
// The panel inside WhatsApp Web.
//
// READING WHICH CHAT IS OPEN
//   WhatsApp Web's markup is generated and its class names change
//   between releases, so anything built on them breaks silently and
//   on someone else's schedule. The one durable signal is the
//   `data-id` on message rows: it encodes WhatsApp's own message id
//   (`false_5511999999999@c.us_3EB0...`), it is part of the protocol
//   rather than the styling, and it has outlived several redesigns.
//
//   Newer builds address more and more chats by a `@lid` id instead,
//   which is NOT a phone number. For those the panel reads the number
//   from the chat header when WhatsApp shows it there (someone not in
//   the address book), and otherwise asks the operator to find the
//   contact in the CRM. The link they make is remembered in this
//   browser, per chat.
//
//   What it never does is guess. The failure mode of a wrong guess is
//   a panel showing one customer's CRM record beside another
//   customer's chat — and whoever is reading it has no way to know,
//   which is exactly how someone gets greeted by the wrong name or
//   quoted the wrong price.
//
//   Group chats (`@g.us`) are skipped for the same reason: a group
//   has no single contact to show.
//
// The API key is not here and cannot be. See background.js.
// ============================================================

const PANEL_ID = "crm-connector-panel";
const POLL_MS = 800;

// The chat on screen: `{ key, phone, lid }` or null. `key` is what a
// hand-made link is stored under (`phone:<digits>` or `lid:<digits>`);
// `phone` is null for a lid chat whose number WhatsApp doesn't show.
let currentChat = null;
let currentSignature;
// Bumped on every chat change. Async work started for an earlier
// generation is dropped when it returns: drawing it would put one
// customer's data beside another customer's chat.
let generation = 0;

let currentContact = null;
let currentLinked = false;
let currentBaseUrl = "";
let panel = null;

// The open deals of the contact on screen. Kept apart from the contact
// so re-drawing the card (after a temperature change) doesn't refetch
// them, and keyed by contact so a late reply for the previous chat is
// recognisable as late.
let dealsState = { contactId: null, status: "idle", deals: [], pipelines: [], notice: null };

// The API's `temperature` values, in the order the control shows them.
const TEMPERATURES = [
  ["cold", "Frio"],
  ["warm", "Morno"],
  ["hot", "Quente"],
];

// ------------------------------------------------------------
// Reading the open conversation
// ------------------------------------------------------------

// Filled by the dynamic import at the bottom. Until it resolves the
// panel reports "no chat", which is correct: nothing has been read yet.
let chatIdentityFromDataIds = () => null;
let phoneFromHeaderTitles = () => null;
let usableChatName = () => null;

/** The open 1:1 chat, or null. */
function readOpenChat() {
  const main = document.querySelector("#main");
  if (!main) return null;
  const ids = [...main.querySelectorAll("[data-id]")].map((node) =>
    node.getAttribute("data-id"),
  );
  const identity = chatIdentityFromDataIds(ids);
  if (!identity) return null;
  if (identity.phone) {
    return { key: `phone:${identity.phone}`, phone: identity.phone, lid: null };
  }
  const titles = [...main.querySelectorAll("header [title]")].map((node) =>
    node.getAttribute("title"),
  );
  return { key: `lid:${identity.lid}`, phone: phoneFromHeaderTitles(titles), lid: identity.lid };
}

/** The name WhatsApp shows for the open chat, for pre-filling a create. */
function readOpenChatName() {
  const titled = document.querySelector("#main header [title]");
  return usableChatName(titled?.getAttribute("title"));
}

// ------------------------------------------------------------
// Talking to the service worker
// ------------------------------------------------------------

function send(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: "disconnected" });
        return;
      }
      resolve(response ?? { ok: false, error: "no_response" });
    });
  });
}

// ------------------------------------------------------------
// The panel
// ------------------------------------------------------------

function setCollapsed(collapsed) {
  const node = ensurePanel();
  node.classList.toggle("crmc-collapsed", collapsed);
  const button = node.querySelector('[data-act="collapse"]');
  if (button) {
    button.textContent = collapsed ? "+" : "—";
    button.title = collapsed ? "Expandir" : "Recolher";
  }
}

function ensurePanel() {
  if (panel && document.body.contains(panel)) return panel;
  panel = document.createElement("aside");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <header class="crmc-head">
      <span class="crmc-title">CRM</span>
      <button class="crmc-icon" data-act="settings" title="Configurar">⚙</button>
      <button class="crmc-icon" data-act="collapse" title="Recolher">—</button>
    </header>
    <div class="crmc-body"></div>
  `;
  document.body.appendChild(panel);

  panel.addEventListener("click", (event) => {
    const target = event.target?.closest?.("[data-act]");
    if (!target || !panel.contains(target)) return;
    const action = target.getAttribute("data-act");
    if (action === "collapse") {
      const collapsed = !panel.classList.contains("crmc-collapsed");
      setCollapsed(collapsed);
      void send("setPrefs", { collapsed });
    }
    if (action === "settings") void send("openOptions");
    if (action === "create") void createContact();
    if (action === "retry") void refresh(true);
    if (action === "search") renderLinkSearch();
    if (action === "pick") void linkContact(target.getAttribute("data-id"));
    if (action === "unlink") void unlink();
    if (action === "create-typed") void createTyped(target.getAttribute("data-phone"));
    if (action === "temperature") {
      void setTemperature(target.getAttribute("data-value"));
    }
  });

  panel.addEventListener("change", (event) => {
    const select = event.target;
    if (!select?.classList?.contains("crmc-stage")) return;
    void moveDeal(select.getAttribute("data-deal"), select.value);
  });

  panel.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = event.target?.querySelector?.("input");
    if (input) void runSearch(input.value);
  });

  // Typing in the search box must not reach WhatsApp's own keyboard
  // handling (shortcuts, focusing its message box).
  for (const type of ["keydown", "keyup", "keypress"]) {
    panel.addEventListener(type, (event) => event.stopPropagation());
  }

  void send("getPrefs").then((prefs) => {
    if (prefs.ok && prefs.data?.collapsed) setCollapsed(true);
  });

  return panel;
}

function body() {
  return ensurePanel().querySelector(".crmc-body");
}

function escapeHtml(value) {
  // Everything rendered here came from a customer record or from
  // WhatsApp's DOM; neither is ours, and this panel is injected into a
  // page we do not control.
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function render(html) {
  body().innerHTML = html;
}

function renderMessage(text, actionLabel, action) {
  render(`
    <p class="crmc-msg">${escapeHtml(text)}</p>
    ${
      actionLabel
        ? `<button class="crmc-btn" data-act="${escapeHtml(action)}">${escapeHtml(
            actionLabel,
          )}</button>`
        : ""
    }
  `);
}

/** A failed call to the CRM, said in the operator's terms. */
function renderFailure(result) {
  if (result.error === "unauthorized") {
    renderMessage("A chave de API foi recusada.", "Configurar", "settings");
  } else if (result.error === "network") {
    renderMessage("Não consegui falar com o CRM.", "Tentar de novo", "retry");
  } else {
    renderMessage(result.detail || "Algo deu errado.", "Tentar de novo", "retry");
  }
}

function contactUrl(contactId) {
  return `${currentBaseUrl}/contacts?contact=${encodeURIComponent(contactId)}`;
}

/** One contact as a choice: name and number, picked with a click. */
function renderChoice(contact) {
  return `
    <button class="crmc-result" data-act="pick" data-id="${escapeHtml(contact.id)}">
      <span class="crmc-result-name">${escapeHtml(contact.name || contact.phone)}</span>
      <span class="crmc-result-sub">${escapeHtml(contact.phone)}</span>
    </button>`;
}

function renderTemperature(contact) {
  // `null` means the CRM hasn't applied migration 045 yet: there is no
  // column to write to, so there is no control to offer.
  if (!contact.temperature) return "";
  const buttons = TEMPERATURES.map(
    ([value, label]) => `
      <button class="crmc-seg" data-act="temperature" data-value="${value}"
              aria-pressed="${contact.temperature === value}">${label}</button>`,
  ).join("");
  return `<div class="crmc-temp" role="group" aria-label="Temperatura">${buttons}</div>`;
}

function formatMoney(value, currency) {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || "BRL",
    }).format(value);
  } catch {
    // An unknown currency code: the number is still worth showing.
    return new Intl.NumberFormat("pt-BR").format(value);
  }
}

function renderDeal(deal) {
  const pipeline = dealsState.pipelines.find((p) => p.id === deal.pipeline?.id);
  // A stage list that doesn't include the current stage would show the
  // wrong one selected, so fall back to just the stage it is in.
  const stages = pipeline?.stages?.length ? pipeline.stages : deal.stage ? [deal.stage] : [];
  const options = stages
    .map(
      (stage) =>
        `<option value="${escapeHtml(stage.id)}"${
          stage.id === deal.stage?.id ? " selected" : ""
        }>${escapeHtml(stage.name)}</option>`,
    )
    .join("");
  return `
    <div class="crmc-deal">
      <p class="crmc-deal-head">
        <span class="crmc-deal-title">${escapeHtml(deal.title)}</span>
        <span class="crmc-deal-value">${escapeHtml(formatMoney(deal.value, deal.currency))}</span>
      </p>
      <select class="crmc-stage" data-deal="${escapeHtml(deal.id)}"
              aria-label="Etapa de ${escapeHtml(deal.title)}">${options}</select>
    </div>`;
}

function renderDeals(contactId) {
  if (dealsState.contactId !== contactId) return "";
  const { status, deals, notice } = dealsState;
  if (status === "loading") return `<p class="crmc-muted">Carregando negócios…</p>`;
  if (status === "forbidden") {
    return `<p class="crmc-muted">A chave de API não tem acesso a negócios.</p>`;
  }
  if (status === "error") return `<p class="crmc-muted">Não consegui carregar os negócios.</p>`;
  const list = deals.length
    ? deals.map(renderDeal).join("")
    : `<p class="crmc-muted">Nenhum negócio em aberto.</p>`;
  return `
    <p class="crmc-section">Negócios</p>
    ${list}
    ${notice ? `<p class="crmc-err">${escapeHtml(notice)}</p>` : ""}`;
}

function paintDeals() {
  const slot = body().querySelector(".crmc-deals");
  if (slot && currentContact) slot.innerHTML = renderDeals(currentContact.id);
}

async function loadDeals(contactId) {
  dealsState = { contactId, status: "loading", deals: [], pipelines: [], notice: null };
  paintDeals();

  const [deals, pipelines] = await Promise.all([
    send("deals", { contactId }),
    send("pipelines"),
  ]);
  // Another chat opened while this was loading.
  if (currentContact?.id !== contactId) return;

  if (!deals.ok || !pipelines.ok) {
    const forbidden = deals.error === "unauthorized" || pipelines.error === "unauthorized";
    dealsState = { ...dealsState, status: forbidden ? "forbidden" : "error" };
  } else {
    dealsState = {
      ...dealsState,
      status: "ready",
      deals: Array.isArray(deals.data) ? deals.data : [],
      pipelines: Array.isArray(pipelines.data) ? pipelines.data : [],
    };
  }
  paintDeals();
}

async function moveDeal(dealId, stageId) {
  const contactId = currentContact?.id;
  const gen = generation;
  const deal = dealsState.deals.find((d) => d.id === dealId);
  if (!contactId || !deal || deal.stage?.id === stageId) return;

  for (const select of body().querySelectorAll(".crmc-stage")) select.disabled = true;
  const result = await send("moveDeal", { id: dealId, stageId });

  // Same rule as the temperature: a reply for a chat that is no longer
  // open must not be drawn into the one that is.
  if (gen !== generation || currentContact?.id !== contactId) return;

  if (!result.ok) {
    dealsState = {
      ...dealsState,
      notice:
        result.error === "unauthorized"
          ? "A chave de API não tem permissão para mover negócios."
          : "Não consegui mudar a etapa.",
    };
  } else {
    dealsState = {
      ...dealsState,
      notice: null,
      deals: dealsState.deals.map((d) => (d.id === dealId ? result.data : d)),
    };
  }
  // Re-render either way: on failure this puts the select back on the
  // stage the deal is really in.
  paintDeals();
}

function renderContact(contact, notice) {
  currentContact = contact;
  const tags = (contact.tags || [])
    .map((t) => `<span class="crmc-tag">${escapeHtml(t.name)}</span>`)
    .join("");

  render(`
    <p class="crmc-name">${escapeHtml(contact.name || contact.phone)}</p>
    <p class="crmc-sub">${escapeHtml(contact.phone)}</p>
    ${
      currentLinked
        ? `<p class="crmc-linked">Vínculo lembrado neste navegador ·
             <button class="crmc-link" data-act="unlink">Desfazer</button></p>`
        : ""
    }
    ${contact.company ? `<p class="crmc-row"><span>Empresa</span>${escapeHtml(contact.company)}</p>` : ""}
    ${contact.email ? `<p class="crmc-row"><span>Email</span>${escapeHtml(contact.email)}</p>` : ""}
    ${
      contact.potential != null
        ? `<p class="crmc-row"><span>Potencial</span>${escapeHtml(contact.potential)}/100</p>`
        : ""
    }
    ${renderTemperature(contact)}
    ${notice ? `<p class="crmc-err">${escapeHtml(notice)}</p>` : ""}
    ${tags ? `<div class="crmc-tags">${tags}</div>` : ""}
    <div class="crmc-deals">${renderDeals(contact.id)}</div>
    <a class="crmc-btn" target="_blank" rel="noreferrer noopener"
       href="${escapeHtml(contactUrl(contact.id))}">
      Abrir no CRM
    </a>
  `);
}

/** Show a contact for the open chat and load its deals. */
function showContact(contact, { linked = false } = {}) {
  currentLinked = linked;
  renderContact(contact);
  void loadDeals(contact.id);
}

/** No record for this number: offer to create, or to link another. */
function renderNotFound(chat) {
  render(`
    <p class="crmc-name">Sem cadastro</p>
    <p class="crmc-sub">+${escapeHtml(chat.phone)}</p>
    <button class="crmc-btn" data-act="create">Criar no CRM</button>
    <button class="crmc-link crmc-link-block" data-act="search">
      Já está no CRM com outro número? Vincular
    </button>
  `);
}

/** The same number is in the CRM more than once: the operator picks. */
function renderChooser(matches) {
  render(`
    <p class="crmc-name">${matches.length} cadastros com este número</p>
    <p class="crmc-msg">Escolha qual é esta conversa. A escolha fica lembrada neste navegador.</p>
    <div class="crmc-results">${matches.map(renderChoice).join("")}</div>
  `);
}

/**
 * Find a contact in the CRM to link to this chat by hand: a lid chat
 * whose number WhatsApp doesn't show, or a customer saved under
 * another number.
 */
function renderLinkSearch() {
  const chat = currentChat;
  if (!chat) return;
  const hidden = !chat.phone;
  render(`
    <p class="crmc-name">${escapeHtml(
      hidden ? readOpenChatName() || "Número não exibido" : `+${chat.phone}`,
    )}</p>
    <p class="crmc-msg">${
      hidden
        ? "O WhatsApp não mostra o número desta conversa. Busque o contato no CRM para vincular."
        : "Busque o contato no CRM para vincular a esta conversa."
    } Fica lembrado neste navegador.</p>
    <form class="crmc-search">
      <input class="crmc-input" type="search" autocomplete="off"
             placeholder="Nome ou telefone com DDI" aria-label="Buscar contato no CRM" />
      <button class="crmc-btn crmc-btn-small" type="submit">Buscar</button>
    </form>
    <div class="crmc-results"></div>
    ${hidden ? "" : `<button class="crmc-link crmc-link-block" data-act="retry">Voltar</button>`}
  `);
  body().querySelector(".crmc-input")?.focus();
}

async function runSearch(rawQuery) {
  const query = String(rawQuery || "").trim();
  const gen = generation;
  const slot = () => body().querySelector(".crmc-results");
  if (!slot()) return;
  if (query.length < 2) {
    slot().innerHTML = `<p class="crmc-muted">Digite ao menos 2 letras ou o número.</p>`;
    return;
  }
  slot().innerHTML = `<p class="crmc-muted">Buscando…</p>`;

  const result = await send("search", { query });
  if (gen !== generation || !slot()) return;
  if (!result.ok) {
    slot().innerHTML = `<p class="crmc-err">${
      result.error === "unauthorized"
        ? "A chave de API foi recusada."
        : "Não consegui buscar no CRM."
    }</p>`;
    return;
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  if (rows.length) {
    slot().innerHTML = rows.map(renderChoice).join("");
    return;
  }

  // Creating needs the full international number: "31 99999-8888"
  // would otherwise be saved as a number in the Netherlands (+31).
  const digits = query.replace(/\D/g, "");
  const international = /^\+[\d\s().‐-―-]+$/.test(query) && digits.length >= 10;
  slot().innerHTML = `
    <p class="crmc-muted">Nenhum contato encontrado.</p>
    ${
      international
        ? `<button class="crmc-btn" data-act="create-typed" data-phone="${escapeHtml(digits)}">
             Criar contato com +${escapeHtml(digits)}</button>`
        : `<p class="crmc-muted">Para criar, digite o número com + e DDI (ex.: +55 31 99999-8888).</p>`
    }`;
}

/** Remember that this chat is `contactId`, and show it. */
async function linkContact(contactId) {
  const chat = currentChat;
  const gen = generation;
  if (!chat || !contactId) return;

  renderMessage("Vinculando…");
  const saved = await send("setLink", { chatKey: chat.key, contactId });
  if (gen !== generation) return;
  if (!saved.ok) {
    renderMessage("Não consegui guardar o vínculo.", "Tentar de novo", "retry");
    return;
  }
  const result = await send("contact", { id: contactId });
  if (gen !== generation) return;
  if (!result.ok) {
    renderFailure(result);
    return;
  }
  if (!result.data) {
    // Deleted in the CRM between the search and the click.
    await send("clearLink", { chatKey: chat.key });
    if (gen === generation) renderMessage("Esse contato não existe mais no CRM.", "Voltar", "retry");
    return;
  }
  showContact(result.data, { linked: true });
}

async function unlink() {
  const chat = currentChat;
  if (!chat) return;
  await send("clearLink", { chatKey: chat.key });
  await refresh(true);
}

/**
 * The CRM answered a create with a contact that is NOT this number —
 * its find-or-create also accepts a number that shares only the last
 * 8 digits, which can be someone in another area code. Ask.
 */
function renderSimilar(contact) {
  render(`
    <p class="crmc-name">Número parecido no CRM</p>
    <p class="crmc-msg">O CRM já tem um contato com os mesmos últimos dígitos, mas não é o mesmo número:</p>
    <div class="crmc-results">${renderChoice(contact)}</div>
    <p class="crmc-muted">Se for esta pessoa, clique nela para vincular. Se for outra, cadastre pelo CRM.</p>
    <a class="crmc-btn" target="_blank" rel="noreferrer noopener"
       href="${escapeHtml(contactUrl(contact.id))}">Abrir no CRM</a>
    <button class="crmc-link crmc-link-block" data-act="retry">Voltar</button>
  `);
}

async function create(phone, { link }) {
  const chat = currentChat;
  const gen = generation;
  if (!chat || !phone) return;

  renderMessage("Criando…");
  const result = await send("create", { phone, name: readOpenChatName() });
  if (gen !== generation) return;
  if (!result.ok) {
    renderMessage("Não consegui criar o contato.", "Tentar de novo", "retry");
    return;
  }
  if (!result.sameNumber) {
    renderSimilar(result.data);
    return;
  }
  if (link) {
    await send("setLink", { chatKey: chat.key, contactId: result.data.id });
    if (gen !== generation) return;
  }
  showContact(result.data, { linked: link });
}

function createContact() {
  // A lid chat is found by its number only while WhatsApp shows it;
  // once the person is saved on the phone the header shows a name, so
  // the link is what keeps the panel working.
  return create(currentChat?.phone, { link: Boolean(currentChat?.lid) });
}

function createTyped(digits) {
  return create(digits, { link: true });
}

async function setTemperature(value) {
  const contact = currentContact;
  const gen = generation;
  if (!contact || contact.temperature === value) return;

  for (const button of body().querySelectorAll(".crmc-seg")) button.disabled = true;
  const result = await send("update", { id: contact.id, fields: { temperature: value } });

  // The operator may have switched chats while this was in flight. The
  // reply belongs to the contact that was open then; drawing it now
  // would put one customer's card beside another customer's chat.
  if (gen !== generation) return;

  if (!result.ok) {
    const notice =
      result.error === "unauthorized"
        ? "A chave de API não tem permissão para editar contatos."
        : "Não consegui salvar a temperatura.";
    renderContact(contact, notice);
    return;
  }
  renderContact(result.data);
}

// ------------------------------------------------------------
// The loop
// ------------------------------------------------------------

async function refresh(force) {
  const chat = readOpenChat();
  const signature = chat ? `${chat.key}|${chat.phone ?? ""}` : "";

  if (!force && signature === currentSignature) return;
  currentSignature = signature;
  currentChat = chat;
  currentContact = null;
  currentLinked = false;
  const gen = ++generation;

  const settings = await send("settings");
  if (gen !== generation) return;
  currentBaseUrl = settings.ok ? settings.data.baseUrl : "";
  if (!settings.ok || !settings.data.configured) {
    renderMessage(
      "Configure o endereço do CRM e a chave de API.",
      "Configurar",
      "settings",
    );
    return;
  }

  if (!chat) {
    // Covers "no chat open", "group chat", and "could not read the
    // conversation" on purpose: from the operator's side the useful
    // information is the same — this panel has nothing to say about
    // what is on screen — and inventing a number would be worse.
    renderMessage("Abra uma conversa individual para ver o contato.");
    return;
  }

  renderMessage("Procurando…");

  // 1. A link made for this chat earlier, by hand or on create.
  const link = await send("getLink", { chatKey: chat.key });
  if (gen !== generation) return;
  if (link.ok && link.data) {
    const linked = await send("contact", { id: link.data });
    if (gen !== generation) return;
    if (!linked.ok) {
      renderFailure(linked);
      return;
    }
    if (linked.data) {
      showContact(linked.data, { linked: true });
      return;
    }
    // Deleted in the CRM: forget the link and look it up afresh.
    await send("clearLink", { chatKey: chat.key });
    if (gen !== generation) return;
  }

  // 2. A lid chat with no number on screen: only the operator knows.
  if (!chat.phone) {
    renderLinkSearch();
    return;
  }

  // 3. By number.
  const result = await send("lookup", { phone: chat.phone });
  if (gen !== generation) return;
  if (!result.ok) {
    renderFailure(result);
    return;
  }

  const matches = Array.isArray(result.data) ? result.data : [];
  if (matches.length > 1) {
    renderChooser(matches);
    return;
  }
  if (matches.length === 0) {
    renderNotFound(chat);
    return;
  }

  if (chat.lid) {
    // Same reason as on create: keep finding this chat after the
    // header stops showing the number.
    await send("setLink", { chatKey: chat.key, contactId: matches[0].id });
    if (gen !== generation) return;
  }
  showContact(matches[0], { linked: Boolean(chat.lid) });
}

// Polled rather than observed: WhatsApp Web swaps the whole #main
// subtree when you switch chats, so a MutationObserver on it detaches
// with the node it was watching, and one on <body> fires constantly
// while messages stream in. Under a second is well inside the time it
// takes to read a chat.
ensurePanel();

// The id parsing lives in its own module so it can be tested; an MV3
// content script cannot be a module itself, so it imports one.
void (async () => {
  try {
    const mod = await import(chrome.runtime.getURL("chat-id.js"));
    chatIdentityFromDataIds = mod.chatIdentityFromDataIds;
    phoneFromHeaderTitles = mod.phoneFromHeaderTitles;
    usableChatName = mod.usableChatName;
  } catch {
    renderMessage("Não consegui carregar a extensão. Recarregue a página.");
    return;
  }
  await refresh(true);
  setInterval(() => void refresh(false), POLL_MS);
})();
