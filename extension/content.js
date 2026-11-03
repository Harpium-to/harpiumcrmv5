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
