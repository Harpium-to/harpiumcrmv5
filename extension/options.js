// ============================================================
// Settings.
//
// Saving does two things beyond writing to storage, and both matter.
//
// 1. It asks for host permission for the URL that was just typed.
//    The manifest requests no site access up front, so the extension
//    can reach exactly one CRM — the one its owner named — and
//    nothing else. An extension that ships with `https://*/*` granted
//    is one compromised update away from reading every site its users
//    visit.
//
// 2. It calls the API before reporting success. "Salvo" on a typo'd
//    URL or a revoked key means discovering the problem later, on
//    WhatsApp Web, as a panel that silently says nothing useful.
// ============================================================

const el = (id) => document.getElementById(id);

function show(message, kind) {
  const status = el("status");
  status.textContent = message;
  status.className = kind || "";
}

function originPattern(rawUrl) {
  const url = new URL(rawUrl);
  return `${url.protocol}//${url.host}/*`;
}

async function load() {
  const stored = await chrome.storage.local.get(["baseUrl", "apiKey"]);
  el("baseUrl").value = stored.baseUrl || "";
  // Only ever a placeholder for a saved key: re-rendering the secret
  // into a field puts it in the DOM, in screenshots and in form
  // autofill for no benefit — it is already saved.
  if (stored.apiKey) el("apiKey").placeholder = "•••••••• (salva)";
}

async function save() {
  const baseUrl = el("baseUrl").value.trim().replace(/\/+$/, "");
  const typedKey = el("apiKey").value.trim();

  if (!baseUrl) {
    show("Informe o endereço do CRM.", "bad");
    return;
  }

  let pattern;
  try {
    pattern = originPattern(baseUrl);
  } catch {
    show("Esse endereço não é uma URL válida.", "bad");
    return;
  }

  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    show("Sem permissão para acessar esse endereço.", "bad");
    return;
  }

  const existing = await chrome.storage.local.get(["apiKey"]);
  const apiKey = typedKey || existing.apiKey || "";
  if (!apiKey) {
    show("Informe a chave.", "bad");
    return;
  }

  await chrome.storage.local.set({ baseUrl, apiKey });

  show("Testando…");
  const result = await chrome.runtime.sendMessage({ type: "ping" });

  if (result?.ok) {
    const account = result.data?.account?.name;
    show(account ? `Conectado a ${account}.` : "Conectado.", "ok");
    el("apiKey").value = "";
    el("apiKey").placeholder = "•••••••• (salva)";
    return;
  }

  if (result?.error === "unauthorized") {
    show("A chave foi recusada pelo CRM.", "bad");
  } else if (result?.error === "network") {
    show("Não consegui falar com esse endereço.", "bad");
  } else {
    show(result?.detail || "Não consegui validar a conexão.", "bad");
  }
}

el("save").addEventListener("click", () => void save());
void load();

// The shortcuts in the chat header: part of this person's panel
// choices, next to "collapsed" and the signature. The panel reads them
// again when WhatsApp's window gets the focus back.
async function loadShortcuts() {
  const prefs = (await chrome.storage.local.get("prefs")).prefs || {};
  el("shortcuts").checked = prefs.shortcuts !== false;
}

el("shortcuts").addEventListener("change", async () => {
  const prefs = (await chrome.storage.local.get("prefs")).prefs || {};
  await chrome.storage.local.set({ prefs: { ...prefs, shortcuts: el("shortcuts").checked } });
});
void loadShortcuts();
