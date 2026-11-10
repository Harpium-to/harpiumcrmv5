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

// See the `pipelines` handler. In memory only: it is gone whenever the
// worker is, which is the right lifetime for a cache.
let pipelinesCache = { baseUrl: null, at: 0, data: null };
let repliesCache = { baseUrl: null, at: 0, data: null };
// See the `sender` handler. Short: the answer is what keeps a message
// from leaving by the wrong number, so it must not outlive a re-pairing.
let senderCache = { baseUrl: null, at: 0, data: null };
const SENDER_TTL_MS = 60_000;

// See the `boardDeals` handler: 3 pages of 100.
const BOARD_PAGES = 3;

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
    // 401: the key is wrong or revoked. 403: it is fine, and lacks the
    // scope — a different message for whoever reads it.
    return { ok: false, error: "unauthorized", status: res.status };
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
  // `meta` carries the cursor of a paginated list, when there is one.
  return { ok: true, status: res.status, data: body?.data ?? body, meta: body?.meta ?? null };
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
    return {
      ok: true,
      data: {
        name: result.data?.account?.name || null,
        // The person the key belongs to, to sign messages with.
        person: result.data?.person?.name || null,
      },
    };
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
  /**
   * This person's panel choices: collapsed or not, and the signature
   * (on or off, and the name to sign with; "" means the CRM's name).
   */
  async getPrefs() {
    const stored = (await chrome.storage.local.get(PREFS_KEY))[PREFS_KEY] || {};
    return {
      ok: true,
      data: {
        collapsed: Boolean(stored.collapsed),
        sign: Boolean(stored.sign),
        signName: typeof stored.signName === "string" ? stored.signName.slice(0, 60) : "",
      },
    };
  },

  /** Change only the choices given; the others stay as they were. */
  async setPrefs(changes) {
    const current = (await chrome.storage.local.get(PREFS_KEY))[PREFS_KEY] || {};
    const next = { ...current };
    if ("collapsed" in changes) next.collapsed = Boolean(changes.collapsed);
    if ("sign" in changes) next.sign = Boolean(changes.sign);
    if ("signName" in changes) next.signName = String(changes.signName ?? "").slice(0, 60);
    await chrome.storage.local.set({ [PREFS_KEY]: next });
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

  /**
   * Every pipeline with its stages, for the stage pickers.
   *
   * The panel asks on every chat it opens, and a board changes a few
   * times a year: the answer is kept for a minute (per CRM address),
   * which takes a call off each chat switch without making a new stage
   * wait long to show up.
   */
  async pipelines() {
    const { baseUrl } = await readSettings();
    const fresh = pipelinesCache.baseUrl === baseUrl && Date.now() - pipelinesCache.at < 60_000;
    if (fresh) return { ok: true, data: pipelinesCache.data };
    const result = await callApi("/pipelines");
    if (result.ok) pipelinesCache = { baseUrl, at: Date.now(), data: result.data };
    return result;
  },

  async moveDeal({ id, stageId }) {
    if (!id || !stageId) return { ok: false, error: "no_id" };
    return callApi(`/deals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ stage_id: stageId }),
    });
  },

  /**
   * The open deals of one pipeline, for the board.
   *
   * The API pages them 100 at a time; this follows the cursor for up
   * to BOARD_PAGES pages and says so when there were more. A board
   * with hundreds of cards per column is not something anyone reads
   * inside a chat window — the CRM's own board is one click away.
   */
  async boardDeals({ pipelineId }) {
    if (!pipelineId) return { ok: false, error: "no_id" };
    const deals = [];
    let cursor = null;
    for (let page = 0; page < BOARD_PAGES; page += 1) {
      const query =
        `/deals?pipeline_id=${encodeURIComponent(pipelineId)}&status=open&limit=100` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      const result = await callApi(query);
      if (!result.ok) return result;
      deals.push(...(Array.isArray(result.data) ? result.data : []));
      cursor = result.meta?.next_cursor ?? null;
      if (!cursor) break;
    }
    return { ok: true, data: { deals, truncated: Boolean(cursor) } };
  },

  /** Mark a deal won or lost — or open again, to undo that. */
  async setDealStatus({ id, status }) {
    if (!id || !["open", "won", "lost"].includes(status)) return { ok: false, error: "no_id" };
    return callApi(`/deals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  },

  async createDeal({ contactId, title, value, pipelineId, stageId }) {
    if (!contactId) return { ok: false, error: "no_id" };
    return callApi("/deals", {
      method: "POST",
      body: JSON.stringify({
        contact_id: contactId,
        title,
        value,
        ...(pipelineId ? { pipeline_id: pipelineId } : {}),
        ...(stageId ? { stage_id: stageId } : {}),
      }),
    });
  },

  /** The contact's recent notes, newest first. */
  async notes({ contactId }) {
    if (!contactId) return { ok: false, error: "no_id" };
    return callApi(`/contacts/${encodeURIComponent(contactId)}/notes`);
  },

  async addNote({ contactId, text }) {
    if (!contactId) return { ok: false, error: "no_id" };
    return callApi(`/contacts/${encodeURIComponent(contactId)}/notes`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  },

  /** A contact's open tasks, soonest first. */
  async tasks({ contactId }) {
    if (!contactId) return { ok: false, error: "no_id" };
    return callApi(`/contacts/${encodeURIComponent(contactId)}/tasks`);
  },

  /** The open tasks of the person this key belongs to, across contacts. */
  async myTasks() {
    return callApi("/tasks?assigned=me");
  },

  async addTask({ contactId, title, dueAt }) {
    if (!contactId) return { ok: false, error: "no_id" };
    return callApi(`/contacts/${encodeURIComponent(contactId)}/tasks`, {
      method: "POST",
      body: JSON.stringify({ title, ...(dueAt ? { due_at: dueAt } : {}) }),
    });
  },

  /** Mark a task done, or open again to undo that. */
  async setTaskDone({ id, done }) {
    if (!id) return { ok: false, error: "no_id" };
    return callApi(`/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ done: Boolean(done) }),
    });
  },

  /** Where the contact's conversation stands in the CRM; null if none. */
  async conversation({ contactId }) {
    if (!contactId) return { ok: false, error: "no_id" };
    return callApi(`/contacts/${encodeURIComponent(contactId)}/conversation`);
  },

  /** Pause the bot on a conversation and make this person its owner. */
  async takeOver({ id }) {
    if (!id) return { ok: false, error: "no_id" };
    return callApi(`/conversations/${encodeURIComponent(id)}/takeover`, { method: "POST" });
  },

  /** The CRM's tags, to offer while editing a contact's. */
  async tags() {
    return callApi("/tags");
  },

  /**
   * The CRM's quick replies: text, and those with a file (migration
   * 063; an older CRM just returns the text ones). Kept for a minute,
   * like the pipelines: the list is opened many times a day and edited
   * rarely.
   */
  async quickReplies() {
    const { baseUrl } = await readSettings();
    const fresh = repliesCache.baseUrl === baseUrl && Date.now() - repliesCache.at < 60_000;
    if (fresh) return { ok: true, data: repliesCache.data };
    const result = await callApi("/quick-replies?include=media");
    if (result.ok) repliesCache = { baseUrl, at: Date.now(), data: result.data };
    return result;
  },

  /**
   * The number a message sent through the CRM leaves from. The panel
   * compares it with the number logged in to WhatsApp Web before it
   * offers to send. 403 means the key may not send (before migration
   * 062); the panel then just doesn't offer.
   */
  async sender() {
    const { baseUrl } = await readSettings();
    const fresh = senderCache.baseUrl === baseUrl && Date.now() - senderCache.at < SENDER_TTL_MS;
    if (fresh) return { ok: true, data: senderCache.data };
    const result = await callApi("/whatsapp/sender");
    if (result.ok) senderCache = { baseUrl, at: Date.now(), data: result.data };
    return result;
  },

  /**
   * Send a text through the CRM, to `to` (+digits). The CRM finds the
   * contact and conversation by that number and sends from the number
   * connected to it; the panel has already checked that both line up.
   */
  async sendText({ to, text }) {
    if (typeof to !== "string" || !/^\+\d{8,15}$/.test(to)) {
      return { ok: false, error: "bad_phone" };
    }
    if (typeof text !== "string" || !text.trim()) return { ok: false, error: "no_text" };
    return callApi("/messages", {
      method: "POST",
      body: JSON.stringify({ to, type: "text", text }),
    });
  },

  /**
   * Send a quick reply's file through the CRM: a photo, a video, a
   * document, or an audio (which goes as a voice note, no caption). The
   * URL is the reply's own, as the CRM listed it.
   */
  async sendMedia({ to, kind, url, caption, filename }) {
    if (typeof to !== "string" || !/^\+\d{8,15}$/.test(to)) {
      return { ok: false, error: "bad_phone" };
    }
    if (!["image", "video", "document", "audio"].includes(kind)) {
      return { ok: false, error: "bad_kind" };
    }
    if (typeof url !== "string" || !/^https:\/\//.test(url)) return { ok: false, error: "bad_url" };
    const body = { to, type: kind, media_url: url };
    if (kind !== "audio" && typeof caption === "string" && caption.trim()) body.text = caption;
    if (kind === "document" && typeof filename === "string" && filename) body.filename = filename;
    return callApi("/messages", { method: "POST", body: JSON.stringify(body) });
  },

  /** What is scheduled for a contact (migration 064). Not cached. */
  async scheduled({ contactId }) {
    if (!contactId) return { ok: false, error: "no_id" };
    return callApi(`/contacts/${encodeURIComponent(contactId)}/scheduled-messages`);
  },

  /**
   * Schedule a message for a contact: a text, or a quick reply's file
   * with its caption. `onlyIfNoReply` makes it a follow-up.
   */
  async schedule({ contactId, text, quickReplyId, sendAt, onlyIfNoReply }) {
    if (!contactId) return { ok: false, error: "no_id" };
    if (typeof sendAt !== "string" || !sendAt) return { ok: false, error: "no_time" };
    const body = { send_at: sendAt, only_if_no_reply: Boolean(onlyIfNoReply) };
    if (typeof text === "string" && text.trim()) body.text = text;
    if (typeof quickReplyId === "string" && quickReplyId) body.quick_reply_id = quickReplyId;
    return callApi(`/contacts/${encodeURIComponent(contactId)}/scheduled-messages`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** Cancel a scheduled message that has not gone yet. */
  async cancelScheduled({ id }) {
    if (!id) return { ok: false, error: "no_id" };
    return callApi(`/scheduled-messages/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  /**
   * The CRM's sequences (automations started by hand), and which are
   * running for this contact. Not cached: "running" changes as the
   * sequence goes.
   */
  async sequences({ contactId }) {
    if (!contactId) return { ok: false, error: "no_id" };
    return callApi(`/sequences?contact_id=${encodeURIComponent(contactId)}`);
  },

  /** Start a sequence on a contact; the CRM checks its limits. */
  async startSequence({ id, contactId }) {
    if (!id || !contactId) return { ok: false, error: "no_id" };
    return callApi(`/sequences/${encodeURIComponent(id)}/start`, {
      method: "POST",
      body: JSON.stringify({ contact_id: contactId }),
    });
  },

  /** Stop what is left of a sequence for a contact. */
  async stopSequence({ id, contactId }) {
    if (!id || !contactId) return { ok: false, error: "no_id" };
    return callApi(`/sequences/${encodeURIComponent(id)}/stop`, {
      method: "POST",
      body: JSON.stringify({ contact_id: contactId }),
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
