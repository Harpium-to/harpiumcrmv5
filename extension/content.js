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
//   When that fails, this shows "não consegui identificar a conversa"
//   and stops. It does NOT fall back to a guess. The failure mode of
//   a wrong guess is a panel showing one customer's CRM record beside
//   another customer's chat — and whoever is reading it has no way to
//   know, which is exactly how someone gets greeted by the wrong name
//   or quoted the wrong price.
//
//   Group chats (`@g.us`) are skipped for the same reason: a group
//   has no single contact to show.
//
// The API key is not here and cannot be. See background.js.
// ============================================================

const PANEL_ID = "crm-connector-panel";
const POLL_MS = 800;

let currentPhone = null;
let currentContact = null;
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
let chatPhoneFromDataIds = () => null;
let usableChatName = () => null;

/** The phone digits of the open 1:1 chat, or null. */
function readOpenChatPhone() {
  const main = document.querySelector("#main");
  if (!main) return null;
  const ids = [...main.querySelectorAll("[data-id]")].map((node) =>
    node.getAttribute("data-id"),
  );
  return chatPhoneFromDataIds(ids);
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
    const action = event.target?.getAttribute?.("data-act");
    if (!action) return;
    if (action === "collapse") panel.classList.toggle("crmc-collapsed");
    if (action === "settings") void send("openOptions");
    if (action === "create") void createContact();
    if (action === "retry") void refresh(true);
    if (action === "temperature") {
      void setTemperature(event.target.getAttribute("data-value"));
    }
  });

  panel.addEventListener("change", (event) => {
    const select = event.target;
    if (!select?.classList?.contains("crmc-stage")) return;
    void moveDeal(select.getAttribute("data-deal"), select.value);
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
  const deal = dealsState.deals.find((d) => d.id === dealId);
  if (!contactId || !deal || deal.stage?.id === stageId) return;

  for (const select of body().querySelectorAll(".crmc-stage")) select.disabled = true;
  const result = await send("moveDeal", { id: dealId, stageId });

  // Same rule as the temperature: a reply for a chat that is no longer
  // open must not be drawn into the one that is.
  if (currentContact?.id !== contactId) return;

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

function renderContact(contact, baseUrl, notice) {
  currentContact = contact;
  currentBaseUrl = baseUrl;
  const tags = (contact.tags || [])
    .map((t) => `<span class="crmc-tag">${escapeHtml(t.name)}</span>`)
    .join("");

  render(`
    <p class="crmc-name">${escapeHtml(contact.name || contact.phone)}</p>
    <p class="crmc-sub">${escapeHtml(contact.phone)}</p>
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
       href="${escapeHtml(baseUrl)}/contacts?contact=${encodeURIComponent(contact.id)}">
      Abrir no CRM
    </a>
  `);
}

async function createContact() {
  const phone = currentPhone;
  if (!phone) return;
  renderMessage("Criando…");
  const result = await send("create", { phone, name: readOpenChatName() });
  if (!result.ok) {
    renderMessage("Não consegui criar o contato.", "Tentar de novo", "retry");
    return;
  }
  await refresh(true);
}

async function setTemperature(value) {
  const contact = currentContact;
  if (!contact || contact.temperature === value) return;
  const phone = currentPhone;
  const baseUrl = currentBaseUrl;

  for (const button of body().querySelectorAll(".crmc-seg")) button.disabled = true;
  const result = await send("update", { id: contact.id, fields: { temperature: value } });

  // The operator may have switched chats while this was in flight. The
  // reply belongs to the contact that was open then; drawing it now
  // would put one customer's card beside another customer's chat.
  if (currentPhone !== phone) return;

  if (!result.ok) {
    const notice =
      result.error === "unauthorized"
        ? "A chave de API não tem permissão para editar contatos."
        : "Não consegui salvar a temperatura.";
    renderContact(contact, baseUrl, notice);
    return;
  }
  renderContact(result.data, baseUrl);
}

// ------------------------------------------------------------
// The loop
// ------------------------------------------------------------

async function refresh(force) {
  const phone = readOpenChatPhone();

  if (!force && phone === currentPhone) return;
  currentPhone = phone;
  currentContact = null;

  const settings = await send("settings");
  const baseUrl = settings.ok ? settings.data.baseUrl : "";
  if (!settings.ok || !settings.data.configured) {
    renderMessage(
      "Configure o endereço do CRM e a chave de API.",
      "Configurar",
      "settings",
    );
    return;
  }

  if (!phone) {
    // Covers "no chat open", "group chat", and "could not read the
    // conversation" on purpose: from the operator's side the useful
    // information is the same — this panel has nothing to say about
    // what is on screen — and inventing a number would be worse.
    renderMessage("Abra uma conversa individual para ver o contato.");
    return;
  }

  renderMessage("Procurando…");
  const result = await send("lookup", { phone });

  if (!result.ok) {
    if (result.error === "unauthorized") {
      renderMessage("A chave de API foi recusada.", "Configurar", "settings");
    } else if (result.error === "network") {
      renderMessage("Não consegui falar com o CRM.", "Tentar de novo", "retry");
    } else {
      renderMessage(result.detail || "Algo deu errado.", "Tentar de novo", "retry");
    }
    return;
  }

  if (!result.data) {
    render(`
      <p class="crmc-name">Sem cadastro</p>
      <p class="crmc-sub">+${escapeHtml(phone)}</p>
      <button class="crmc-btn" data-act="create">Criar no CRM</button>
    `);
    return;
  }

  renderContact(result.data, baseUrl);
  void loadDeals(result.data.id);
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
    chatPhoneFromDataIds = mod.chatPhoneFromDataIds;
    usableChatName = mod.usableChatName;
  } catch {
    renderMessage("Não consegui carregar a extensão. Recarregue a página.");
    return;
  }
  await refresh(true);
  setInterval(() => void refresh(false), POLL_MS);
})();
