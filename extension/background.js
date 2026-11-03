// ============================================================
// Service worker: the only place the API key exists.
//
// THIS IS THE SECURITY DESIGN OF THE EXTENSION, not an architectural
// preference. A content script runs in web.whatsapp.com's own page
// context, sharing a world with every script WhatsApp loads. A key
// kept there — in a variable, in localStorage, in a DOM attribute —
// is readable by any of them, and an API key for a CRM is read access
// to every customer the company has.
//
// So: the key lives in chrome.storage.local, which content scripts
// cannot reach, and every request to the CRM is made from here. The
// content script asks for data by message and receives data back. It
// never sees, and never needs, the credential.
//
// The second reason is more mundane and equally load bearing: a fetch
// from the content script would be a cross-origin request from
// web.whatsapp.com, which the CRM would have to allow by CORS. A
// fetch from here carries the extension's own host permission and
// needs no CORS hole opened on the API for a third-party origin.
// ============================================================

const SETTINGS_KEYS = ["baseUrl", "apiKey"];

async function readSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEYS);
  const baseUrl = (stored.baseUrl || "").replace(/\/+$/, "");
  const apiKey = stored.apiKey || "";
  return { baseUrl, apiKey };
}

/**
 * One call to the CRM's public API.
 *
 * Errors come back as a value rather than a thrown exception because
 * the only consumer is a message handler — a rejected promise there
 * becomes "could not establish connection", which tells whoever is
 * debugging nothing about the 401 that actually happened.
 */
async function callApi(path, init = {}) {
  const { baseUrl, apiKey } = await readSettings();
  if (!baseUrl || !apiKey) {
    return { ok: false, error: "not_configured" };
  }

  let res;
  try {
    res = await fetch(`${baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
  } catch {
    // Wrong base URL, CRM down, or the host permission was revoked.
    return { ok: false, error: "network" };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "unauthorized" };
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok: false,
      error: "api",
      detail: body?.error?.message || body?.error || `HTTP ${res.status}`,
    };
  }
  return { ok: true, data: body?.data ?? body };
}

const handlers = {
  async ping() {
    return callApi("/me");
  },

  /**
   * Find the contact for a phone number.
   *
   * `?search=` matches name OR phone, so a result is confirmed by
   * comparing digits here rather than trusting the first row. A panel
   * that shows the wrong customer's details beside a chat is worse
   * than one that shows nothing: somebody will act on it.
   */
  async lookup({ phone }) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return { ok: false, error: "no_phone" };

    const result = await callApi(`/contacts?search=${encodeURIComponent(digits)}`);
    if (!result.ok) return result;

    const rows = Array.isArray(result.data) ? result.data : [];
    const match = rows.find(
      (row) => String(row.phone || "").replace(/\D/g, "") === digits,
    );
    return { ok: true, data: match ?? null };
  },

  async create({ phone, name }) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return { ok: false, error: "no_phone" };
    return callApi("/contacts", {
      method: "POST",
      body: JSON.stringify({ phone: `+${digits}`, name: name || null }),
    });
  },

  async update({ id, fields }) {
    if (!id) return { ok: false, error: "no_id" };
    return callApi(`/contacts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(fields || {}),
    });
  },

  async settings() {
    const { baseUrl, apiKey } = await readSettings();
    // The key itself never crosses this boundary — only whether one
    // is set, which is all the panel needs to render its empty state.
    return { ok: true, data: { baseUrl, configured: Boolean(baseUrl && apiKey) } };
  },

  async openOptions() {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) {
    sendResponse({ ok: false, error: "unknown_message" });
    return false;
  }
  handler(message.payload || {})
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: "internal", detail: String(err) }));
  // Keeps the message channel open for the async response above.
  return true;
});
