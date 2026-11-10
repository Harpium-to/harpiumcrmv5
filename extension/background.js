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
// So: the key lives in chrome.storage.local, and every request to the
// CRM is made from here. The content script asks for data by message
// and receives data back. It never sees, and never needs, the
// credential.
//
// chrome.storage.local is open to content scripts by default, so the
// first thing this worker does is close it to them (setAccessLevel
// below). Our content script never reads storage directly — even its
// own preferences come through a message — so nothing is lost.
//
// The second reason is more mundane and equally load bearing: a fetch
// from the content script would be a cross-origin request from
// web.whatsapp.com, which the CRM would have to allow by CORS. A
// fetch from here carries the extension's own host permission and
// needs no CORS hole opened on the API for a third-party origin.
// ============================================================

import { phoneDigits, samePhone } from "./phone.js";

// Content scripts run in the web page's renderer process; keep them out
// of the storage that holds the key. Older Chrome builds only support
// this for storage.session — there it fails quietly and the content
// script still never asks for the key.
try {
  void chrome.storage.local
    .setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })
    ?.catch(() => {});
} catch {
  // Not supported for this storage area on this Chrome.
}

const SETTINGS_KEYS = ["baseUrl", "apiKey"];

// Chats the operator linked to a contact by hand (a lid chat, or a
// number with two records). Per CRM address, so switching CRMs never
// carries a link into the wrong one, and capped so it can't grow
// without end.
const LINKS_KEY = "links";
const MAX_LINKS_PER_CRM = 500;
const PREFS_KEY = "prefs";

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
      status: res.status,
      detail: body?.error?.message || body?.error || `HTTP ${res.status}`,
    };
  }
  return { ok: true, status: res.status, data: body?.data ?? body };
}

/** The contacts of `rows` that really are `digits`, by the phone rule. */
function samePhoneRows(rows, digits) {
  return (Array.isArray(rows) ? rows : []).filter((row) =>
    samePhone(digits, row?.phone),
  );
}

async function readLinks() {
  const { baseUrl } = await readSettings();
  const stored = await chrome.storage.local.get(LINKS_KEY);
  const all = stored[LINKS_KEY] && typeof stored[LINKS_KEY] === "object" ? stored[LINKS_KEY] : {};
  return { baseUrl, all, mine: { ...(all[baseUrl] || {}) } };
}

async function writeLinks(all, baseUrl, mine) {
  const keys = Object.keys(mine);
  // Insertion order is age order: the oldest links go first.
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_LINKS_PER_CRM))) {
    delete mine[key];
  }
  await chrome.storage.local.set({ [LINKS_KEY]: { ...all, [baseUrl]: mine } });
}

/** `phone:<digits>` or `lid:<digits>`, nothing else. */
function validChatKey(chatKey) {
  return typeof chatKey === "string" && /^(phone|lid):\d{4,20}$/.test(chatKey);
}

const handlers = {
  async ping() {
    return callApi("/me");
  },

  /** The CRM this key belongs to, for the panel's header. */
  async account() {
    const result = await callApi("/me");
    if (!result.ok) return result;
    return { ok: true, data: { name: result.data?.account?.name || null } };
  },

  /**
   * Every contact that is this phone number — usually one, sometimes
   * none, and two when the CRM has the same mobile with and without
   * the ninth digit (the panel then asks which).
   *
   * `?phone=` compares digits on the CRM, so formatting doesn't
   * matter. The rows are confirmed again here rather than trusted: a
   * panel that shows the wrong customer's details beside a chat is
   * worse than one that shows nothing, because somebody will act on it.
   */
  async lookup({ phone }) {
    const digits = phoneDigits(phone);
    if (digits.length < 8) return { ok: false, error: "no_phone" };

    const result = await callApi(`/contacts?phone=${encodeURIComponent(digits)}`);
    if (!result.ok) return result;
    return { ok: true, data: samePhoneRows(result.data, digits) };
  },

  /**
   * Create a contact for this number.
   *
   * The CRM's create is find-or-create, and its "find" is looser than
   * the panel's: it also accepts a number that only shares the last 8
   * digits — which can be someone in another area code. `sameNumber`
   * says whether what came back really is this number, so the panel
   * can ask instead of showing it.
   */
  async create({ phone, name }) {
    const digits = phoneDigits(phone);
    if (digits.length < 8) return { ok: false, error: "no_phone" };
    const result = await callApi("/contacts", {
      method: "POST",
      body: JSON.stringify({ phone: `+${digits}`, name: name || null }),
    });
    if (!result.ok) return result;
    return {
      ok: true,
      data: result.data,
      created: result.status === 201,
      sameNumber: samePhone(digits, result.data?.phone),
    };
  },

  /** One contact by id; `data: null` when it no longer exists. */
  async contact({ id }) {
    if (!id) return { ok: false, error: "no_id" };
    const result = await callApi(`/contacts/${encodeURIComponent(id)}`);
    if (!result.ok && result.status === 404) return { ok: true, data: null };
    return result;
  },

  /**
   * Contacts for the operator's own search, to link a chat by hand.
   *
   * A query that is a phone number goes first through the exact phone
   * filter, which ignores formatting. When that finds nothing — the
   * operator typed "31 99999-8888" without the country code — it
   * falls back to "contains these digits". Looser than the automatic
   * lookup on purpose: here a person reads the results and picks one.
   * Anything else searches names.
   */
  async search({ query }) {
    const text = String(query || "").trim().slice(0, 80);
    if (text.length < 2) return { ok: true, data: [] };
    const digits = phoneDigits(text);
    if (/^[\d\s+().‐-―-]+$/.test(text) && digits.length >= 8) {
      const exact = await callApi(`/contacts?phone=${encodeURIComponent(digits)}`);
      if (!exact.ok) return exact;
      const rows = samePhoneRows(exact.data, digits);
      if (rows.length) return { ok: true, data: rows };
    }
    const term = digits.length >= 8 && /^[\d\s+().‐-―-]+$/.test(text) ? digits : text;
    const result = await callApi(`/contacts?search=${encodeURIComponent(term)}&limit=8`);
    if (!result.ok) return result;
    return { ok: true, data: Array.isArray(result.data) ? result.data.slice(0, 8) : [] };
  },

  async getLink({ chatKey }) {
    if (!validChatKey(chatKey)) return { ok: true, data: null };
    const { mine } = await readLinks();
    return { ok: true, data: mine[chatKey] || null };
  },

  async setLink({ chatKey, contactId }) {
    if (!validChatKey(chatKey) || !contactId) return { ok: false, error: "no_id" };
    const { baseUrl, all, mine } = await readLinks();
    if (!baseUrl) return { ok: false, error: "not_configured" };
    delete mine[chatKey]; // re-inserted last: the newest link
    mine[chatKey] = String(contactId);
    await writeLinks(all, baseUrl, mine);
    return { ok: true };
  },

  async clearLink({ chatKey }) {
    if (!validChatKey(chatKey)) return { ok: true };
    const { baseUrl, all, mine } = await readLinks();
    if (!baseUrl || !(chatKey in mine)) return { ok: true };
    delete mine[chatKey];
    await writeLinks(all, baseUrl, mine);
    return { ok: true };
  },

  /** The panel's own preferences (today: whether it is collapsed). */
  async getPrefs() {
    const stored = await chrome.storage.local.get(PREFS_KEY);
    return { ok: true, data: { collapsed: Boolean(stored[PREFS_KEY]?.collapsed) } };
  },

  async setPrefs({ collapsed }) {
    await chrome.storage.local.set({ [PREFS_KEY]: { collapsed: Boolean(collapsed) } });
    return { ok: true };
  },

  async update({ id, fields }) {
    if (!id) return { ok: false, error: "no_id" };
    return callApi(`/contacts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(fields || {}),
    });
  },

  /** Open deals of one contact, each with its stage and pipeline. */
  async deals({ contactId }) {
    if (!contactId) return { ok: false, error: "no_id" };
    return callApi(`/deals?contact_id=${encodeURIComponent(contactId)}&status=open`);
  },

  /** Every pipeline with its stages, for the stage picker. */
  async pipelines() {
    return callApi("/pipelines");
  },

  async moveDeal({ id, stageId }) {
    if (!id || !stageId) return { ok: false, error: "no_id" };
    return callApi(`/deals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ stage_id: stageId }),
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
