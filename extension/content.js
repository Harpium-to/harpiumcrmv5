// ============================================================
// The panel inside WhatsApp Web.
//
// READING WHICH CHAT IS OPEN
//   WhatsApp Web's markup is generated and changes without notice, so
//   the panel asks rather than scrapes: page-bridge.js, a few lines
//   running in WhatsApp's own JavaScript world, reports the open
//   chat's id and — for the `@lid` ids WhatsApp now uses for most
//   people, which are NOT phone numbers — the number WhatsApp has for
//   that contact. It reports nothing else, and what it reports is
//   validated here before use (chat-id.js).
//
//   Before that, the chat id was read from the `data-id` of the
//   message rows. WhatsApp stopped putting it there; the old reading
//   is kept as a fallback for builds that still do.
//
//   When WhatsApp has no number for a lid, the panel reads it from the
//   chat header if it is shown there (someone not in the address
//   book), and otherwise asks the operator to find the contact in the
//   CRM. The link they make is remembered in this browser, per chat.
//
//   What it never does is guess. The failure mode of a wrong guess is
//   a panel showing one customer's CRM record beside another
//   customer's chat — and whoever is reading it has no way to know,
//   which is exactly how someone gets greeted by the wrong name or
//   quoted the wrong price. So when neither source can say who the
//   chat is with, the panel says exactly that.
//
//   Groups and channels are skipped for the same reason: they have no
//   single contact to show.
//
// WHERE THE PANEL SITS
//   A column on the right that takes its width from WhatsApp instead
//   of covering it: `#app`, WhatsApp's root, is made narrower (see
//   content.css). This is checked rather than assumed — if `#app` did
//   not actually shrink, or the window is too narrow to share, the
//   panel floats over the corner the way it always did. Collapsed, it
//   is a small tab on the edge and WhatsApp gets its full width back.
//
// The API key is not here and cannot be. See background.js.
// ============================================================

const PANEL_ID = "crm-connector-panel";
const POLL_MS = 800;
// Keep in step with --crmc-width and the `#app` rule in content.css.
const PANEL_WIDTH = 320;
// Below this, what would be left for WhatsApp is too narrow to work
// in, so the panel floats instead of taking a column.
const DOCK_MIN_VIEWPORT = 1180;
const DOCK_CLASS = "crmc-docked";

// The chat on screen when it is with one person, else null:
// `{ state: "user", key, phone, lid, phoneFrom }`. `key` is what a
// hand-made link is stored under (`lid:<digits>` when WhatsApp uses a
// lid for the person, else `phone:<digits>`). `phone` is null when
// nothing says what the number is; `phoneFrom` says what did — "page"
// (WhatsApp's own code), "ids" (the message rows) or "header".
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

// Set when docking was tried and WhatsApp did not get narrower; cleared
// on resize, which is the only thing that could change the answer.
let dockFailed = false;

// The CRM the extension is connected to, for the header. Asked once
// per CRM address; a failed ask is retried no more than once a minute.
let account = { baseUrl: null, name: null, askedAt: 0 };

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
let chatFromPage = () => null;
let chatFromDataIds = () => null;
let phoneFromHeaderTitles = () => null;
let usableChatName = () => null;
let modulesLoaded = false;
// Until theme.js loads, the system preference is all there is.
let pickMode = (_colors, prefersDark) => (prefersDark ? "dark" : "light");

// page-bridge.js answers inside the dispatch below (see there), so the
// reply is already in `pageAnswer` when `dispatchEvent` returns.
let pageAnswer = null;
document.addEventListener("harpium-crm:chat", (event) => {
  pageAnswer = typeof event.detail === "string" ? event.detail : null;
});

function askPage() {
  pageAnswer = null;
  document.dispatchEvent(new CustomEvent("harpium-crm:which-chat"));
  return pageAnswer;
}

/**
 * What is on screen: `{ state: "none" }`, `{ state: "other" }` (a
 * group or channel), `{ state: "unknown" }` (a chat is open and
 * nothing says who with), or the `{ state: "user", … }` described at
 * `currentChat`.
 */
function readOpenChat() {
  if (!modulesLoaded) return { state: "none" };
  const main = document.querySelector("#main");
  const headerPhone = () =>
    phoneFromHeaderTitles(
      [...(main?.querySelectorAll("header [title]") ?? [])].map((node) =>
        node.getAttribute("title"),
      ),
    );

  // WhatsApp's own answer first; the message rows only when it has
  // none — or says "no chat" while one is plainly on screen.
  let found = chatFromPage(askPage());
  let from = "page";
  if (!found || (found.state === "none" && main)) {
    if (!main) return { state: "none" };
    const ids = [...main.querySelectorAll("[data-id]")].map((node) =>
      node.getAttribute("data-id"),
    );
    found = chatFromDataIds(ids);
    from = "ids";
    if (!found) return { state: "unknown" };
  }
  if (found.state !== "user") return { state: found.state };

  if (!found.lid) {
    return {
      state: "user",
      key: `phone:${found.phone}`,
      phone: found.phone,
      lid: null,
      phoneFrom: from,
    };
  }
  const shown = found.phone ? null : headerPhone();
  return {
    state: "user",
    key: `lid:${found.lid}`,
    phone: found.phone ?? shown,
    lid: found.lid,
    phoneFrom: found.phone ? from : shown ? "header" : null,
  };
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

const ICON_SETTINGS = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_COLLAPSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/></svg>`;

/**
 * Dock the panel as a column, or float it.
 *
 * Docking narrows WhatsApp's root through a class on <html>. It is
 * only kept when it demonstrably worked: a WhatsApp build whose root
 * isn't `#app`, or doesn't obey the width, would otherwise leave the
 * panel covering a third of the chat with nothing to show for it.
 */
function applyLayout() {
  const node = ensurePanel();
  const collapsed = node.classList.contains("crmc-collapsed");
  const dock = !collapsed && !dockFailed && window.innerWidth >= DOCK_MIN_VIEWPORT;
  document.documentElement.classList.toggle(DOCK_CLASS, dock);
  node.classList.toggle("crmc-floating", !dock);
  // Not on the next frame: a width that animates would still read as
  // "didn't shrink" there.
  if (dock) setTimeout(verifyDock, 300);
}

function verifyDock() {
  if (!document.documentElement.classList.contains(DOCK_CLASS)) return;
  const app = document.querySelector("#app");
  const limit = window.innerWidth - PANEL_WIDTH + 2;
  if (app && app.getBoundingClientRect().right <= limit) return;
  dockFailed = true;
  applyLayout();
}

/** Light or dark, following what WhatsApp is showing right now. */
function applyMode() {
  const node = ensurePanel();
  const app = document.querySelector("#app");
  const colors = [app?.firstElementChild, app, document.body, document.documentElement]
    .filter(Boolean)
    .map((element) => getComputedStyle(element).backgroundColor);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const mode = pickMode(colors, prefersDark);
  if (node.getAttribute("data-mode") !== mode) node.setAttribute("data-mode", mode);
}

function paintAccount() {
  const slot = ensurePanel().querySelector(".crmc-account");
  if (slot) slot.textContent = account.name || "";
}

/** Put the connected CRM's name in the header. */
async function loadAccount(baseUrl) {
  if (account.baseUrl !== baseUrl) {
    account = { baseUrl, name: null, askedAt: 0 };
    paintAccount();
  }
  if (!baseUrl || account.name || Date.now() - account.askedAt < 60_000) return;
  account.askedAt = Date.now();
  const result = await send("account");
  if (account.baseUrl !== baseUrl) return;
  if (result.ok && result.data?.name) {
    account.name = result.data.name;
    paintAccount();
  }
}

function setCollapsed(collapsed) {
  ensurePanel().classList.toggle("crmc-collapsed", collapsed);
  applyLayout();
}

function ensurePanel() {
  if (panel && document.body.contains(panel)) return panel;
  const logo = chrome.runtime.getURL("icons/icon-48.png");
  panel = document.createElement("aside");
  panel.id = PANEL_ID;
  panel.setAttribute("aria-label", "Harpium CRM");
  panel.innerHTML = `
    <button class="crmc-tab" data-act="expand" title="Abrir o Harpium CRM"
            aria-label="Abrir o Harpium CRM">
      <img class="crmc-logo" alt="" src="${escapeHtml(logo)}" />
    </button>
    <header class="crmc-head">
      <img class="crmc-logo" alt="" src="${escapeHtml(logo)}" />
      <div class="crmc-brand">
        <span class="crmc-title">Harpium CRM</span>
        <span class="crmc-account"></span>
      </div>
      <button class="crmc-icon" data-act="settings" title="Configurar"
              aria-label="Configurar">${ICON_SETTINGS}</button>
      <button class="crmc-icon" data-act="collapse" title="Recolher"
              aria-label="Recolher">${ICON_COLLAPSE}</button>
    </header>
    <div class="crmc-body"></div>
  `;
  document.body.appendChild(panel);

  // A logo that fails to load must not leave a broken-image box; in
  // the tab, which has nothing else in it, initials stand in.
  for (const img of panel.querySelectorAll("img.crmc-logo")) {
    img.addEventListener("error", () => {
      if (img.parentElement?.classList.contains("crmc-tab")) {
        img.parentElement.textContent = "CRM";
      } else {
        img.remove();
      }
    });
  }

  panel.addEventListener("click", (event) => {
    const target = event.target?.closest?.("[data-act]");
    if (!target || !panel.contains(target)) return;
    const action = target.getAttribute("data-act");
    if (action === "collapse" || action === "expand") {
      const collapsed = action === "collapse";
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

  applyMode();
  applyLayout();
  paintAccount();

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
  if (status === "loading") return `<p class="crmc-muted">Carregando…</p>`;
  if (status === "forbidden") {
    return `<p class="crmc-muted">A chave de API não tem acesso a negócios.</p>`;
  }
  if (status === "error") return `<p class="crmc-muted">Não consegui carregar os negócios.</p>`;
  const list = deals.length
    ? deals.map(renderDeal).join("")
    : `<p class="crmc-muted">Nenhum negócio em aberto.</p>`;
  return `
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
  const rows = [
    contact.company ? `<p class="crmc-row"><span>Empresa</span>${escapeHtml(contact.company)}</p>` : "",
    contact.email ? `<p class="crmc-row"><span>Email</span>${escapeHtml(contact.email)}</p>` : "",
    contact.potential != null
      ? `<p class="crmc-row"><span>Potencial</span>${escapeHtml(contact.potential)}/100</p>`
      : "",
  ].join("");
  const details = [
    rows,
    renderTemperature(contact),
    notice ? `<p class="crmc-err">${escapeHtml(notice)}</p>` : "",
    tags ? `<div class="crmc-tags">${tags}</div>` : "",
  ].join("");

  render(`
    <div class="crmc-who">
      <p class="crmc-name">${escapeHtml(contact.name || contact.phone)}</p>
      <p class="crmc-sub">${escapeHtml(contact.phone)}</p>
      ${
        currentLinked
          ? `<p class="crmc-linked">Vínculo lembrado neste navegador ·
               <button class="crmc-link" data-act="unlink">Desfazer</button></p>`
          : ""
      }
    </div>
    ${
      details.trim()
        ? `<section class="crmc-card"><p class="crmc-section">Contato</p>${details}</section>`
        : ""
    }
    <section class="crmc-card">
      <p class="crmc-section">Negócios</p>
      <div class="crmc-deals">${renderDeals(contact.id)}</div>
    </section>
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

/**
 * A number read off the chat header is only there while the person is
 * not in the phone's address book; once saved, the header shows a name
 * instead. A link made now is what keeps the panel finding them.
 */
function needsLinkToKeep(chat) {
  return Boolean(chat?.lid) && chat.phoneFrom === "header";
}

function createContact() {
  return create(currentChat?.phone, { link: needsLinkToKeep(currentChat) });
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
  const seen = readOpenChat();
  const chat = seen.state === "user" ? seen : null;
  const signature = chat ? `${chat.key}|${chat.phone ?? ""}` : seen.state;

  if (!force && signature === currentSignature) return;
  currentSignature = signature;
  currentChat = chat;
  currentContact = null;
  currentLinked = false;
  const gen = ++generation;

  const settings = await send("settings");
  if (gen !== generation) return;
  currentBaseUrl = settings.ok ? settings.data.baseUrl : "";
  const configured = settings.ok && settings.data.configured;
  void loadAccount(configured ? currentBaseUrl : null);
  if (!configured) {
    renderMessage(
      "Configure o endereço do CRM e a chave de API.",
      "Configurar",
      "settings",
    );
    return;
  }

  if (seen.state === "other") {
    renderMessage(
      "Esta conversa é um grupo ou canal. O painel mostra o contato em conversas individuais.",
    );
    return;
  }
  if (seen.state === "unknown") {
    // Said outright, and not as "open a chat": one IS open. This is
    // what a WhatsApp Web change looks like from here, and whoever
    // supports the operator needs to hear about it.
    renderMessage(
      "Não consegui identificar esta conversa. O WhatsApp Web pode ter mudado: atualize a extensão ou avise o suporte.",
      "Tentar de novo",
      "retry",
    );
    return;
  }
  if (!chat) {
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

  const keep = needsLinkToKeep(chat);
  if (keep) {
    await send("setLink", { chatKey: chat.key, contactId: matches[0].id });
    if (gen !== generation) return;
  }
  showContact(matches[0], { linked: keep });
}

// Polled rather than observed: WhatsApp Web swaps the whole #main
// subtree when you switch chats, so a MutationObserver on it detaches
// with the node it was watching, and one on <body> fires constantly
// while messages stream in. Under a second is well inside the time it
// takes to read a chat.
ensurePanel();

let resizeQueued = false;
window.addEventListener("resize", () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    dockFailed = false;
    applyLayout();
  });
});

// The DOM-reading logic lives in its own modules so it can be tested;
// an MV3 content script cannot be a module itself, so it imports them.
void (async () => {
  try {
    const mod = await import(chrome.runtime.getURL("chat-id.js"));
    chatFromPage = mod.chatFromPage;
    chatFromDataIds = mod.chatFromDataIds;
    phoneFromHeaderTitles = mod.phoneFromHeaderTitles;
    usableChatName = mod.usableChatName;
    modulesLoaded = true;
  } catch {
    renderMessage("Não consegui carregar a extensão. Recarregue a página.");
    return;
  }
  try {
    pickMode = (await import(chrome.runtime.getURL("theme.js"))).pickMode;
  } catch {
    // The panel still works; it just follows the system theme.
  }
  applyMode();
  await refresh(true);
  setInterval(() => {
    applyMode();
    void refresh(false);
  }, POLL_MS);
})();
