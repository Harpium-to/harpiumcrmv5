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
// The mark on <html> that the `#app` rule in content.css reads. An
// attribute, not a class: on the real WhatsApp Web (November 2026)
// something rewrites <html>'s class list and drops any class it does
// not know in the same tick it is added. An attribute is left alone.
const DOCK_ATTR = "data-crmc-docked";

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
// Whether the panel is meant to be docked right now. Kept here rather
// than read back from the page, which can take the mark off <html>.
let docked = false;
// How long WhatsApp gets to make room after the mark goes on, and
// until when that wait lasts: nothing measures the dock before then.
const DOCK_SETTLE_MS = 300;
let dockSettlesAt = 0;

// The CRM the extension is connected to, for the header. Asked once
// per CRM address; a failed ask is retried no more than once a minute.
let account = { baseUrl: null, name: null, person: null, askedAt: 0 };
// The attendant's signature (Fase 4B, step 4): this person's choice,
// kept in the extension. `name` is what they typed; empty means the
// name the CRM has for them (`account.person`).
let signature = { on: false, name: "" };
// The shortcut bar in WhatsApp's chat header: shown unless the person
// turned it off in the extension's options.
let shortcutsOn = true;
let shortcutsShown = 0;

// The open deals of the contact on screen. Kept apart from the contact
// so re-drawing the card (after a temperature change) doesn't refetch
// them, and keyed by contact so a late reply for the previous chat is
// recognisable as late.
// `closed` is the deal just closed as won or lost from here, kept so
// the list can offer to take it back.
let dealsState = {
  contactId: null,
  status: "idle",
  deals: [],
  pipelines: [],
  notice: null,
  closed: null,
};

// Which tab of the record is showing. Kept across chats: someone
// writing notes all morning wants the next chat to open on notes too.
let activeTab = "deals";
let dealFormOpen = false;

// The contact's notes, loaded when the notes tab is first shown.
let notesState = { contactId: null, status: "idle", notes: [], notice: null };

// Editing the contact's own data. `editTags` is the tag names as they
// will be saved; the CRM's tags (for suggestions) are asked once.
let editingContact = false;
let editTags = [];
let tagsCache = { baseUrl: null, names: null };

// Tasks. `tasksState` is the open tasks of the contact on screen (a
// tab of the record); `myTasks` is this person's own open tasks across
// contacts, behind the footer's count, reloaded every few minutes.
// `lastDoneTask` is the one just ticked, so it can be un-ticked.
let tasksState = { contactId: null, status: "idle", tasks: [], notice: null };
let myTasks = { baseUrl: null, status: "idle", tasks: [], notice: null, at: 0 };
let lastDoneTask = null;
let lastTaskError = null;
const MY_TASKS_EVERY_MS = 5 * 60_000;

// Where the contact's conversation stands in the CRM (bot answering,
// waiting for a person, taken over); null when the CRM has none.
let convState = { contactId: null, data: null };

// Which sheet covers the record: "replies", "tasks" or none.
let sheetKind = null;

// The quick-replies sheet: open or not, what was typed in its search,
// and the CRM's replies (asked again each time the sheet opens; the
// service worker answers from memory when it asked a minute ago).
let repliesOpen = false;
let repliesQuery = "";
let repliesState = { baseUrl: null, status: "idle", items: [], notice: null };

// Sending a quick reply through the CRM (Fase 4B). `myWhatsAppPhone`
// is the number logged in to this WhatsApp Web, read with the open
// chat; `senderState` is the number the CRM would send from. The panel
// offers "Enviar" only when the two are the same (send-check.js).
// `pendingSend` is the reply whose "Enviar" was clicked once and now
// waits for "Confirmar"; it lapses after a few seconds or when the
// chat changes.
let myWhatsAppPhone = null;
let senderState = { baseUrl: null, status: "idle", provider: null, phone: null, at: 0 };
let pendingSend = null;
let sendingReply = false;
const SEND_CONFIRM_MS = 5000;
// Sequences (Fase 4B, step 5): the CRM's automations started by hand,
// listed under the replies for the contact on the panel. `pendingSeq`
// is the one whose "Iniciar" was clicked once and waits for
// "Confirmar".
let seqState = { contactId: null, status: "idle", items: [] };
// Chatbot flows started by hand (Fase 7): listed under the sequences.
let flowsState = { baseUrl: null, status: "idle", items: [] };
let pendingFlow = null;
let flowBusy = false;
// Scheduling (Fase 5): "Enviar agora" or "Agendar" in the replies
// sheet, and what is scheduled for the contact on the panel.
let sendMode = "now";
let schedState = { contactId: null, status: "idle", items: [] };
let scheduling = false;
let pendingSeq = null;
let seqBusy = false;
// What a person calls the file of a quick reply (migration 063).
const MEDIA_LABELS = { image: "Imagem", video: "Vídeo", document: "Arquivo", audio: "Áudio" };

// The board: open or not, its search, and the pipeline it shows.
// `moved` is set once a card was moved, so the record beside the chat
// knows to reload its own deals when the board closes.
let boardOpen = false;
let boardQuery = "";
let boardState = {
  baseUrl: null,
  status: "idle",
  pipelines: [],
  pipelineId: null,
  deals: [],
  truncated: false,
  notice: null,
  moveNotice: null,
  moved: false,
};

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
let myPhoneFromPage = () => null;
let chatFromDataIds = () => null;
let phoneFromHeaderTitles = () => null;
let usableChatName = () => null;
let modulesLoaded = false;
// Until theme.js loads, the system preference is all there is.
let pickMode = (_colors, prefersDark) => (prefersDark ? "dark" : "light");
// From format.js. The fallbacks keep the panel usable without it.
let parseMoney = (text) => (String(text ?? "").trim() === "" ? 0 : null);
let formatWhen = () => "";
let addTagName = (names) => names;
let fillTemplate = (text) => ({ text: String(text ?? ""), missing: [] });
let filterReplies = (replies) => [...(replies ?? [])];
let filterDeals = (deals) => [...(deals ?? [])];
let boardColumns = (stages, deals) =>
  (stages ?? []).map((stage) => ({
    stage,
    deals: (deals ?? []).filter((deal) => deal.stage?.id === stage.id),
    total: null,
  }));
let chatPhone = () => null;
let describeDue = () => null;
let countDueNow = () => 0;
let localInputToIso = () => null;
let signText = (text) => String(text ?? "");
let cleanSignatureName = (name) => String(name ?? "").trim();
let describeDuration = () => "";
let defaultScheduleValue = () => "";
// From shortcuts.js. Without it there is simply no bar.
let placeShortcuts = () => null;
let measureHeader = () => ({ nameRight: 0, actionsLeft: 0 });
let describeScheduled = (item) => String(item?.status ?? "");
let googleCalendarUrl = () => null;
let taskEventDetails = () => "";
// From send-check.js. Without it the panel never offers to send.
let sendCheck = () => ({ ok: false, why: null });

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
  const answer = askPage();
  myWhatsAppPhone = myPhoneFromPage(answer);
  let found = chatFromPage(answer);
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
 * Docking narrows WhatsApp's root through a mark on <html>. It is
 * only kept when it demonstrably worked: a WhatsApp build whose root
 * isn't `#app`, or doesn't obey the width, would otherwise leave the
 * panel covering a third of the chat with nothing to show for it.
 */
function applyLayout() {
  const node = ensurePanel();
  const collapsed = node.classList.contains("crmc-collapsed");
  docked = !collapsed && !dockFailed && window.innerWidth >= DOCK_MIN_VIEWPORT;
  document.documentElement.toggleAttribute(DOCK_ATTR, docked);
  node.classList.toggle("crmc-floating", !docked);
  if (docked) checkDockSoon();
}

/**
 * Measure once the page has had time to settle. Not on the next frame:
 * a width that animates would still read as "didn't shrink" there.
 */
function checkDockSoon() {
  dockSettlesAt = Date.now() + DOCK_SETTLE_MS;
  setTimeout(verifyDock, DOCK_SETTLE_MS);
}

/** True when WhatsApp's root really ends where the panel begins. */
function appMadeRoom() {
  const app = document.querySelector("#app");
  const limit = window.innerWidth - PANEL_WIDTH + 2;
  return Boolean(app && app.getBoundingClientRect().right <= limit);
}

/**
 * Docked, but WhatsApp did not get narrower: float instead.
 *
 * Decided by measuring, never by looking for the mark on <html>. The
 * page can take the mark off, and a missing mark used to end this
 * check early — leaving the panel neither docked nor floating, on top
 * of the chat.
 */
function verifyDock() {
  if (!docked || appMadeRoom()) return;
  dockFailed = true;
  applyLayout();
}

/**
 * Run on every poll. The page may undo the dock long after it worked
 * (anything that rewrites <html>'s attributes would): put the mark
 * back once, and float if WhatsApp still does not make room.
 */
function keepDock() {
  // A check is already on its way while the page settles.
  if (!docked || Date.now() < dockSettlesAt || appMadeRoom()) return;
  const html = document.documentElement;
  if (html.hasAttribute(DOCK_ATTR)) {
    verifyDock();
    return;
  }
  html.setAttribute(DOCK_ATTR, "");
  checkDockSoon();
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
    account = { baseUrl, name: null, person: null, askedAt: 0 };
    paintAccount();
  }
  if (!baseUrl || account.name || Date.now() - account.askedAt < 60_000) return;
  account.askedAt = Date.now();
  const result = await send("account");
  if (account.baseUrl !== baseUrl) return;
  if (result.ok && result.data?.name) {
    account.name = result.data.name;
    account.person = result.data.person || null;
    paintAccount();
    paintSignature();
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
    <section class="crmc-sheet" aria-label="Respostas rápidas"></section>
    <footer class="crmc-foot">
      <button class="crmc-btn crmc-btn-quiet" data-act="replies-open">Respostas</button>
      <button class="crmc-btn crmc-btn-quiet" data-act="board-open">Funil</button>
      <button class="crmc-btn crmc-btn-quiet" data-act="mytasks-open" title="Minhas tarefas">Tarefas<span class="crmc-count crmc-badge" hidden></span></button>
    </footer>
    <section class="crmc-board" aria-label="Funil"></section>
    <nav class="crmc-shortcuts" aria-label="Atalhos do Harpium CRM" hidden></nav>
  `;
  document.body.appendChild(panel);
  // A panel rebuilt after WhatsApp replaced the page starts closed.
  repliesOpen = false;
  sheetKind = null;
  boardOpen = false;
  wireBoardDragging(panel.querySelector(".crmc-board"));

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
      if (collapsed) setBoardOpen(false);
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
    if (action === "tab") openTab(target.getAttribute("data-tab"));
    if (action === "deal-new" || action === "deal-cancel") {
      dealFormOpen = action === "deal-new";
      paintDealForm();
    }
    if (action === "deal-status") {
      void closeDeal(target.getAttribute("data-deal"), target.getAttribute("data-status"));
    }
    if (action === "deal-undo") void reopenDeal();
    if (action === "edit") startEditingContact();
    if (action === "edit-cancel") {
      editingContact = false;
      paintPane();
    }
    if (action === "tag-add") addTagFromInput();
    if (action === "tag-remove") removeEditTag(target.getAttribute("data-name"));
    if (action === "replies-open") setRepliesOpen(true);
    if (action === "replies-close") setRepliesOpen(false);
    if (action === "reply-use") void useReply(target.getAttribute("data-id"));
    if (action === "reply-send") void sendReply(target.getAttribute("data-id"));
    if (action === "seq-start") void startSequence(target.getAttribute("data-id"));
    if (action === "mode-now" || action === "mode-later") setSendMode(action === "mode-later" ? "later" : "now");
    if (action === "reply-schedule") void scheduleReply(target.getAttribute("data-id"));
    if (action === "schedule-text") void scheduleTyped();
    if (action === "sched-cancel") void cancelScheduled(target.getAttribute("data-id"));
    if (action === "seq-stop") void stopSequence(target.getAttribute("data-id"));
    if (action === "mytasks-open") setMyTasksOpen(true);
    if (action === "mytasks-close") setMyTasksOpen(false);
    if (action === "task-done") void setTaskDone(findTask(target.getAttribute("data-id")), true);
    if (action === "task-undo") void setTaskDone(lastDoneTask, false);
    if (action === "conv-take") void takeOverConversation();
    if (action === "conv-handback") void conversationAction("handBack", "devolver conversas para a IA");
    if (action === "conv-flow-pause") void conversationAction("pauseFlow", "pausar fluxos");
    if (action === "flow-start") void startFlow(target.getAttribute("data-id"));
    if (action === "board-open") setBoardOpen(true);
    if (action?.startsWith("sc-")) runShortcut(action.slice(3));
    if (action === "board-close") setBoardOpen(false);
    if (action === "board-refresh") void loadBoard();
    if (action === "board-chat") openChatWith(target.getAttribute("data-phone"));
  });

  panel.addEventListener("input", (event) => {
    const classes = event.target?.classList;
    if (classes?.contains("crmc-replies-search")) {
      repliesQuery = event.target.value;
      setRepliesStatus("");
      paintReplies();
    } else if (classes?.contains("crmc-board-search")) {
      boardQuery = event.target.value;
      paintBoard();
    }
  });


  panel.addEventListener("change", (event) => {
    const select = event.target;
    if (select?.classList?.contains("crmc-sign-on")) {
      setSignature({ on: select.checked });
    } else if (select?.classList?.contains("crmc-sign-name")) {
      // Saved when the person leaves the field, not at every key.
      setSignature({ name: select.value });
    } else if (select?.classList?.contains("crmc-stage")) {
      void moveDeal(select.getAttribute("data-deal"), select.value);
    } else if (select?.classList?.contains("crmc-kcard-move")) {
      void moveBoardDeal(select.getAttribute("data-deal"), select.value);
    } else if (select?.name === "board-pipeline") {
      void loadBoard(select.value);
    } else if (select?.name === "pipeline" && select.form?.dataset.form === "deal") {
      syncDealStages(select.form);
    }
  });

  panel.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    const kind = form?.dataset?.form;
    if (kind === "note") void submitNote(form);
    else if (kind === "task") void submitTask(form);
    else if (kind === "deal") void submitDeal(form);
    else if (kind === "contact") void submitContact(form);
    else {
      const input = form?.querySelector?.("input");
      if (input) void runSearch(input.value);
    }
  });

  panel.addEventListener("keydown", (event) => {
    // Enter in the tag field adds the tag; it must not save the form.
    if (event.key === "Enter" && event.target?.classList?.contains("crmc-taginput")) {
      event.preventDefault();
      addTagFromInput();
    }
    if (event.key === "Escape" && repliesOpen) setRepliesOpen(false);
    if (event.key === "Escape" && sheetKind === "tasks") setMyTasksOpen(false);
  });

  // The board covers WhatsApp, so Escape must close it wherever the
  // focus is — and must not also reach WhatsApp, which closes the chat
  // on Escape. `panel` in the closure: a rebuilt panel adds its own.
  const owner = panel;
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !boardOpen || panel !== owner) return;
      event.stopPropagation();
      setBoardOpen(false);
    },
    true,
  );

  // Typing in the panel must not reach WhatsApp's own keyboard
  // handling (shortcuts, focusing its message box).
  for (const type of ["keydown", "keyup", "keypress"]) {
    panel.addEventListener(type, (event) => event.stopPropagation());
  }

  applyMode();
  applyLayout();
  paintAccount();

  void readPrefs();

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

// ------------------------------------------------------------
// The contact's record
//
// Drawn in slots — who, temperature, tabs, pane — and each slot is
// repainted on its own. That is what lets a temperature click or a
// stage change land without wiping a half-written note or an open
// form in another slot.
// ------------------------------------------------------------

function slot(selector) {
  return body().querySelector(selector);
}

/** A reply that is no longer for the contact on screen is dropped. */
function stillShowing(contactId, gen) {
  return gen === generation && currentContact?.id === contactId;
}

/** Why a write failed, in the operator's terms. */
function failureText(result, what) {
  if (result.error === "unauthorized") return `A chave não tem permissão para ${what}.`;
  if (result.error === "network") return "Não consegui falar com o CRM.";
  // An older CRM without this endpoint yet.
  if (result.status === 404) return "Este CRM ainda não aceita isso pela extensão. Atualize o CRM.";
  return result.detail || "Algo deu errado. Tente de novo.";
}

function showFormError(form, message) {
  const line = form?.querySelector(".crmc-err");
  if (!line) return;
  line.textContent = message || "";
  line.hidden = !message;
}

function setFormBusy(form, busy) {
  for (const control of form?.querySelectorAll("button, input, select, textarea") ?? []) {
    control.disabled = busy;
  }
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

function renderContact(contact) {
  currentContact = contact;
  render(`
    <div class="crmc-who"></div>
    <div class="crmc-conv"></div>
    <div class="crmc-tempslot"></div>
    <nav class="crmc-tabs" role="tablist" aria-label="Seções do contato"></nav>
    <div class="crmc-pane" role="tabpanel"></div>
    <a class="crmc-btn crmc-btn-quiet" target="_blank" rel="noreferrer noopener"
       href="${escapeHtml(contactUrl(contact.id))}">
      Abrir no CRM
    </a>
  `);
  paintWho();
  paintConversation();
  paintTemperature();
  paintTabs();
  paintPane();
}

/** Show a contact for the open chat and load its deals. */
function showContact(contact, { linked = false } = {}) {
  currentLinked = linked;
  dealFormOpen = false;
  editingContact = false;
  lastDoneTask = null;
  renderContact(contact);
  void loadDeals(contact.id);
  void loadConversation(contact.id);
  // The previews now have the CRM's name for this person.
  paintReplies();
}

function paintWho() {
  const el = slot(".crmc-who");
  const contact = currentContact;
  if (!el || !contact) return;
  el.innerHTML = `
    <p class="crmc-name">${escapeHtml(contact.name || contact.phone)}</p>
    <p class="crmc-sub">${escapeHtml(contact.phone)}</p>
    ${
      currentLinked
        ? `<p class="crmc-linked">Vínculo lembrado neste navegador ·
             <button class="crmc-link" data-act="unlink">Desfazer</button></p>`
        : ""
    }`;
}

// ---- Temperature --------------------------------------------

function paintTemperature(notice) {
  const el = slot(".crmc-tempslot");
  const contact = currentContact;
  if (!el || !contact) return;
  // `null` means the CRM hasn't applied migration 045 yet: there is no
  // column to write to, so there is no control to offer.
  if (!contact.temperature) {
    el.innerHTML = "";
    return;
  }
  const buttons = TEMPERATURES.map(
    ([value, label]) => `
      <button class="crmc-seg" data-act="temperature" data-value="${value}"
              aria-pressed="${contact.temperature === value}">${label}</button>`,
  ).join("");
  el.innerHTML = `
    <div class="crmc-temp" role="group" aria-label="Temperatura">${buttons}</div>
    ${notice ? `<p class="crmc-err">${escapeHtml(notice)}</p>` : ""}`;
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
  if (!stillShowing(contact.id, gen)) return;

  if (!result.ok) {
    paintTemperature(failureText(result, "editar contatos"));
    return;
  }
  currentContact = result.data;
  paintTemperature();
}

// ---- Tabs ---------------------------------------------------

const TABS = [
  ["deals", "Negócios"],
  ["tasks", "Tarefas"],
  ["notes", "Notas"],
  ["info", "Dados"],
];

function paintTabs() {
  const el = slot(".crmc-tabs");
  if (!el || !currentContact) return;
  const dealsKnown =
    dealsState.contactId === currentContact.id && dealsState.status === "ready";
  const numbers = {
    deals: dealsKnown ? dealsState.deals.length : 0,
    tasks: contactTaskCount(),
  };
  el.innerHTML = TABS.map(([id, label]) => {
    const count = numbers[id] ? ` <span class="crmc-count">${numbers[id]}</span>` : "";
    return `<button class="crmc-tabbtn" role="tab" data-act="tab" data-tab="${id}"
                    aria-selected="${activeTab === id}">${label}${count}</button>`;
  }).join("");
}

function openTab(tab) {
  if (!TABS.some(([id]) => id === tab) || tab === activeTab) return;
  activeTab = tab;
  dealFormOpen = false;
  editingContact = false;
  paintTabs();
  paintPane();
}

function paintPane() {
  const el = slot(".crmc-pane");
  const contact = currentContact;
  if (!el || !contact) return;

  if (activeTab === "notes") {
    el.innerHTML = `
      <form class="crmc-form" data-form="note">
        <textarea class="crmc-input crmc-textarea" name="text" rows="3" maxlength="4000"
                  placeholder="Escreva uma anotação sobre este contato"
                  aria-label="Nova anotação"></textarea>
        <p class="crmc-err" hidden></p>
        <button class="crmc-btn" type="submit">Salvar anotação</button>
      </form>
      <div class="crmc-notes"></div>`;
    paintNotes();
    if (notesState.contactId !== contact.id) void loadNotes(contact.id);
    return;
  }

  if (activeTab === "tasks") {
    el.innerHTML = `
      <form class="crmc-form" data-form="task">
        <input class="crmc-input crmc-task-title-input" name="title" maxlength="200" autocomplete="off"
               placeholder="O que precisa ser feito?" aria-label="Nova tarefa" />
        <div class="crmc-taskwhen">
          <input class="crmc-input" name="due" type="datetime-local" aria-label="Para quando (opcional)" />
          <button class="crmc-btn crmc-btn-small" type="submit">Adicionar</button>
        </div>
        <p class="crmc-err" hidden></p>
      </form>
      <div class="crmc-tasks"></div>`;
    paintTasks();
    if (tasksState.contactId !== contact.id) void loadTasks(contact.id);
    return;
  }

  if (activeTab === "info") {
    el.innerHTML = editingContact ? renderContactForm(contact) : renderContactInfo(contact);
    if (editingContact) {
      paintTagEdit();
      void loadTags();
    }
    return;
  }

  el.innerHTML = `<div class="crmc-deals"></div><div class="crmc-dealform"></div>`;
  paintDeals();
  paintDealForm();
}

// ---- Deals --------------------------------------------------

function stageOptions(stages, selectedId) {
  return stages
    .map(
      (stage) =>
        `<option value="${escapeHtml(stage.id)}"${
          stage.id === selectedId ? " selected" : ""
        }>${escapeHtml(stage.name)}</option>`,
    )
    .join("");
}

function renderDeal(deal) {
  const pipeline = dealsState.pipelines.find((p) => p.id === deal.pipeline?.id);
  // A stage list that doesn't include the current stage would show the
  // wrong one selected, so fall back to just the stage it is in.
  const stages = pipeline?.stages?.length ? pipeline.stages : deal.stage ? [deal.stage] : [];
  const id = escapeHtml(deal.id);
  return `
    <div class="crmc-deal">
      <p class="crmc-deal-head">
        <span class="crmc-deal-title">${escapeHtml(deal.title)}</span>
        <span class="crmc-deal-value">${escapeHtml(formatMoney(deal.value, deal.currency))}</span>
      </p>
      <select class="crmc-select crmc-stage" data-deal="${id}"
              aria-label="Etapa de ${escapeHtml(deal.title)}">${stageOptions(stages, deal.stage?.id)}</select>
      <p class="crmc-deal-actions">
        Fechar como
        <button class="crmc-link" data-act="deal-status" data-deal="${id}" data-status="won">ganho</button>
        ou
        <button class="crmc-link" data-act="deal-status" data-deal="${id}" data-status="lost">perdido</button>
      </p>
    </div>`;
}

function renderDeals(contactId) {
  if (dealsState.contactId !== contactId) return "";
  const { status, deals, notice, closed } = dealsState;
  if (status === "loading") return `<p class="crmc-muted">Carregando…</p>`;
  if (status === "forbidden") {
    return `<p class="crmc-muted">A chave de API não tem acesso a negócios.</p>`;
  }
  if (status === "error") return `<p class="crmc-muted">Não consegui carregar os negócios.</p>`;
  const list = deals.length
    ? deals.map(renderDeal).join("")
    : `<p class="crmc-muted">Nenhum negócio em aberto.</p>`;
  // A deal just closed leaves the list (it shows open deals); this
  // line is what says where it went, and takes it back.
  const undo = closed
    ? `<p class="crmc-muted crmc-undo">“${escapeHtml(closed.title)}” fechado como ${
        closed.status === "won" ? "ganho" : "perdido"
      }. <button class="crmc-link" data-act="deal-undo">Desfazer</button></p>`
    : "";
  return `
    ${list}
    ${undo}
    ${notice ? `<p class="crmc-err">${escapeHtml(notice)}</p>` : ""}`;
}

function paintDeals() {
  const el = slot(".crmc-deals");
  if (el && currentContact) el.innerHTML = renderDeals(currentContact.id);
}

async function loadDeals(contactId) {
  dealsState = {
    contactId,
    status: "loading",
    deals: [],
    pipelines: [],
    notice: null,
    closed: null,
  };
  paintDeals();
  paintDealForm();

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
  paintTabs();
  paintDeals();
  paintDealForm();
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
  if (!stillShowing(contactId, gen)) return;

  if (!result.ok) {
    dealsState = { ...dealsState, notice: failureText(result, "mover negócios") };
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

/** Close a deal as won or lost. It can be taken back from the list. */
async function closeDeal(dealId, status) {
  const contactId = currentContact?.id;
  const gen = generation;
  const deal = dealsState.deals.find((d) => d.id === dealId);
  if (!contactId || !deal || !["won", "lost"].includes(status)) return;

  for (const control of slot(".crmc-deals")?.querySelectorAll("button, select") ?? []) {
    control.disabled = true;
  }
  const result = await send("setDealStatus", { id: dealId, status });
  if (!stillShowing(contactId, gen)) return;

  if (!result.ok) {
    dealsState = { ...dealsState, notice: failureText(result, "fechar negócios") };
  } else {
    dealsState = {
      ...dealsState,
      notice: null,
      deals: dealsState.deals.filter((d) => d.id !== dealId),
      closed: { id: dealId, title: deal.title, status },
    };
  }
  paintTabs();
  paintDeals();
}

async function reopenDeal() {
  const contactId = currentContact?.id;
  const gen = generation;
  const closed = dealsState.closed;
  if (!contactId || !closed) return;

  for (const control of slot(".crmc-deals")?.querySelectorAll("button, select") ?? []) {
    control.disabled = true;
  }
  const result = await send("setDealStatus", { id: closed.id, status: "open" });
  if (!stillShowing(contactId, gen)) return;

  if (!result.ok) {
    dealsState = { ...dealsState, notice: failureText(result, "reabrir negócios") };
  } else {
    dealsState = {
      ...dealsState,
      notice: null,
      closed: null,
      deals: [result.data, ...dealsState.deals],
    };
  }
  paintTabs();
  paintDeals();
}

/** Pipelines a deal can be opened on: the ones that have a stage. */
function usablePipelines() {
  return dealsState.pipelines.filter((p) => p.stages?.length);
}

function paintDealForm() {
  const el = slot(".crmc-dealform");
  const contact = currentContact;
  if (!el || !contact) return;
  if (dealsState.contactId !== contact.id || dealsState.status !== "ready") {
    el.innerHTML = "";
    return;
  }
  const pipelines = usablePipelines();
  if (!pipelines.length) {
    el.innerHTML = `<p class="crmc-muted">Crie um funil no CRM para abrir negócios por aqui.</p>`;
    return;
  }
  if (!dealFormOpen) {
    el.innerHTML = `<button class="crmc-btn crmc-btn-quiet" data-act="deal-new">+ Novo negócio</button>`;
    return;
  }
  const pipelineChoice =
    pipelines.length > 1
      ? `<label class="crmc-field"><span>Funil</span>
           <select class="crmc-select" name="pipeline">${pipelines
             .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
             .join("")}</select></label>`
      : "";
  el.innerHTML = `
    <form class="crmc-form crmc-card" data-form="deal">
      <p class="crmc-section">Novo negócio</p>
      <label class="crmc-field"><span>Título</span>
        <input class="crmc-input" name="title" maxlength="120" autocomplete="off"
               placeholder="Ex.: Plano anual" /></label>
      <label class="crmc-field"><span>Valor</span>
        <input class="crmc-input" name="value" inputmode="decimal" autocomplete="off"
               placeholder="0,00" /></label>
      ${pipelineChoice}
      <label class="crmc-field"><span>Etapa</span>
        <select class="crmc-select" name="stage">${stageOptions(pipelines[0].stages)}</select></label>
      <p class="crmc-err" hidden></p>
      <div class="crmc-form-actions">
        <button class="crmc-btn" type="submit">Criar negócio</button>
        <button class="crmc-link" type="button" data-act="deal-cancel">Cancelar</button>
      </div>
    </form>`;
  el.querySelector('[name="title"]')?.focus();
}

/** The pipeline changed in the new-deal form: offer that one's stages. */
function syncDealStages(form) {
  const pipeline = usablePipelines().find((p) => p.id === form.elements.pipeline?.value);
  if (pipeline) form.elements.stage.innerHTML = stageOptions(pipeline.stages);
}

async function submitDeal(form) {
  const contactId = currentContact?.id;
  const gen = generation;
  if (!contactId) return;

  const title = form.elements.title.value.trim();
  if (!title) {
    showFormError(form, "Dê um título ao negócio.");
    return;
  }
  const value = parseMoney(form.elements.value.value);
  if (value === null) {
    showFormError(form, "O valor precisa ser um número, como 1.200,00.");
    return;
  }
  const pipelines = usablePipelines();
  const pipelineId = form.elements.pipeline?.value || pipelines[0]?.id;
  const stageId = form.elements.stage.value;

  showFormError(form, "");
  setFormBusy(form, true);
  const result = await send("createDeal", { contactId, title, value, pipelineId, stageId });
  if (!stillShowing(contactId, gen)) return;

  if (!result.ok) {
    setFormBusy(form, false);
    showFormError(form, failureText(result, "criar negócios"));
    return;
  }
  dealFormOpen = false;
  dealsState = { ...dealsState, notice: null, deals: [result.data, ...dealsState.deals] };
  paintTabs();
  paintDeals();
  paintDealForm();
}

// ---- Notes --------------------------------------------------

function paintNotes() {
  const el = slot(".crmc-notes");
  const contact = currentContact;
  if (!el || !contact) return;
  if (notesState.contactId !== contact.id || notesState.status === "loading") {
    el.innerHTML = `<p class="crmc-muted">Carregando…</p>`;
    return;
  }
  if (notesState.status !== "ready") {
    el.innerHTML = `<p class="crmc-muted">${escapeHtml(notesState.notice)}</p>`;
    return;
  }
  el.innerHTML = notesState.notes.length
    ? notesState.notes
        .map((note) => {
          const meta = [note.author?.name, formatWhen(note.created_at)].filter(Boolean).join(" · ");
          return `
            <div class="crmc-note">
              <p class="crmc-note-text">${escapeHtml(note.text)}</p>
              ${meta ? `<p class="crmc-note-meta">${escapeHtml(meta)}</p>` : ""}
            </div>`;
        })
        .join("")
    : `<p class="crmc-muted">Nenhuma anotação ainda. As anotações ficam só para a equipe.</p>`;
}

async function loadNotes(contactId) {
  const gen = generation;
  notesState = { contactId, status: "loading", notes: [], notice: null };
  paintNotes();

  const result = await send("notes", { contactId });
  if (!stillShowing(contactId, gen)) return;

  notesState = result.ok
    ? { contactId, status: "ready", notes: Array.isArray(result.data) ? result.data : [], notice: null }
    : { contactId, status: "error", notes: [], notice: failureText(result, "ver anotações") };
  paintNotes();
}

async function submitNote(form) {
  const contactId = currentContact?.id;
  const gen = generation;
  const text = form.elements.text.value.trim();
  if (!contactId || !text) return;

  showFormError(form, "");
  setFormBusy(form, true);
  const result = await send("addNote", { contactId, text });
  if (!stillShowing(contactId, gen)) return;
  setFormBusy(form, false);

  if (!result.ok) {
    showFormError(form, failureText(result, "escrever anotações"));
    return;
  }
  form.elements.text.value = "";
  if (notesState.contactId === contactId && notesState.status === "ready") {
    notesState = { ...notesState, notes: [result.data, ...notesState.notes] };
    paintNotes();
  } else {
    void loadNotes(contactId);
  }
}

// ---- The contact's own data ----------------------------------

function renderContactInfo(contact) {
  const rows = [
    contact.company ? `<p class="crmc-row"><span>Empresa</span>${escapeHtml(contact.company)}</p>` : "",
    contact.email ? `<p class="crmc-row"><span>E-mail</span>${escapeHtml(contact.email)}</p>` : "",
    contact.potential != null
      ? `<p class="crmc-row"><span>Potencial</span>${escapeHtml(contact.potential)}/100</p>`
      : "",
  ].join("");
  const tags = (contact.tags || [])
    .map((t) => `<span class="crmc-tag">${escapeHtml(t.name)}</span>`)
    .join("");
  return `
    ${rows || tags ? "" : `<p class="crmc-muted">Sem empresa, e-mail ou etiquetas no cadastro.</p>`}
    ${rows}
    ${tags ? `<div class="crmc-tags">${tags}</div>` : ""}
    <button class="crmc-btn crmc-btn-quiet" data-act="edit">Editar contato</button>`;
}

function renderContactForm(contact) {
  return `
    <form class="crmc-form" data-form="contact" novalidate>
      <label class="crmc-field"><span>Nome</span>
        <input class="crmc-input" name="name" maxlength="120" autocomplete="off"
               value="${escapeHtml(contact.name || "")}" /></label>
      <label class="crmc-field"><span>E-mail</span>
        <input class="crmc-input" name="email" type="email" maxlength="200" autocomplete="off"
               value="${escapeHtml(contact.email || "")}" /></label>
      <label class="crmc-field"><span>Empresa</span>
        <input class="crmc-input" name="company" maxlength="120" autocomplete="off"
               value="${escapeHtml(contact.company || "")}" /></label>
      <div class="crmc-field"><span>Etiquetas</span>
        <div class="crmc-tagedit"></div>
        <div class="crmc-tagadd">
          <input class="crmc-input crmc-taginput" list="crmc-taglist" maxlength="40"
                 autocomplete="off" placeholder="Adicionar etiqueta" aria-label="Adicionar etiqueta" />
          <button class="crmc-btn crmc-btn-small crmc-btn-quiet" type="button" data-act="tag-add">Adicionar</button>
        </div>
        <datalist id="crmc-taglist"></datalist>
      </div>
      <p class="crmc-err" hidden></p>
      <div class="crmc-form-actions">
        <button class="crmc-btn" type="submit">Salvar</button>
        <button class="crmc-link" type="button" data-act="edit-cancel">Cancelar</button>
      </div>
    </form>`;
}

function startEditingContact() {
  if (!currentContact) return;
  editingContact = true;
  editTags = (currentContact.tags || []).map((t) => t.name);
  paintPane();
}

function paintTagEdit() {
  const el = slot(".crmc-tagedit");
  if (!el) return;
  el.innerHTML = editTags.length
    ? editTags
        .map(
          (name) => `
            <span class="crmc-tag crmc-tag-edit">${escapeHtml(name)}
              <button class="crmc-tag-x" type="button" data-act="tag-remove"
                      data-name="${escapeHtml(name)}"
                      aria-label="Tirar a etiqueta ${escapeHtml(name)}">×</button></span>`,
        )
        .join("")
    : `<span class="crmc-muted">Sem etiquetas.</span>`;
}

function paintTagChoices() {
  const list = slot("#crmc-taglist");
  if (!list || tagsCache.baseUrl !== currentBaseUrl) return;
  list.innerHTML = (tagsCache.names || [])
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join("");
}

/** The CRM's tags, to suggest while typing. Asked once per CRM. */
async function loadTags() {
  const baseUrl = currentBaseUrl;
  if (tagsCache.baseUrl === baseUrl && tagsCache.names) {
    paintTagChoices();
    return;
  }
  const result = await send("tags");
  // Without the list the field still works: a typed name is created.
  if (!result.ok || currentBaseUrl !== baseUrl) return;
  tagsCache = {
    baseUrl,
    names: (Array.isArray(result.data) ? result.data : []).map((t) => t.name).filter(Boolean),
  };
  paintTagChoices();
}

function addTagFromInput() {
  const input = slot(".crmc-taginput");
  if (!input) return;
  editTags = addTagName(editTags, input.value);
  input.value = "";
  paintTagEdit();
  input.focus();
}

function removeEditTag(name) {
  editTags = editTags.filter((existing) => existing !== name);
  paintTagEdit();
}

async function submitContact(form) {
  const contact = currentContact;
  const gen = generation;
  if (!contact) return;
  if (!form.checkValidity()) {
    showFormError(form, "Esse e-mail não parece válido.");
    return;
  }

  // A tag typed but not yet added is still meant to be saved.
  const pending = form.querySelector(".crmc-taginput")?.value;
  const tags = addTagName(editTags, pending);
  const name = form.elements.name.value.trim();
  const fields = {
    // The CRM requires a name; an emptied field leaves the one it has.
    ...(name ? { name } : {}),
    email: form.elements.email.value.trim() || null,
    company: form.elements.company.value.trim() || null,
    tags,
  };

  showFormError(form, "");
  setFormBusy(form, true);
  const result = await send("update", { id: contact.id, fields });
  if (!stillShowing(contact.id, gen)) return;

  if (!result.ok) {
    setFormBusy(form, false);
    showFormError(form, failureText(result, "editar contatos"));
    return;
  }
  currentContact = result.data;
  editingContact = false;
  // A tag created just now belongs in the suggestions from here on.
  if (tagsCache.names) {
    tagsCache = {
      ...tagsCache,
      names: tags.reduce((names, tag) => addTagName(names, tag), tagsCache.names),
    };
  }
  paintWho();
  paintPane();
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

// ------------------------------------------------------------
// Tasks, and where the conversation stands in the CRM
//
// A task is a to-do about a contact, for a person: "ligar na quinta".
// The record has a tab with the contact's tasks; the footer has the
// person's own open tasks across contacts, with a count of the ones
// late or for today — the reminder, for as long as WhatsApp Web is
// open. (The CRM's bell gets one too, from the server.)
// ------------------------------------------------------------

/** Why a part of the panel has nothing to show, in the operator's terms. */
function accessNotice(result, what, migration) {
  if (result.error === "unauthorized" && result.status === 403) {
    return `Sua chave ainda não tem acesso a ${what}. O CRM precisa da atualização ${migration}; depois dela, não é preciso gerar outra chave.`;
  }
  return failureText(result, `ver ${what}`);
}

function renderTaskRow(task, { withContact }) {
  const id = escapeHtml(task.id);
  const due = describeDue(task.due_at);
  const phone = chatPhone(task.contact?.phone);
  const mine = myTasks.tasks.some((t) => t.id === task.id);
  const about = withContact
    ? `${escapeHtml(task.contact?.name || task.contact?.phone || "Sem contato")}${
        phone
          ? ` · <button class="crmc-link" data-act="board-chat" data-phone="${phone}"
                       title="Abre a conversa deste contato. O WhatsApp Web recarrega.">Abrir conversa</button>`
          : ""
      }`
    : !mine && task.assigned_to?.name
      ? `Para ${escapeHtml(task.assigned_to.name)}`
      : "";
  // "Adicionar à agenda" (Fase 9): Google's own "new event" page,
  // filled in — the person saves it in their calendar.
  const who = task.contact ?? (currentContact?.id === task.contact_id ? currentContact : null);
  const contactId = task.contact?.id ?? task.contact_id;
  const calendar = task.due_at
    ? googleCalendarUrl({
        title: task.title,
        start: task.due_at,
        details: taskEventDetails({
          name: who?.name,
          phone: who?.phone,
          url: contactId ? contactUrl(contactId) : null,
        }),
      })
    : null;
  return `
    <div class="crmc-task" data-tone="${due?.tone ?? "none"}">
      <button class="crmc-check" data-act="task-done" data-id="${id}"
              aria-label="Concluir: ${escapeHtml(task.title)}"></button>
      <div class="crmc-task-main">
        <p class="crmc-task-title">${escapeHtml(task.title)}</p>
        ${due ? `<p class="crmc-task-when">${escapeHtml(due.label)}${
          calendar
            ? ` · <a class="crmc-link" target="_blank" rel="noopener noreferrer"
                     href="${escapeHtml(calendar)}">Adicionar à agenda</a>`
            : ""
        }</p>` : ""}
        ${about ? `<p class="crmc-task-who">${about}</p>` : ""}
      </div>
    </div>`;
}

/**
 * Under a list of tasks: the one just ticked, or what went wrong. With
 * `contactId`, only a task of that contact — a task ticked in "Minhas
 * tarefas" has no business under another contact's list.
 */
function renderUndone(contactId) {
  if (lastTaskError) return `<p class="crmc-err">${escapeHtml(lastTaskError)}</p>`;
  if (contactId && lastDoneTask?.contact_id !== contactId) return "";
  return lastDoneTask
    ? `<p class="crmc-muted crmc-undo">“${escapeHtml(lastDoneTask.title)}” concluída.
         <button class="crmc-link" data-act="task-undo">Desfazer</button></p>`
    : "";
}

// ---- The contact's tasks (a tab of the record) ---------------

function contactTaskCount() {
  const contact = currentContact;
  if (!contact) return 0;
  if (tasksState.contactId === contact.id && tasksState.status === "ready") {
    return tasksState.tasks.length;
  }
  // Until the tab is opened, what is known is this person's own tasks.
  return myTasks.tasks.filter((t) => t.contact_id === contact.id).length;
}

function paintTasks() {
  const el = slot(".crmc-tasks");
  const contact = currentContact;
  if (!el || !contact) return;
  if (tasksState.contactId !== contact.id || tasksState.status === "loading") {
    el.innerHTML = `<p class="crmc-muted">Carregando…</p>`;
    return;
  }
  if (tasksState.status !== "ready") {
    el.innerHTML = `<p class="crmc-muted">${escapeHtml(tasksState.notice)}</p>`;
    return;
  }
  el.innerHTML =
    (tasksState.tasks.length
      ? tasksState.tasks.map((task) => renderTaskRow(task, { withContact: false })).join("")
      : `<p class="crmc-muted">Nenhuma tarefa em aberto para este contato.</p>`) +
    renderUndone(contact.id);
}

async function loadTasks(contactId) {
  const gen = generation;
  tasksState = { contactId, status: "loading", tasks: [], notice: null };
  paintTasks();

  const result = await send("tasks", { contactId });
  if (!stillShowing(contactId, gen)) return;

  tasksState = result.ok
    ? { contactId, status: "ready", tasks: Array.isArray(result.data) ? result.data : [], notice: null }
    : { contactId, status: "error", tasks: [], notice: accessNotice(result, "tarefas", "060") };
  paintTabs();
  paintTasks();
}

async function submitTask(form) {
  const contactId = currentContact?.id;
  const gen = generation;
  const title = form.elements.title.value.trim();
  if (!contactId || !title) return;
  const dueAt = localInputToIso(form.elements.due.value);

  showFormError(form, "");
  setFormBusy(form, true);
  const result = await send("addTask", { contactId, title, dueAt });
  if (!stillShowing(contactId, gen)) return;
  setFormBusy(form, false);

  if (!result.ok) {
    showFormError(form, accessNotice(result, "tarefas", "060"));
    return;
  }
  form.reset();
  lastDoneTask = null;
  lastTaskError = null;
  void loadTasks(contactId);
  void loadMyTasks();
}

/**
 * Done — or, with `done` false, open again. Works from the record's
 * tab and from "Minhas tarefas" alike: both lists are reloaded, since
 * a task shown in one is usually in the other too.
 */
async function setTaskDone(task, done) {
  if (!task) return;
  const result = await send("setTaskDone", { id: task.id, done });
  if (!result.ok) {
    lastTaskError = failureText(result, "concluir tarefas");
    paintTasks();
    paintMyTasks();
    return;
  }
  lastTaskError = null;
  lastDoneTask = done ? task : null;
  if (currentContact && tasksState.contactId === currentContact.id) {
    void loadTasks(currentContact.id);
  }
  void loadMyTasks();
}

function findTask(taskId) {
  return (
    tasksState.tasks.find((t) => t.id === taskId) || myTasks.tasks.find((t) => t.id === taskId)
  );
}

// ---- The person's own tasks (footer count and sheet) ---------

function paintTaskBadge() {
  const badge = ensurePanel().querySelector(".crmc-badge");
  if (!badge) return;
  const due = myTasks.status === "ready" ? countDueNow(myTasks.tasks) : 0;
  badge.textContent = due ? String(due) : "";
  badge.hidden = !due;
  badge.parentElement?.setAttribute(
    "title",
    due ? `${due} ${due === 1 ? "tarefa atrasada ou para hoje" : "tarefas atrasadas ou para hoje"}` : "Minhas tarefas",
  );
}

function paintMyTasks() {
  const el = sheet()?.querySelector(".crmc-mytasks");
  if (!el || sheetKind !== "tasks") return;
  if (myTasks.baseUrl !== currentBaseUrl || myTasks.status === "loading" || myTasks.status === "idle") {
    el.innerHTML = `<p class="crmc-muted">Carregando…</p>`;
    return;
  }
  if (myTasks.status !== "ready") {
    el.innerHTML = `<p class="crmc-muted">${escapeHtml(myTasks.notice)}</p>`;
    return;
  }
  el.innerHTML =
    (myTasks.tasks.length
      ? myTasks.tasks.map((task) => renderTaskRow(task, { withContact: true })).join("")
      : `<p class="crmc-muted">Nenhuma tarefa em aberto. Crie uma na aba Tarefas de um contato.</p>`) +
    renderUndone();
}

async function loadMyTasks() {
  const baseUrl = currentBaseUrl;
  if (!baseUrl) return;
  const known = myTasks.baseUrl === baseUrl && myTasks.status === "ready";
  if (!known) myTasks = { baseUrl, status: "loading", tasks: [], notice: null, at: Date.now() };
  else myTasks = { ...myTasks, at: Date.now() };

  const result = await send("myTasks");
  if (currentBaseUrl !== baseUrl) return;
  if (result.ok) {
    myTasks = {
      baseUrl,
      status: "ready",
      tasks: Array.isArray(result.data) ? result.data : [],
      notice: null,
      at: Date.now(),
    };
  } else if (!known) {
    myTasks = {
      baseUrl,
      status: "error",
      tasks: [],
      notice: accessNotice(result, "tarefas", "060"),
      at: Date.now(),
    };
  }
  paintTaskBadge();
  paintMyTasks();
  paintTabs();
}

/** Every few minutes, so a task that came due shows up in the count. */
function refreshMyTasksIfStale() {
  if (!currentBaseUrl || !ensurePanel().classList.contains("crmc-connected")) return;
  if (Date.now() - myTasks.at > MY_TASKS_EVERY_MS) void loadMyTasks();
  else paintTaskBadge(); // the clock alone can make a task late
}

function setMyTasksOpen(open) {
  if (open) setRepliesOpen(false);
  sheetKind = open ? "tasks" : sheetKind === "tasks" ? null : sheetKind;
  ensurePanel().classList.toggle("crmc-sheet-open", sheetKind !== null);
  if (!open) return;

  lastDoneTask = null;
  sheet().innerHTML = `
    <div class="crmc-sheet-head">
      <p class="crmc-name">Minhas tarefas</p>
      <button class="crmc-link" data-act="mytasks-close">Fechar</button>
    </div>
    <div class="crmc-mytasks"></div>`;
  paintMyTasks();
  void loadMyTasks();
}

// ---- The conversation in the CRM -----------------------------

function paintConversation(error) {
  const el = slot(".crmc-conv");
  const contact = currentContact;
  if (!el || !contact) return;
  const conv = convState.contactId === contact.id ? convState.data : null;
  if (!conv) {
    el.innerHTML = "";
    return;
  }

  let text = "";
  let canTake = false;
  if (conv.waiting_since) {
    const since = formatWhen(conv.waiting_since);
    text = conv.assigned_to_me
      ? `Esta conversa espera por você${since ? ` ${since}` : ""}.`
      : `O cliente espera um atendente${since ? ` ${since}` : ""}.`;
    canTake = !conv.assigned_to_me;
  } else if (conv.ai === "answering") {
    text = "A IA está respondendo esta conversa.";
    canTake = true;
  } else if (conv.assigned_to_me) {
    text =
      conv.ai === "paused"
        ? "Você assumiu esta conversa. A IA está pausada aqui."
        : "Esta conversa está com você no CRM.";
  } else if (conv.assigned_to) {
    text = `Esta conversa está com ${conv.assigned_to.name || "outra pessoa"} no CRM.`;
  } else if (conv.ai === "paused") {
    text = "A IA está pausada nesta conversa e ninguém assumiu.";
    canTake = true;
  }
  // A chatbot flow conducting the chat (Fase 7), and the way back to the
  // AI once it was paused — the inbox's "Retomar IA".
  const flowName = conv.flow ? conv.flow.name || "sem nome" : null;
  const canHandBack = conv.ai === "paused";
  // While a flow conducts the chat, the AI stays out of it (the webhook
  // skips the auto-reply for a reply the flow consumed): saying "the AI
  // is answering" too would be wrong.
  if (flowName && conv.ai === "answering" && !conv.waiting_since) text = "";
  if (!text && !flowName) {
    el.innerHTML = "";
    return;
  }

  // What the bot wrote when it passed the conversation on — only while
  // somebody still has to act on it.
  const summary =
    conv.handoff_summary && (conv.waiting_since || canTake)
      ? `<p class="crmc-conv-summary">${escapeHtml(String(conv.handoff_summary).slice(0, 400))}</p>`
      : "";
  const actions = [
    canTake ? `<button class="crmc-btn crmc-btn-small" data-act="conv-take">Assumir</button>` : "",
    canHandBack
      ? `<button class="crmc-btn crmc-btn-small crmc-btn-quiet" data-act="conv-handback">Devolver para a IA</button>`
      : "",
    flowName
      ? `<button class="crmc-btn crmc-btn-small crmc-btn-quiet" data-act="conv-flow-pause">Pausar fluxo</button>`
      : "",
  ].join("");
  el.innerHTML = `
    <div class="crmc-conv-box" data-tone="${conv.waiting_since ? "waiting" : "info"}">
      ${text ? `<p class="crmc-conv-text">${escapeHtml(text)}</p>` : ""}
      ${flowName ? `<p class="crmc-conv-text">O fluxo “${escapeHtml(flowName)}” está conduzindo esta conversa.</p>` : ""}
      ${summary}
      ${error ? `<p class="crmc-err">${escapeHtml(error)}</p>` : ""}
      ${actions ? `<div class="crmc-conv-actions">${actions}</div>` : ""}
    </div>`;
}

async function loadConversation(contactId) {
  const gen = generation;
  convState = { contactId, data: null };
  paintConversation();
  const result = await send("conversation", { contactId });
  if (!stillShowing(contactId, gen)) return;
  // A key or a CRM without this yet: the record simply has no banner.
  convState = { contactId, data: result.ok ? result.data : null };
  paintConversation();
  paintFlows();
}

/** One of the banner's actions on the CRM conversation, then repaint. */
async function conversationAction(type, what) {
  const contactId = currentContact?.id;
  const gen = generation;
  const conv = convState.contactId === contactId ? convState.data : null;
  if (!contactId || !conv) return;
  for (const button of slot(".crmc-conv")?.querySelectorAll("button") ?? []) button.disabled = true;
  const result = await send(type, { id: conv.id });
  if (!stillShowing(contactId, gen)) return;
  if (!result.ok) {
    paintConversation(failureText(result, what));
    return;
  }
  convState = { contactId, data: result.data };
  paintConversation();
  paintFlows();
}

async function takeOverConversation() {
  const contactId = currentContact?.id;
  const gen = generation;
  const conv = convState.contactId === contactId ? convState.data : null;
  if (!contactId || !conv) return;

  for (const button of slot(".crmc-conv")?.querySelectorAll("button") ?? []) button.disabled = true;
  const result = await send("takeOver", { id: conv.id });
  if (!stillShowing(contactId, gen)) return;

  if (!result.ok) {
    paintConversation(failureText(result, "assumir conversas"));
    return;
  }
  convState = { contactId, data: result.data };
  paintConversation();
}

// ------------------------------------------------------------
// Quick replies
//
// The CRM's text snippets, one click from WhatsApp's message box. A
// click PUTS the text in the box: the person reads it — with the
// contact's name already filled in — and presses Enter themselves.
//
// "Enviar" sends it through the CRM instead (Fase 4B), and only shows
// when the CRM would send from the number logged in here, to the
// contact on the panel (send-check.js). It takes two clicks: "Enviar",
// then "Confirmar". Nothing leaves without a human asking twice.
//
// The list opens as a sheet over the record rather than replacing it,
// so a half-written note is still there when the sheet closes.
// ------------------------------------------------------------

function sheet() {
  return ensurePanel().querySelector(".crmc-sheet");
}

/** Whose data fills the variables: the CRM's, else WhatsApp's name. */
function replyContact() {
  if (currentContact) return { name: currentContact.name, company: currentContact.company };
  // A group's title is not a person's name.
  return { name: currentChat ? readOpenChatName() : null, company: null };
}

function setRepliesOpen(open) {
  repliesOpen = open;
  if (open) sheetKind = "replies";
  else if (sheetKind === "replies") sheetKind = null;
  ensurePanel().classList.toggle("crmc-sheet-open", sheetKind !== null);
  if (!open) return;

  repliesQuery = "";
  // Opens on "Enviar agora"; the Agendar shortcut switches it after.
  sendMode = "now";
  sheet().innerHTML = `
    <div class="crmc-sheet-head">
      <p class="crmc-name">Respostas rápidas</p>
      <button class="crmc-link" data-act="replies-close">Fechar</button>
    </div>
    <input class="crmc-input crmc-replies-search" type="search" autocomplete="off"
           placeholder="Buscar pelo título ou pelo texto" aria-label="Buscar resposta rápida" />
    <div class="crmc-sign"></div>
    <div class="crmc-mode" role="group" aria-label="Quando enviar" hidden>
      <button class="crmc-mode-btn" data-act="mode-now">Enviar agora</button>
      <button class="crmc-mode-btn" data-act="mode-later">Agendar</button>
    </div>
    <div class="crmc-when" hidden>
      <label class="crmc-when-row">
        <span>Quando</span>
        <input class="crmc-input crmc-when-at" type="datetime-local" aria-label="Dia e hora do envio" />
      </label>
      <label class="crmc-sign-row">
        <input type="checkbox" class="crmc-when-noreply" />
        <span>Só se o cliente não responder até lá</span>
      </label>
      <textarea class="crmc-input crmc-when-text" rows="2" maxlength="4096"
                placeholder="Escreva uma mensagem, ou escolha uma resposta abaixo"
                aria-label="Mensagem para agendar"></textarea>
      <button class="crmc-btn crmc-btn-quiet crmc-when-send" data-act="schedule-text">
        Agendar esta mensagem
      </button>
    </div>
    <p class="crmc-replies-status" role="status" aria-live="polite"></p>
    <div class="crmc-replies"></div>
    <div class="crmc-sched"></div>
    <div class="crmc-seqs"></div>
    <div class="crmc-flows"></div>`;
  const at = sheet().querySelector(".crmc-when-at");
  if (at) at.value = defaultScheduleValue();
  paintSignature();
  paintReplies();
  sheet().querySelector(".crmc-replies-search")?.focus();
  void loadReplies();
  void loadSequences(true);
  void loadScheduled(true);
  void loadFlows();
  void loadSender();
}

function setRepliesStatus(message, tone) {
  const line = sheet()?.querySelector(".crmc-replies-status");
  if (!line) return;
  line.textContent = message || "";
  line.classList.toggle("crmc-err", tone === "error");
}

function paintReplies() {
  const el = sheet()?.querySelector(".crmc-replies");
  if (!el || !repliesOpen) return;
  // The parts around the list don't wait for it.
  syncSendMode(currentSendCheck());
  paintScheduled();
  paintSequences();
  paintFlows();
  const mine = repliesState.baseUrl === currentBaseUrl;
  if (!mine || repliesState.status === "loading") {
    el.innerHTML = `<p class="crmc-muted">Carregando…</p>`;
    return;
  }
  if (repliesState.status !== "ready") {
    el.innerHTML = `<p class="crmc-muted">${escapeHtml(repliesState.notice)}</p>`;
    return;
  }
  const manage = `<a class="crmc-link crmc-link-block" target="_blank" rel="noreferrer noopener"
       href="${escapeHtml(currentBaseUrl)}/settings?tab=quick-replies">Criar e editar no CRM</a>`;
  if (!repliesState.items.length) {
    el.innerHTML = `
      <p class="crmc-muted">Nenhuma resposta rápida ainda. Elas são criadas no CRM, em
        Configurações › Respostas rápidas, e valem para a equipe toda.</p>${manage}`;
    return;
  }
  const shown = filterReplies(repliesState.items, repliesQuery);
  if (!shown.length) {
    el.innerHTML = `<p class="crmc-muted">Nenhuma resposta com esse texto.</p>`;
    return;
  }
  const contact = replyContact();
  const check = currentSendCheck();
  // A confirmation waiting for another chat is not this chat's.
  if (pendingSend && (!check.ok || pendingSend.chatKey !== currentChat?.key)) clearPendingSend();
  const note = check.ok
    ? sendMode === "later"
      ? `<p class="crmc-muted crmc-replies-note">Escolha quando e clique em Agendar numa resposta,
           ou escreva a mensagem acima.</p>`
      : `<p class="crmc-muted crmc-replies-note">Clique numa resposta para colocá-la no campo de
           mensagem, ou em Enviar para mandar direto pelo CRM.</p>`
    : check.why
      ? `<p class="crmc-muted crmc-replies-note">${escapeHtml(check.why)}</p>`
      : "";
  el.innerHTML =
    note +
    shown
      .map((reply) => {
        // The preview is the text as it will go, name and all.
        const preview = fillTemplate(reply.text, contact).text;
        const id = escapeHtml(reply.id);
        const media = reply.media && MEDIA_LABELS[reply.media.kind] ? reply.media : null;
        const fileLine = media
          ? `<span class="crmc-reply-file">${escapeHtml(
              [MEDIA_LABELS[media.kind], media.filename].filter(Boolean).join(" · "),
            )}</span>`
          : "";
        const confirming = pendingSend?.id === reply.id;
        const sendButton = check.ok && sendMode === "later"
          ? `<button class="crmc-reply-send" data-act="reply-schedule" data-id="${id}"
                     ${scheduling ? "disabled" : ""}
                     aria-label="Agendar ${escapeHtml(reply.title)}">Agendar</button>`
          : check.ok
          ? `<button class="crmc-reply-send${confirming ? " crmc-reply-confirm" : ""}"
                     data-act="reply-send" data-id="${id}"
                     ${sendingReply ? "disabled" : ""}
                     aria-label="${confirming ? "Confirmar envio de" : "Enviar"} ${escapeHtml(reply.title)} pelo CRM">
               ${confirming ? "Confirmar" : "Enviar"}
             </button>`
          : "";
        return `
          <div class="crmc-reply-row">
            <button class="crmc-result crmc-reply" data-act="reply-use" data-id="${id}">
              <span class="crmc-result-name">${escapeHtml(reply.title)}</span>${fileLine}
              ${preview ? `<span class="crmc-reply-text">${escapeHtml(preview)}</span>` : ""}
            </button>${sendButton}
          </div>`;
      })
      .join("") + manage;
}

// ------------------------------------------------------------
// Scheduling (Fase 5)
//
// "Agendar" turns the replies into things to send later, from the
// CRM's number, at a chosen time; "Só se o cliente não responder até
// lá" makes it a follow-up. What is scheduled for the contact is
// listed under the replies, with Cancelar. A schedule can be undone,
// so it takes one click, not two.
// ------------------------------------------------------------

/** Show the now/later switch and the time fields when sending is on. */
function syncSendMode(check) {
  const root = sheet();
  if (!root) return;
  const mode = root.querySelector(".crmc-mode");
  const when = root.querySelector(".crmc-when");
  if (!check.ok && sendMode === "later") sendMode = "now";
  if (mode) mode.hidden = !check.ok;
  if (when) when.hidden = !check.ok || sendMode !== "later";
  for (const button of root.querySelectorAll(".crmc-mode-btn")) {
    const on = button.getAttribute("data-act") === (sendMode === "later" ? "mode-later" : "mode-now");
    button.classList.toggle("crmc-mode-on", on);
    button.setAttribute("aria-pressed", String(on));
  }
}

function setSendMode(mode) {
  sendMode = mode === "later" ? "later" : "now";
  clearPendingSend();
  clearPendingSeq();
  setRepliesStatus("");
  paintReplies();
}

/** The time and follow-up choice in the fields, or an error to say. */
function readScheduleFields() {
  const root = sheet();
  const iso = localInputToIso(root?.querySelector(".crmc-when-at")?.value);
  if (!iso) return { error: "Escolha o dia e a hora do envio." };
  if (Date.parse(iso) < Date.now() + 60_000) {
    return { error: "Escolha um horário daqui a pelo menos 1 minuto." };
  }
  return { sendAt: iso, onlyIfNoReply: Boolean(root?.querySelector(".crmc-when-noreply")?.checked) };
}

async function submitSchedule({ title, text, quickReplyId }) {
  const contactId = currentContact?.id;
  if (scheduling || !contactId || !currentSendCheck().ok) return false;
  const fields = readScheduleFields();
  if (fields.error) {
    setRepliesStatus(fields.error, "error");
    return false;
  }
  scheduling = true;
  paintReplies();
  const result = await send("schedule", {
    contactId,
    text,
    quickReplyId,
    sendAt: fields.sendAt,
    onlyIfNoReply: fields.onlyIfNoReply,
  });
  scheduling = false;
  paintReplies();
  if (result.ok) {
    const when = describeScheduled(result.data);
    setRepliesStatus(`${title} agendada: ${when}.`);
  } else {
    setRepliesStatus(`Não agendei: ${failureText(result, "agendar mensagens")}`, "error");
  }
  await loadScheduled(true);
  return result.ok;
}

/** Schedule a quick reply: its text, or its file with the caption. */
async function scheduleReply(replyId) {
  const reply = repliesState.items.find((r) => r.id === replyId);
  if (!reply) return;
  const { text, missing } = fillTemplate(reply.text, replyContact());
  if (missing.length) {
    setRepliesStatus(
      "Faltou preencher " +
        missing.map((v) => `{{${v}}}`).join(", ") +
        ". Escreva a mensagem no campo acima para agendar.",
      "error",
    );
    return;
  }
  // An empty caption stays empty: a signature alone is not a message.
  const signed = signText(text, signatureName());
  await submitSchedule({
    title: `“${reply.title}”`,
    text: signed,
    quickReplyId: reply.media ? reply.id : null,
  });
}

/** Schedule what was typed in the field. */
async function scheduleTyped() {
  const field = sheet()?.querySelector(".crmc-when-text");
  const typed = field?.value?.trim() ?? "";
  if (!typed) {
    setRepliesStatus("Escreva a mensagem, ou clique em Agendar numa resposta.", "error");
    return;
  }
  const ok = await submitSchedule({
    title: "Mensagem",
    text: signText(typed, signatureName()),
    quickReplyId: null,
  });
  if (ok && field) field.value = "";
}

/** Ask the CRM what is scheduled for the contact on the panel. */
async function loadScheduled(force = false) {
  const contactId = currentContact?.id ?? null;
  if (!repliesOpen) return;
  if (!force && schedState.contactId === contactId && schedState.status !== "idle") return;
  if (!contactId) {
    schedState = { contactId: null, status: "idle", items: [] };
    paintScheduled();
    return;
  }
  if (schedState.contactId !== contactId) {
    schedState = { contactId, status: "loading", items: [] };
    paintScheduled();
  }
  const result = await send("scheduled", { contactId });
  if (currentContact?.id !== contactId) return;
  schedState = result.ok
    ? { contactId, status: "ready", items: Array.isArray(result.data) ? result.data : [] }
    : // 503 before migration 064, 403 before 062: nothing to show.
      { contactId, status: "error", items: [] };
  paintScheduled();
}

function paintScheduled() {
  const el = sheet()?.querySelector(".crmc-sched");
  if (!el || !repliesOpen) return;
  if ((currentContact?.id ?? null) !== schedState.contactId) {
    el.innerHTML = "";
    void loadScheduled();
    return;
  }
  if (schedState.status !== "ready" || !schedState.items.length) {
    el.innerHTML = "";
    return;
  }
  const waiting = schedState.items.filter((m) => m.status === "scheduled" || m.status === "sending");
  const done = schedState.items.filter((m) => m.status !== "scheduled" && m.status !== "sending").slice(0, 3);
  el.innerHTML = `
    <p class="crmc-name crmc-seqs-title">Agendadas</p>
    ${[...waiting, ...done]
      .map((m) => {
        const label = m.media && MEDIA_LABELS[m.media.kind] ? MEDIA_LABELS[m.media.kind] : "";
        const preview = [label, m.text].filter(Boolean).join(" · ") || "Mensagem";
        const cancel =
          m.status === "scheduled"
            ? `<button class="crmc-reply-send" data-act="sched-cancel" data-id="${escapeHtml(m.id)}"
                       aria-label="Cancelar mensagem agendada">Cancelar</button>`
            : "";
        const quiet = m.status === "scheduled" || m.status === "sending" ? "" : " crmc-sched-done";
        return `
          <div class="crmc-reply-row crmc-seq${quiet}">
            <div class="crmc-result crmc-seq-main">
              <span class="crmc-reply-file">${escapeHtml(describeScheduled(m))}</span>
              <span class="crmc-reply-text">${escapeHtml(preview)}</span>
            </div>${cancel}
          </div>`;
      })
      .join("")}`;
}

async function cancelScheduled(id) {
  const result = await send("cancelScheduled", { id });
  setRepliesStatus(
    result.ok ? "Mensagem agendada cancelada." : `Não cancelei: ${failureText(result, "cancelar")}`,
    result.ok ? undefined : "error",
  );
  await loadScheduled(true);
}

// ------------------------------------------------------------
// Chatbot flows started by hand (Fase 7)
//
// The CRM's flows with the "manual" trigger: Iniciar → Confirmar runs
// one with the contact on the panel, from the CRM's number. While it
// runs, the banner on top says so and offers "Pausar fluxo".
// ------------------------------------------------------------

async function loadFlows() {
  const baseUrl = currentBaseUrl;
  if (!repliesOpen || !baseUrl) return;
  const result = await send("flows");
  if (currentBaseUrl !== baseUrl) return;
  flowsState = result.ok
    ? { baseUrl, status: "ready", items: Array.isArray(result.data) ? result.data : [] }
    : { baseUrl, status: "error", items: [] };
  paintFlows();
}

function clearPendingFlow() {
  if (pendingFlow?.timer) clearTimeout(pendingFlow.timer);
  pendingFlow = null;
}

function paintFlows() {
  const el = sheet()?.querySelector(".crmc-flows");
  if (!el || !repliesOpen) return;
  const contact = currentContact;
  if (flowsState.baseUrl !== currentBaseUrl || flowsState.status !== "ready" || !flowsState.items.length || !contact) {
    el.innerHTML = "";
    return;
  }
  const check = currentSendCheck();
  if (pendingFlow && (!check.ok || pendingFlow.contactId !== contact.id)) clearPendingFlow();
  const conv = convState.contactId === contact.id ? convState.data : null;
  const running = conv?.flow?.flow_id ?? null;
  el.innerHTML = `
    <p class="crmc-name crmc-seqs-title">Fluxos</p>
    ${check.ok ? "" : `<p class="crmc-muted crmc-replies-note">Para iniciar um fluxo, o envio direto precisa estar ligado.</p>`}
    ${flowsState.items
      .map((flow) => {
        const id = escapeHtml(flow.id);
        const confirming = pendingFlow?.id === flow.id;
        const action =
          running === flow.id
            ? ""
            : check.ok
              ? `<button class="crmc-reply-send${confirming ? " crmc-reply-confirm" : ""}" data-act="flow-start"
                         data-id="${id}" ${flowBusy || running ? "disabled" : ""}
                         aria-label="${confirming ? "Confirmar início de" : "Iniciar"} ${escapeHtml(flow.name)}">
                   ${confirming ? "Confirmar" : "Iniciar"}
                 </button>`
              : "";
        return `
          <div class="crmc-reply-row crmc-seq">
            <div class="crmc-result crmc-seq-main">
              <span class="crmc-result-name">${escapeHtml(flow.name)}</span>
              ${running === flow.id ? `<span class="crmc-reply-file">Rodando com este contato</span>` : ""}
              ${flow.description ? `<span class="crmc-reply-text">${escapeHtml(flow.description)}</span>` : ""}
            </div>${action}
          </div>`;
      })
      .join("")}`;
}

/** First click asks for confirmation; the second, within 5 s, starts it. */
async function startFlow(id) {
  if (flowBusy) return;
  const flow = flowsState.items.find((f) => f.id === id);
  const contactId = currentContact?.id;
  if (!flow || !contactId || !currentSendCheck().ok) return;

  if (pendingFlow?.id !== id || pendingFlow.contactId !== contactId) {
    clearPendingFlow();
    clearPendingSeq();
    clearPendingSend();
    pendingFlow = {
      id,
      contactId,
      timer: setTimeout(() => {
        pendingFlow = null;
        setRepliesStatus("");
        paintFlows();
      }, SEND_CONFIRM_MS),
    };
    const who = currentContact?.name ? ` com ${currentContact.name}` : "";
    setRepliesStatus(`Clique em Confirmar para iniciar o fluxo “${flow.name}”${who}, pelo CRM.`);
    paintFlows();
    return;
  }

  clearPendingFlow();
  flowBusy = true;
  setRepliesStatus(`Iniciando “${flow.name}”…`);
  paintFlows();
  const result = await send("startFlow", { id, contactId });
  flowBusy = false;
  setRepliesStatus(
    result.ok
      ? `Fluxo “${flow.name}” iniciado. As respostas do cliente seguem por ele.`
      : `Não iniciei “${flow.name}”: ${failureText(result, "iniciar fluxos")}`,
    result.ok ? undefined : "error",
  );
  // The banner on top says it is running, with "Pausar fluxo".
  if (currentContact?.id === contactId) await loadConversation(contactId);
  paintFlows();
}

// ------------------------------------------------------------
// Sequences
// ------------------------------------------------------------

/** Ask the CRM for its sequences, for the contact on the panel. */
async function loadSequences(force = false) {
  const contactId = currentContact?.id ?? null;
  if (!repliesOpen) return;
  if (!force && seqState.contactId === contactId && seqState.status !== "idle") return;
  if (!contactId) {
    seqState = { contactId: null, status: "idle", items: [] };
    paintSequences();
    return;
  }
  if (seqState.contactId !== contactId) {
    seqState = { contactId, status: "loading", items: [] };
    paintSequences();
  }
  const result = await send("sequences", { contactId });
  if (currentContact?.id !== contactId) return;
  if (result.ok) {
    seqState = {
      contactId,
      status: "ready",
      items: Array.isArray(result.data) ? result.data : [],
    };
  } else {
    // 403: the key may not send (before 062); 404: a CRM without
    // sequences yet. Either way there is nothing to offer.
    seqState = { contactId, status: "error", items: [] };
  }
  paintSequences();
}

function paintSequences() {
  const el = sheet()?.querySelector(".crmc-seqs");
  if (!el || !repliesOpen) return;
  // A different contact on the panel: what is listed is someone else's.
  if ((currentContact?.id ?? null) !== seqState.contactId) {
    el.innerHTML = "";
    void loadSequences();
    return;
  }
  if (seqState.status !== "ready" || !seqState.items.length) {
    el.innerHTML = "";
    return;
  }
  const check = currentSendCheck();
  if (pendingSeq && (!check.ok || pendingSeq.contactId !== seqState.contactId)) clearPendingSeq();
  el.innerHTML = `
    <p class="crmc-name crmc-seqs-title">Sequências</p>
    ${check.ok ? "" : `<p class="crmc-muted crmc-replies-note">Para iniciar uma sequência, o envio direto precisa estar ligado.</p>`}
    ${seqState.items
      .map((seq) => {
        const id = escapeHtml(seq.id);
        const plural = seq.messages === 1 ? "mensagem" : "mensagens";
        const summary =
          `${seq.messages} ${plural} · ${describeDuration(seq.duration_minutes)}` +
          (seq.stop_on_reply ? " · para se responder" : "");
        const confirming = pendingSeq?.id === seq.id;
        const action = seq.running
          ? `<button class="crmc-reply-send" data-act="seq-stop" data-id="${id}" ${seqBusy ? "disabled" : ""}
                     aria-label="Parar ${escapeHtml(seq.name)}">Parar</button>`
          : check.ok
            ? `<button class="crmc-reply-send${confirming ? " crmc-reply-confirm" : ""}" data-act="seq-start"
                       data-id="${id}" ${seqBusy ? "disabled" : ""}
                       aria-label="${confirming ? "Confirmar início de" : "Iniciar"} ${escapeHtml(seq.name)}">
                 ${confirming ? "Confirmar" : "Iniciar"}
               </button>`
            : "";
        return `
          <div class="crmc-reply-row crmc-seq">
            <div class="crmc-result crmc-seq-main">
              <span class="crmc-result-name">${escapeHtml(seq.name)}</span>
              <span class="crmc-reply-file">${escapeHtml(seq.running ? `Em andamento · ${summary}` : summary)}</span>
              ${seq.description ? `<span class="crmc-reply-text">${escapeHtml(seq.description)}</span>` : ""}
            </div>${action}
          </div>`;
      })
      .join("")}`;
}

function clearPendingSeq() {
  if (pendingSeq?.timer) clearTimeout(pendingSeq.timer);
  pendingSeq = null;
}

/** First click asks for confirmation; the second, within 5 s, starts it. */
async function startSequence(id) {
  if (seqBusy) return;
  const seq = seqState.items.find((s) => s.id === id);
  const contactId = currentContact?.id;
  if (!seq || !contactId || !currentSendCheck().ok) return;

  if (pendingSeq?.id !== id || pendingSeq.contactId !== contactId) {
    clearPendingSeq();
    clearPendingSend();
    clearPendingFlow();
    pendingSeq = {
      id,
      contactId,
      timer: setTimeout(() => {
        pendingSeq = null;
        setRepliesStatus("");
        paintSequences();
      }, SEND_CONFIRM_MS),
    };
    const who = currentContact?.name ? ` para ${currentContact.name}` : "";
    const when =
      seq.duration_minutes > 0 ? `ao longo de ${describeDuration(seq.duration_minutes)}` : "agora";
    setRepliesStatus(
      `Clique em Confirmar para iniciar “${seq.name}”${who}: ${seq.messages} ${
        seq.messages === 1 ? "mensagem" : "mensagens"
      } pelo CRM, ${when}.`,
    );
    paintSequences();
    return;
  }

  clearPendingSeq();
  seqBusy = true;
  setRepliesStatus(`Iniciando “${seq.name}”…`);
  paintSequences();
  const result = await send("startSequence", { id, contactId });
  seqBusy = false;
  if (result.ok) {
    setRepliesStatus(`“${seq.name}” iniciada. A primeira mensagem sai agora; as outras seguem sozinhas.`);
  } else {
    setRepliesStatus(`Não iniciei “${seq.name}”: ${failureText(result, "iniciar sequências")}`, "error");
  }
  await loadSequences(true);
}

/** Stop what is left of a sequence for the contact on the panel. */
async function stopSequence(id) {
  if (seqBusy) return;
  const seq = seqState.items.find((s) => s.id === id);
  const contactId = currentContact?.id;
  if (!seq || !contactId) return;
  seqBusy = true;
  paintSequences();
  const result = await send("stopSequence", { id, contactId });
  seqBusy = false;
  if (result.ok) {
    setRepliesStatus(
      result.data?.stopped
        ? `“${seq.name}” parada. O que já tinha saído, saiu.`
        : `“${seq.name}” já tinha terminado.`,
    );
  } else {
    setRepliesStatus(`Não parei “${seq.name}”: ${failureText(result, "parar sequências")}`, "error");
  }
  await loadSequences(true);
}

/** The name this person signs with now, or "" for none. */
function signatureName() {
  if (!signature.on) return "";
  return cleanSignatureName(signature.name || account.person || "");
}

/** The "Assinar como" line of the replies sheet. */
function paintSignature() {
  const slot = sheet()?.querySelector(".crmc-sign");
  if (!slot || !repliesOpen) return;
  // Never under the person's fingers: they may be typing the name.
  if (slot.contains(document.activeElement)) return;
  const shown = signature.name || account.person || "";
  slot.innerHTML = `
    <label class="crmc-sign-row">
      <input type="checkbox" class="crmc-sign-on" ${signature.on ? "checked" : ""} />
      <span>Assinar como</span>
    </label>
    <input class="crmc-input crmc-sign-name" type="text" maxlength="40" autocomplete="off"
           value="${escapeHtml(shown)}" placeholder="Seu nome" aria-label="Nome na assinatura"
           ${signature.on ? "" : "disabled"} />`;
}

/** Turn the signature on or off, or change its name, and keep it. */
function setSignature(changes) {
  if ("on" in changes) signature.on = Boolean(changes.on);
  if ("name" in changes) {
    const typed = cleanSignatureName(changes.name);
    // The CRM's own name is not stored: if it changes there, it changes here.
    signature.name = typed === cleanSignatureName(account.person || "") ? "" : typed;
  }
  void send("setPrefs", { sign: signature.on, signName: signature.name });
  const name = signatureName();
  if ("on" in changes) paintSignature();
  // Show the name as it will be signed, without the marks taken out.
  const field = sheet()?.querySelector(".crmc-sign-name");
  if ("name" in changes && field) field.value = signature.name || account.person || "";
  setRepliesStatus(
    !signature.on
      ? "Assinatura desligada."
      : name
        ? `Suas mensagens pelo painel começam com *${name}:*`
        : "Escreva o nome para a assinatura.",
    signature.on && !name ? "error" : undefined,
  );
}

/** Whether "Enviar" may show for the open chat, and why not. */
function currentSendCheck() {
  const sender = senderState.baseUrl === currentBaseUrl ? senderState : null;
  return sendCheck({
    sender,
    myPhone: myWhatsAppPhone,
    chat: currentChat,
    contact: currentContact,
  });
}

/** Ask the CRM which number it sends from (the worker keeps it a minute). */
async function loadSender() {
  const baseUrl = currentBaseUrl;
  if (!baseUrl) return;
  if (senderState.baseUrl !== baseUrl) {
    senderState = { baseUrl, status: "loading", provider: null, phone: null, at: 0 };
  }
  const result = await send("sender");
  if (currentBaseUrl !== baseUrl) return;
  if (result.ok) {
    senderState = {
      baseUrl,
      status: "ready",
      provider: result.data?.provider ?? null,
      phone: result.data?.phone ?? null,
      at: Date.now(),
    };
  } else {
    const status =
      result.error === "unauthorized" && result.status === 403
        ? "denied"
        : result.status === 404
          ? "missing"
          : "error";
    senderState = { baseUrl, status, provider: null, phone: null, at: Date.now() };
  }
  paintReplies();
}

function clearPendingSend() {
  if (pendingSend?.timer) clearTimeout(pendingSend.timer);
  pendingSend = null;
}

/**
 * First click: ask for confirmation. Second click, on the same reply in
 * the same chat within a few seconds: send it through the CRM.
 */
async function sendReply(replyId) {
  if (sendingReply) return;
  const reply = repliesState.items.find((r) => r.id === replyId);
  if (!reply) return;
  const check = currentSendCheck();
  if (!check.ok) {
    clearPendingSend();
    paintReplies();
    return;
  }

  const { text, missing } = fillTemplate(reply.text, replyContact());
  if (missing.length) {
    clearPendingSend();
    setRepliesStatus(
      "Faltou preencher " +
        missing.map((v) => `{{${v}}}`).join(", ") +
        ". Clique na resposta para colocá-la no campo de mensagem e complete antes de enviar.",
      "error",
    );
    paintReplies();
    return;
  }

  const chatKey = currentChat?.key ?? null;
  if (pendingSend?.id !== replyId || pendingSend.chatKey !== chatKey) {
    clearPendingSend();
    clearPendingSeq();
    clearPendingFlow();
    pendingSend = {
      id: replyId,
      chatKey,
      timer: setTimeout(() => {
        pendingSend = null;
        setRepliesStatus("");
        paintReplies();
      }, SEND_CONFIRM_MS),
    };
    const who = currentContact?.name ? ` para ${currentContact.name}` : "";
    setRepliesStatus(`Clique em Confirmar para enviar “${reply.title}”${who} pelo CRM.`);
    paintReplies();
    return;
  }

  clearPendingSend();
  sendingReply = true;
  setRepliesStatus(`Enviando “${reply.title}”…`);
  paintReplies();
  const gen = generation;
  // An empty caption stays empty: a signature alone is not a message.
  const signed = signText(text, signatureName());
  const result = reply.media
    ? await send("sendMedia", {
        to: check.to,
        kind: reply.media.kind,
        url: reply.media.url,
        caption: signed,
        filename: reply.media.filename,
      })
    : await send("sendText", { to: check.to, text: signed });
  sendingReply = false;
  if (result.ok) {
    // Said even if the chat changed meanwhile: it did go, to that chat.
    setRepliesStatus(
      gen === generation
        ? `“${reply.title}” enviada pelo CRM. Ela aparece na conversa em instantes.`
        : `“${reply.title}” foi enviada pelo CRM para a conversa anterior.`,
    );
  } else {
    setRepliesStatus(
      `Não enviei “${reply.title}”: ${failureText(result, "enviar mensagens")}`,
      "error",
    );
  }
  paintReplies();
}

async function loadReplies() {
  const baseUrl = currentBaseUrl;
  const known = repliesState.baseUrl === baseUrl && repliesState.status === "ready";
  // What is already here stays on screen while the fresh list comes.
  if (!known) {
    repliesState = { baseUrl, status: "loading", items: [], notice: null };
    paintReplies();
  }

  const result = await send("quickReplies");
  if (currentBaseUrl !== baseUrl) return;

  if (result.ok) {
    repliesState = {
      baseUrl,
      status: "ready",
      items: Array.isArray(result.data) ? result.data : [],
      notice: null,
    };
  } else if (!known) {
    let notice = failureText(result, "ver as respostas rápidas");
    if (result.error === "unauthorized" && result.status === 403) {
      // The key predates migration 059, which gives it this access.
      notice =
        "Sua chave ainda não tem acesso às respostas rápidas. O CRM precisa da atualização 059; depois dela, não é preciso gerar outra chave.";
    }
    repliesState = { baseUrl, status: "error", items: [], notice };
  }
  paintReplies();
}

/** WhatsApp's message box for the open chat, or null. */
function findComposer() {
  const main = document.querySelector("#main");
  if (!main) return null;
  return (
    main.querySelector('footer [contenteditable="true"][data-lexical-editor="true"]') ||
    main.querySelector('[contenteditable="true"][data-lexical-editor="true"]') ||
    main.querySelector('footer [contenteditable="true"]')
  );
}

const nextTick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The paste shortcut as this keyboard writes it. */
function pasteKeys() {
  return /mac/i.test(navigator.platform || "") ? "Cmd+V" : "Ctrl+V";
}

/**
 * Put `text` in WhatsApp's message box, after whatever is already
 * typed there. True when the box took it.
 *
 * The box is a rich-text editor that keeps its own state, so setting
 * its content from outside does nothing; what it does listen to is a
 * paste. This hands it one. If the box did not change — WhatsApp
 * rebuilt it differently — the browser's own "insert text" command is
 * tried, and the caller falls back to the clipboard after that.
 */
async function insertIntoComposer(text, signAs = "") {
  const box = findComposer();
  if (!box) return false;

  box.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(box);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);

  const before = box.textContent;
  // Signed only at the start of a message: what is already typed was
  // signed then, or the person chose not to.
  if (!before.trim()) text = signText(text, signAs);
  // On its own line when something is already typed, so the words
  // don't run together — the same thing the CRM's inbox does.
  else if (!/\s$/.test(before)) text = `\n${text}`;
  try {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    box.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  } catch {
    // No synthetic paste on this browser; the next attempt stands in.
  }
  // The editor applies a paste on its own schedule, not inside the event.
  await nextTick(120);
  if (box.textContent !== before) return true;

  try {
    document.execCommand("insertText", false, text);
  } catch {
    return false;
  }
  await nextTick(120);
  return box.textContent !== before;
}

async function useReply(replyId) {
  const reply = repliesState.items.find((r) => r.id === replyId);
  if (!reply) return;
  if (reply.media) {
    // A file can't be typed into WhatsApp's box: it leaves through the CRM.
    const check = currentSendCheck();
    setRepliesStatus(
      check.ok
        ? `“${reply.title}” tem um arquivo, que sai pelo CRM: use Enviar.`
        : `“${reply.title}” tem um arquivo, que só sai pelo CRM.${check.why ? ` ${check.why}` : ""}`,
      check.ok ? undefined : "error",
    );
    return;
  }
  const { text, missing } = fillTemplate(reply.text, replyContact());
  const check = missing.length
    ? " Faltou preencher " +
      missing.map((v) => `{{${v}}}`).join(", ") +
      ": confira o texto antes de enviar."
    : "";

  if (await insertIntoComposer(text, signatureName())) {
    setRepliesStatus(`“${reply.title}” está no campo de mensagem. Aperte Enter para enviar.${check}`);
    return;
  }

  // No chat open, or the box refused it: the clipboard still gets the
  // person there with one paste.
  const chatOpen = Boolean(document.querySelector("#main"));
  try {
    await navigator.clipboard.writeText(text);
    setRepliesStatus(
      chatOpen
        ? `Não consegui colocar no campo de mensagem. O texto foi copiado: cole com ${pasteKeys()}.${check}`
        : `Nenhuma conversa aberta. O texto foi copiado: abra a conversa e cole com ${pasteKeys()}.${check}`,
    );
  } catch {
    setRepliesStatus(
      chatOpen
        ? "Não consegui colocar o texto no campo de mensagem nem copiar. Clique no campo de mensagem e tente de novo."
        : "Abra uma conversa para colocar a resposta no campo de mensagem.",
      "error",
    );
  }
}

// ------------------------------------------------------------
// The board
//
// The pipeline as columns of cards, over WhatsApp. Opened from the
// panel's footer; a card moves by dragging it to another column or by
// the picker on the card, and "Abrir conversa" goes to that contact's
// chat.
//
// It is a child of the panel element, placed with `position: fixed`,
// so it shares the panel's colours, its style isolation and its event
// handling — and still covers the area to the left of the column.
// ------------------------------------------------------------

function board() {
  return ensurePanel().querySelector(".crmc-board");
}

function setBoardOpen(open) {
  if (open) setMyTasksOpen(false);
  const wasOpen = boardOpen;
  boardOpen = open;
  ensurePanel().classList.toggle("crmc-board-open", open);

  if (!open) {
    board().innerHTML = "";
    // The record beside the chat may list a deal the board just moved.
    if (wasOpen && boardState.moved && currentContact) void loadDeals(currentContact.id);
    boardState = { ...boardState, moved: false };
    return;
  }

  setRepliesOpen(false);
  boardQuery = "";
  board().innerHTML = `
    <header class="crmc-board-head">
      <p class="crmc-name">Funil</p>
      <div class="crmc-board-pipe"></div>
      <input class="crmc-input crmc-board-search" type="search" autocomplete="off"
             placeholder="Buscar negócio ou contato" aria-label="Buscar no funil" />
      <p class="crmc-board-sum"></p>
      <button class="crmc-btn crmc-btn-small crmc-btn-quiet" data-act="board-refresh">Atualizar</button>
      <button class="crmc-btn crmc-btn-small" data-act="board-close">Fechar</button>
    </header>
    <p class="crmc-board-note" role="status" aria-live="polite"></p>
    <div class="crmc-board-cols"></div>`;
  void loadBoard();
}

async function loadBoard(pipelineId) {
  const baseUrl = currentBaseUrl;
  boardState = {
    ...boardState,
    baseUrl,
    status: "loading",
    notice: null,
    moveNotice: null,
    pipelineId: pipelineId ?? boardState.pipelineId,
  };
  paintBoard();

  const pipes = await send("pipelines");
  if (!boardOpen || currentBaseUrl !== baseUrl) return;
  if (!pipes.ok) {
    boardState = { ...boardState, status: "error", notice: failureText(pipes, "ver os funis") };
    paintBoard();
    return;
  }
  const pipelines = (Array.isArray(pipes.data) ? pipes.data : []).filter((p) => p.stages?.length);
  if (!pipelines.length) {
    boardState = {
      ...boardState,
      pipelines: [],
      status: "error",
      notice: "Este CRM ainda não tem um funil com etapas. Crie um no CRM para vê-lo aqui.",
    };
    paintBoard();
    return;
  }
  const chosen = pipelines.find((p) => p.id === boardState.pipelineId) ?? pipelines[0];
  boardState = { ...boardState, pipelines, pipelineId: chosen.id };
  paintBoard();

  const result = await send("boardDeals", { pipelineId: chosen.id });
  // Closed, or another pipeline picked, while this was loading.
  if (!boardOpen || currentBaseUrl !== baseUrl || boardState.pipelineId !== chosen.id) return;
  boardState = result.ok
    ? {
        ...boardState,
        status: "ready",
        deals: Array.isArray(result.data?.deals) ? result.data.deals : [],
        truncated: Boolean(result.data?.truncated),
      }
    : { ...boardState, status: "error", notice: failureText(result, "ver os negócios") };
  paintBoard();
}

function renderBoardCard(deal, stages) {
  const id = escapeHtml(deal.id);
  const phone = chatPhone(deal.contact?.phone);
  const who = deal.contact?.name || deal.contact?.phone || "Sem contato";
  // A deal in the "Sem etapa" column has no stage to show as current.
  const known = stages.some((stage) => stage.id === deal.stage?.id);
  return `
    <article class="crmc-kcard" draggable="true" data-deal="${id}">
      <p class="crmc-kcard-title">${escapeHtml(deal.title)}</p>
      <p class="crmc-kcard-who">${escapeHtml(who)}</p>
      <p class="crmc-kcard-foot">
        <span class="crmc-kcard-value">${escapeHtml(formatMoney(deal.value, deal.currency))}</span>
        ${
          phone
            ? `<button class="crmc-link" data-act="board-chat" data-phone="${phone}"
                       title="Abre a conversa deste contato. O WhatsApp Web recarrega.">Abrir conversa</button>`
            : ""
        }
      </p>
      <select class="crmc-select crmc-kcard-move" data-deal="${id}"
              aria-label="Mover ${escapeHtml(deal.title)} para a etapa">
        ${known ? "" : `<option value="" selected disabled>Mover para…</option>`}
        ${stageOptions(stages, deal.stage?.id)}
      </select>
    </article>`;
}

function paintBoard() {
  const root = board();
  if (!root || !boardOpen) return;
  const { status, pipelines, pipelineId, deals, truncated, notice, moveNotice } = boardState;

  const pipeSlot = root.querySelector(".crmc-board-pipe");
  const pipeline = pipelines.find((p) => p.id === pipelineId);
  pipeSlot.innerHTML =
    pipelines.length > 1
      ? `<select class="crmc-select" name="board-pipeline" aria-label="Funil">${pipelines
          .map(
            (p) =>
              `<option value="${escapeHtml(p.id)}"${p.id === pipelineId ? " selected" : ""}>${escapeHtml(p.name)}</option>`,
          )
          .join("")}</select>`
      : pipeline
        ? `<span class="crmc-board-pipename">${escapeHtml(pipeline.name)}</span>`
        : "";

  const cols = root.querySelector(".crmc-board-cols");
  const sum = root.querySelector(".crmc-board-sum");
  const note = root.querySelector(".crmc-board-note");
  sum.textContent = "";
  note.textContent = "";
  note.classList.remove("crmc-err");

  if (status === "loading" || status === "idle") {
    cols.innerHTML = `<p class="crmc-muted">Carregando o funil…</p>`;
    return;
  }
  if (status !== "ready" || !pipeline) {
    cols.innerHTML = `<p class="crmc-muted">${escapeHtml(notice || "Não consegui carregar o funil.")}</p>`;
    return;
  }

  const shown = filterDeals(deals, boardQuery);
  const columns = boardColumns(pipeline.stages, shown);
  sum.textContent = shown.length === 1 ? "1 negócio em aberto" : `${shown.length} negócios em aberto`;
  if (moveNotice) {
    note.textContent = moveNotice;
    note.classList.add("crmc-err");
  } else if (truncated) {
    note.textContent = `Mostrando os ${deals.length} negócios mais recentes. O quadro completo está no CRM.`;
  }

  cols.innerHTML = columns
    .map((column) => {
      const cards = column.deals.map((deal) => renderBoardCard(deal, pipeline.stages)).join("");
      const total =
        column.total && column.deals.length
          ? `<span class="crmc-kcol-sum">${escapeHtml(formatMoney(column.total.value, column.total.currency))}</span>`
          : "";
      return `
        <section class="crmc-kcol" data-stage="${escapeHtml(column.stage.id ?? "")}">
          <header class="crmc-kcol-head">
            <span class="crmc-kcol-name">${escapeHtml(column.stage.name)}</span>
            <span class="crmc-count">${column.deals.length}</span>
            ${total}
          </header>
          <div class="crmc-kcol-list">${
            cards || `<p class="crmc-muted">${boardQuery.trim() ? "Nada com essa busca." : "Nenhum negócio."}</p>`
          }</div>
        </section>`;
    })
    .join("");
}

/**
 * Move a card to another stage. The card moves at once and goes back
 * if the CRM refuses — waiting for the answer before moving makes a
 * drag feel like it failed.
 */
async function moveBoardDeal(dealId, stageId) {
  const pipelineId = boardState.pipelineId;
  const pipeline = boardState.pipelines.find((p) => p.id === pipelineId);
  const deal = boardState.deals.find((d) => d.id === dealId);
  const stage = pipeline?.stages.find((s) => s.id === stageId);
  if (!deal || !stage || deal.stage?.id === stageId) return;

  const replace = (next) => {
    boardState = {
      ...boardState,
      deals: boardState.deals.map((d) => (d.id === dealId ? next : d)),
    };
  };
  replace({ ...deal, stage });
  boardState = { ...boardState, moveNotice: null };
  paintBoard();

  const result = await send("moveDeal", { id: dealId, stageId });
  // The board was closed or shows another pipeline now.
  if (!boardOpen || boardState.pipelineId !== pipelineId) return;

  if (!result.ok) {
    replace(deal);
    boardState = {
      ...boardState,
      moveNotice: `“${deal.title}” voltou para ${deal.stage?.name ?? "onde estava"}: ${failureText(result, "mover negócios")}`,
    };
  } else {
    // An older CRM answers without the contact; keep the one we had.
    replace({ ...deal, ...result.data, contact: result.data?.contact ?? deal.contact });
    boardState = { ...boardState, moved: true };
  }
  paintBoard();
}

/** Go to a contact's chat. WhatsApp's own link; the page reloads. */
function openChatWith(phone) {
  const digits = chatPhone(phone);
  if (digits) window.location.assign(`https://web.whatsapp.com/send?phone=${digits}`);
}

/**
 * Dragging a card. WhatsApp listens for drags on the whole page (to
 * offer "drop a file here"); none of these events is let out of the
 * board, so a card being dragged is not mistaken for a file.
 */
function wireBoardDragging(root) {
  let dragged = null;
  const column = (event) => event.target?.closest?.(".crmc-kcol");
  const clearTargets = () => {
    for (const el of root.querySelectorAll(".crmc-kcol-over")) el.classList.remove("crmc-kcol-over");
  };

  root.addEventListener("dragstart", (event) => {
    const card = event.target?.closest?.(".crmc-kcard");
    if (!card) return;
    dragged = card.getAttribute("data-deal");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragged);
    card.classList.add("crmc-dragging");
  });
  root.addEventListener("dragover", (event) => {
    const target = column(event);
    // Not the "Sem etapa" column: there is no stage to move to.
    if (!dragged || !target?.getAttribute("data-stage")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!target.classList.contains("crmc-kcol-over")) {
      clearTargets();
      target.classList.add("crmc-kcol-over");
    }
  });
  root.addEventListener("drop", (event) => {
    const target = column(event);
    const stageId = target?.getAttribute("data-stage");
    clearTargets();
    if (!dragged || !stageId) return;
    event.preventDefault();
    void moveBoardDeal(dragged, stageId);
  });
  root.addEventListener("dragend", () => {
    dragged = null;
    clearTargets();
    for (const el of root.querySelectorAll(".crmc-dragging")) el.classList.remove("crmc-dragging");
  });
  for (const type of ["dragstart", "dragenter", "dragover", "dragleave", "drop", "dragend"]) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }
}

// ------------------------------------------------------------
// Shortcuts in WhatsApp's chat header
//
// A row of buttons over the empty stretch of the chat header, right of
// the contact's name: each opens a part of the panel, already in place
// (shortcuts.js says where it fits). Nothing goes inside WhatsApp's
// page, so nothing breaks when it re-renders; when there is no room,
// the row gives up its last buttons, then hides.
// ------------------------------------------------------------

const SC_ICONS = {
  replies: `<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>`,
  schedule: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  task: `<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>`,
  note: `<path d="M5 3h10l4 4v14H5z"/><path d="M9 12h6M9 16h4"/>`,
  deals: `<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  sequences: `<path d="M4 6h10M4 12h10M4 18h7"/><path d="m17 14 4 3-4 3z"/>`,
  board: `<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/>`,
  crm: `<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>`,
};

// Most useful first: when room is short, the last ones go.
const SHORTCUTS = [
  { id: "replies", label: "Respostas rápidas", contact: false },
  { id: "schedule", label: "Agendar mensagem", contact: true },
  { id: "task", label: "Nova tarefa", contact: true },
  { id: "note", label: "Nova anotação", contact: true },
  { id: "deals", label: "Negócios", contact: true },
  { id: "sequences", label: "Sequências e fluxos", contact: true },
  { id: "board", label: "Funil", contact: false },
  { id: "crm", label: "Abrir no CRM", contact: true },
];

async function readPrefs() {
  const prefs = await send("getPrefs");
  if (!prefs.ok) return;
  if (prefs.data?.collapsed && !ensurePanel().classList.contains("crmc-collapsed")) setCollapsed(true);
  signature = { on: Boolean(prefs.data?.sign), name: prefs.data?.signName || "" };
  shortcutsOn = prefs.data?.shortcuts !== false;
  placeShortcutBar();
}

/** The boxes the placement needs, read from WhatsApp's chat header. */
function readHeader(header) {
  const box = (r) => ({ left: r.left, right: r.right, width: r.width });
  const buttons = [...header.querySelectorAll("button, [role='button']")].map((b) =>
    box(b.getBoundingClientRect()),
  );
  // Text boxes, glyph by glyph: an element can be wider than its words.
  const texts = [];
  const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width > 0) texts.push({ left: r.left, right: r.right });
    }
  }
  return { buttons, texts };
}

function placeShortcutBar() {
  const node = ensurePanel();
  const bar = node.querySelector(".crmc-shortcuts");
  if (!bar) return;
  const header = document.querySelector("#main header");
  const hide = () => {
    bar.hidden = true;
    shortcutsShown = 0;
  };
  if (
    !shortcutsOn ||
    !header ||
    !currentChat ||
    !node.classList.contains("crmc-connected") ||
    node.classList.contains("crmc-board-open")
  ) {
    return hide();
  }
  const rect = header.getBoundingClientRect();
  const { buttons, texts } = readHeader(header);
  const { nameRight, actionsLeft } = measureHeader(
    { left: rect.left, right: rect.right },
    buttons,
    texts,
  );
  const place = placeShortcuts({
    header: { left: rect.left, right: rect.right, top: rect.top, height: rect.height },
    nameRight,
    actionsLeft,
    want: SHORTCUTS.length,
  });
  if (!place) return hide();

  if (place.count !== shortcutsShown || bar.dataset.contact !== String(Boolean(currentContact))) {
    bar.dataset.contact = String(Boolean(currentContact));
    bar.innerHTML = SHORTCUTS.slice(0, place.count)
      .map((sc) => {
        const off = sc.contact && !currentContact;
        const label = off ? `${sc.label} (só para contatos do CRM)` : sc.label;
        return `<button class="crmc-sc" data-act="sc-${sc.id}" title="${escapeHtml(label)}"
                        aria-label="${escapeHtml(label)}" ${off ? "disabled" : ""}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">${SC_ICONS[sc.id]}</svg>
                </button>`;
      })
      .join("");
    shortcutsShown = place.count;
  }
  bar.style.left = `${place.left}px`;
  bar.style.top = `${place.top}px`;
  bar.hidden = false;
}

function focusSoon(selector) {
  setTimeout(() => ensurePanel().querySelector(selector)?.focus(), 60);
}

/** Do what a shortcut stands for, opening the panel first. */
function runShortcut(id) {
  const node = ensurePanel();
  if (node.classList.contains("crmc-collapsed")) {
    setCollapsed(false);
    void send("setPrefs", { collapsed: false });
  }
  if (id !== "board") setBoardOpen(false);
  const needsContact = SHORTCUTS.find((sc) => sc.id === id)?.contact;
  if (needsContact && !currentContact) return;

  if (id === "replies" || id === "schedule" || id === "sequences") {
    setMyTasksOpen(false);
    setRepliesOpen(true);
    setSendMode(id === "schedule" ? "later" : "now");
    if (id === "schedule") focusSoon(".crmc-when-text");
    // The sequences load after the sheet opens.
    if (id === "sequences") {
      setTimeout(() => node.querySelector(".crmc-seqs")?.scrollIntoView({ block: "start" }), 700);
    }
    return;
  }
  if (id === "board") {
    setBoardOpen(true);
    return;
  }
  if (id === "crm") {
    window.open(contactUrl(currentContact.id), "_blank", "noopener");
    return;
  }
  // The record's tabs: close what covers them, then open the tab.
  setRepliesOpen(false);
  setMyTasksOpen(false);
  if (id === "task") {
    openTab("tasks");
    focusSoon(".crmc-task-title-input");
  } else if (id === "note") {
    openTab("notes");
    focusSoon('form[data-form="note"] textarea');
  } else if (id === "deals") {
    openTab("deals");
  }
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
  // Quick replies need the CRM; and their previews carry this chat's name.
  ensurePanel().classList.toggle("crmc-connected", Boolean(configured));
  if (!configured) {
    setRepliesOpen(false);
    setMyTasksOpen(false);
    setBoardOpen(false);
  } else if (myTasks.baseUrl !== currentBaseUrl) {
    void loadMyTasks();
  }
  paintReplies();
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

// The options page may have turned the shortcuts on or off.
window.addEventListener("focus", () => void readPrefs());

let resizeQueued = false;
window.addEventListener("resize", () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    dockFailed = false;
    applyLayout();
    placeShortcutBar();
  });
});

// The DOM-reading logic lives in its own modules so it can be tested;
// an MV3 content script cannot be a module itself, so it imports them.
void (async () => {
  try {
    const mod = await import(chrome.runtime.getURL("chat-id.js"));
    chatFromPage = mod.chatFromPage;
    myPhoneFromPage = mod.myPhoneFromPage;
    chatFromDataIds = mod.chatFromDataIds;
    phoneFromHeaderTitles = mod.phoneFromHeaderTitles;
    usableChatName = mod.usableChatName;
    modulesLoaded = true;
  } catch {
    renderMessage("Não consegui carregar a extensão. Recarregue a página.");
    return;
  }
  try {
    const sc = await import(chrome.runtime.getURL("shortcuts.js"));
    placeShortcuts = sc.placeShortcuts;
    measureHeader = sc.measureHeader;
  } catch {
    // No bar; the panel does everything it offers.
  }
  try {
    sendCheck = (await import(chrome.runtime.getURL("send-check.js"))).sendCheck;
  } catch {
    // The panel never offers to send; putting text in the box still works.
  }
  try {
    pickMode = (await import(chrome.runtime.getURL("theme.js"))).pickMode;
  } catch {
    // The panel still works; it just follows the system theme.
  }
  try {
    const format = await import(chrome.runtime.getURL("format.js"));
    parseMoney = format.parseMoney;
    formatWhen = format.formatWhen;
    addTagName = format.addTagName;
    fillTemplate = format.fillTemplate;
    filterReplies = format.filterReplies;
    filterDeals = format.filterDeals;
    boardColumns = format.boardColumns;
    chatPhone = format.chatPhone;
    describeDue = format.describeDue;
    countDueNow = format.countDueNow;
    localInputToIso = format.localInputToIso;
    signText = format.signText;
    cleanSignatureName = format.cleanSignatureName;
    describeDuration = format.describeDuration;
    defaultScheduleValue = format.defaultScheduleValue;
    describeScheduled = format.describeScheduled;
    googleCalendarUrl = format.googleCalendarUrl;
    taskEventDetails = format.taskEventDetails;
  } catch {
    // The fallbacks above stand in.
  }
  applyMode();
  await refresh(true);
  setInterval(() => {
    applyMode();
    keepDock();
    placeShortcutBar();
    refreshMyTasksIfStale();
    void refresh(false);
  }, POLL_MS);
})();
