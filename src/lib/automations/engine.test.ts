import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mock state for the service-role client. Lives in a hoisted block
// so the vi.mock factory below can close over it.
const h = vi.hoisted(() => ({
  state: {
    owned: null as { id: string } | null,
    ownedCustomField: null as { id: string } | null,
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    fromCalls: [] as string[],
    updateCalls: [] as { table: string; filters: [string, string, unknown][] }[],
    upsertCalls: [] as { table: string; payload: unknown }[],
    openDeals: [] as { id: string }[],
    dealSelects: [] as [string, string, unknown][][],
    dealInserts: [] as unknown[],
    logCreatedAt: "2026-11-10T10:00:00Z" as string | null,
    customerReplies: 0,
    agent: null as { id: string } | null,
    taskInserts: [] as Record<string, unknown>[],
  },
}));

vi.mock("./admin-client", () => {
  const { state } = h;

  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
    filters: [string, string, unknown][];
  }) {
    const { table, type } = ops;
    if (table === "contacts") {
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters });
        return { data: null, error: null };
      }
      // ownership guard / condition read
      return { data: state.owned, error: null };
    }
    if (table === "custom_fields") {
      // account-scoped ownership lookup for a custom field definition
      return { data: state.ownedCustomField, error: null };
    }
    if (table === "contact_custom_values") {
      if (type === "upsert") {
        state.upsertCalls.push({ table, payload: ops.payload });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "automations") return { data: state.automations, error: null };
    if (table === "automation_logs") {
      if (type === "insert") return { data: { id: "log1" }, error: null };
      if (type === "update") return { data: null, error: null };
      return {
        data: { steps_executed: [], status: "success", created_at: state.logCreatedAt },
        error: null,
      };
    }
    if (table === "conversations") return { data: [{ id: "conv1" }], error: null };
    if (table === "messages") return { data: null, count: state.customerReplies, error: null };
    if (table === "automation_steps") return { data: state.steps, error: null };
    if (table === "deals") {
      if (type === "insert") {
        state.dealInserts.push(ops.payload);
        return { data: null, error: null };
      }
      state.dealSelects.push(ops.filters);
      return { data: state.openDeals, error: null };
    }
    if (table === "agents") return { data: state.agent, error: null };
    if (table === "agent_tasks" && type === "insert") {
      state.taskInserts.push(ops.payload as Record<string, unknown>);
      return { data: { id: "task1", ...(ops.payload as Record<string, unknown>) }, error: null };
    }
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = {
      table,
      type: "select",
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      delete: () => ((ops.type = "delete"), b),
      upsert: (p: unknown) => ((ops.type = "upsert"), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(["eq", k, v]), b),
      gte: () => b,
      gt: () => b,
      in: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendInteractive: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
}));

import { customerRepliedSinceStart, runAutomationsForTrigger, triggerMatches } from "./engine";
import type { Automation } from "@/types";

const ACCOUNT = "acct-1";

beforeEach(() => {
  h.state.owned = null;
  h.state.ownedCustomField = null;
  h.state.automations = [];
  h.state.steps = [];
  h.state.fromCalls = [];
  h.state.updateCalls = [];
  h.state.upsertCalls = [];
  h.state.openDeals = [];
  h.state.dealSelects = [];
  h.state.dealInserts = [];
  h.state.logCreatedAt = "2026-11-10T10:00:00Z";
  h.state.customerReplies = 0;
  h.state.agent = null;
  h.state.taskInserts = [];
});

describe("runAutomationsForTrigger — tenant isolation", () => {
  it("refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)", async () => {
    // Ownership lookup returns nothing — the contact belongs to another tenant.
    h.state.owned = null;
    // If the guard failed, this automation would run an update_contact_field step.
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "victim-contact-uuid",
      context: { message_text: "manual trigger" },
    });

    // Bailed at the guard: never fetched automations, never wrote a contact.
    expect(h.state.fromCalls).toContain("contacts");
    expect(h.state.fromCalls).not.toContain("automations");
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("proceeds past the guard when the contact belongs to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = []; // no matching automations; just prove we got past the guard

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.fromCalls).toContain("automations");
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const filters = h.state.updateCalls[0].filters;
    expect(filters).toContainEqual(["eq", "id", "c1"]);
    expect(filters).toContainEqual(["eq", "account_id", ACCOUNT]);
  });
});

describe("update_contact_field — custom fields", () => {
  it("upserts contact_custom_values when the field is account-owned", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "Premium")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // No direct contacts column write for a custom field.
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].payload).toEqual({
      contact_id: "c1",
      custom_field_id: "cf1",
      value: "Premium",
    });
  });

  it("interpolates {{ vars.* }} into the custom value", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "{{ vars.source }}")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { vars: { source: "WhatsApp Ad" } },
    });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect(
      (h.state.upsertCalls[0].payload as { value: string }).value,
    ).toBe("WhatsApp Ad");
  });

  it("refuses to write a custom field from another account", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = null; // account-scoped lookup finds nothing
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:foreign-cf", "x")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.state.updateCalls).toHaveLength(0);
  });
});

describe("send_webhook — SSRF guard (GHSA-8jqh-598v-rfxc)", () => {
  it("refuses a private / link-local destination and never calls fetch", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    // Aimed at the cloud metadata endpoint — the classic SSRF target.
    h.state.steps = [webhookStep("http://169.254.169.254/latest/meta-data/")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // The automation matched and its steps were loaded (so we genuinely
    // reached the send_webhook case)...
    expect(h.state.fromCalls).toContain("automation_steps");
    // ...yet the guard blocked it before any outbound request left the box.
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("create_deal — one open card per contact per funnel", () => {
  it("creates the deal when the contact has no open deal in that funnel", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [createDealStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.dealInserts).toHaveLength(1);
    expect(h.state.dealInserts[0]).toMatchObject({
      account_id: ACCOUNT,
      pipeline_id: "p1",
      stage_id: "st1",
      contact_id: "c1",
      status: "open",
    });
  });

  it("skips it when the first-contact deal (or any open one) is already in that funnel", async () => {
    h.state.owned = { id: "c1" };
    h.state.openDeals = [{ id: "d-existing" }];
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [createDealStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.dealInserts).toHaveLength(0);
    // The lookup was scoped to this account, contact, funnel and open status.
    expect(h.state.dealSelects[0]).toEqual(
      expect.arrayContaining([
        ["eq", "account_id", ACCOUNT],
        ["eq", "contact_id", "c1"],
        ["eq", "pipeline_id", "p1"],
        ["eq", "status", "open"],
      ]),
    );
  });
});

function createDealStep() {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "create_deal",
    position: 0,
    parent_step_id: null,
    step_config: { pipeline_id: "p1", stage_id: "st1", title: "Novo lead" },
  };
}

function webhookStep(url: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "send_webhook",
    position: 0,
    parent_step_id: null,
    step_config: { url, headers: { "Metadata-Flavor": "Google" }, body_template: "{}" },
  };
}

function automationWithUpdateStep() {
  return {
    id: "a1",
    account_id: ACCOUNT,
    user_id: "u1",
    trigger_type: "new_message_received",
    trigger_config: {},
    is_active: true,
  };
}

function updateStep() {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field: "company", value: "pwned-by-automation" },
  };
}

function customStep(field: string, value: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field, value },
  };
}

describe("triggerMatches — interactive_reply", () => {
  function automation(reply_ids: string[]): Automation {
    return {
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "menu step",
      trigger_type: "interactive_reply",
      trigger_config: { reply_ids },
      is_active: true,
      execution_count: 0,
      created_at: "",
      updated_at: "",
    };
  }

  it("matches when the tapped id is in reply_ids (exact)", () => {
    expect(
      triggerMatches(automation(["yes", "no"]), { interactive_reply_id: "yes" }),
    ).toBe(true);
  });

  it("does not match a different id", () => {
    expect(
      triggerMatches(automation(["yes"]), { interactive_reply_id: "maybe" }),
    ).toBe(false);
  });

  it("does not match on a substring (exact only)", () => {
    expect(
      triggerMatches(automation(["yes"]), { interactive_reply_id: "yes_please" }),
    ).toBe(false);
  });

  it("does not match when no reply id is present or config is empty", () => {
    expect(triggerMatches(automation(["yes"]), {})).toBe(false);
    expect(triggerMatches(automation([]), { interactive_reply_id: "yes" })).toBe(false);
  });
});

describe("sequences (manual trigger)", () => {
  const sequence = (cfg: Record<string, unknown>) =>
    ({
      id: "seq1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "Follow-up",
      trigger_type: "manual",
      trigger_config: cfg,
      is_active: true,
      execution_count: 0,
      created_at: "",
      updated_at: "",
    }) as unknown as Automation;
  const pending = { contact_id: "c1", log_id: "log1" };

  it("a generic dispatch never runs a sequence", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [sequence({}) as unknown as Record<string, unknown>];
    await runAutomationsForTrigger({ accountId: ACCOUNT, triggerType: "manual", contactId: "c1" });
    expect(h.state.fromCalls).toEqual([]);
  });

  it("stops after a wait when set to, and the customer wrote since it started", async () => {
    h.state.customerReplies = 1;
    expect(await customerRepliedSinceStart(sequence({ stop_on_reply: true }), pending)).toBe(true);
  });

  it("goes on when the customer has not written", async () => {
    expect(await customerRepliedSinceStart(sequence({ stop_on_reply: true }), pending)).toBe(false);
  });

  it("goes on when not set to stop, or for any other automation", async () => {
    h.state.customerReplies = 1;
    expect(await customerRepliedSinceStart(sequence({}), pending)).toBe(false);
    const other = { ...sequence({ stop_on_reply: true }), trigger_type: "new_message_received" } as Automation;
    expect(await customerRepliedSinceStart(other, pending)).toBe(false);
    expect(h.state.fromCalls).toEqual([]);
  });

  it("goes on when it can't tell when the run started", async () => {
    h.state.customerReplies = 1;
    h.state.logCreatedAt = null;
    expect(await customerRepliedSinceStart(sequence({ stop_on_reply: true }), pending)).toBe(false);
  });
});

describe("lead_received + agent_handoff", () => {
  const lead = {
    lead_id: "lead-1",
    source: "quiz-planejados",
    origem: "quiz-planejados",
    rota: "A" as const,
    etiquetas: ["quiz-planejados", "rota-a", "verba-baixa"],
    nome: "Ana",
    empresa: "Planejados Silva",
    campanha: null,
    respostas: [{ pergunta: "Maior desafio", resposta: "Só pedem preço" }],
    nota: null,
    consentimento: null,
  };
  const leadAutomation = (cfg: Record<string, unknown>) =>
    ({
      id: "a-lead",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "Quiz rota A → SDR",
      trigger_type: "lead_received",
      trigger_config: cfg,
      is_active: true,
      execution_count: 0,
      created_at: "",
      updated_at: "",
    }) as unknown as Automation;
  const handoffStep = {
    id: "s-h",
    automation_id: "a-lead",
    step_type: "agent_handoff",
    position: 0,
    parent_step_id: null,
    step_config: { role: "sdr", instruction: "Comece validando o investimento" },
  };

  it("matches on origin, route and every required tag", () => {
    const a = leadAutomation({ origens: ["Quiz Planejados"], rota: "A", etiquetas: ["verba-baixa"] });
    expect(triggerMatches(a, { lead })).toBe(true);
    expect(triggerMatches(a, { lead: { ...lead, rota: "B" } })).toBe(false);
    expect(triggerMatches(a, { lead: { ...lead, etiquetas: ["rota-a"] } })).toBe(false);
    expect(triggerMatches(a, { lead: { ...lead, source: "google", origem: "google" } })).toBe(false);
    expect(triggerMatches(a, {})).toBe(false);
  });

  it("hands the contact to the SDR with the lead's answers, once per lead", async () => {
    h.state.owned = { id: "c1" };
    h.state.agent = { id: "agent-sdr" };
    h.state.automations = [leadAutomation({ rota: "A" }) as unknown as Record<string, unknown>];
    h.state.steps = [handoffStep];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "lead_received",
      contactId: "c1",
      context: { conversation_id: "conv1", lead },
    });

    expect(h.state.taskInserts).toHaveLength(1);
    const task = h.state.taskInserts[0];
    expect(task).toMatchObject({
      account_id: ACCOUNT,
      target_role: "sdr",
      kind: "outreach",
      contact_id: "c1",
      conversation_id: "conv1",
      priority: 10,
      dedupe_key: "handoff:a-lead:lead-1",
    });
    const input = task.input as Record<string, string>;
    expect(input.respostas_do_lead).toBe("Maior desafio: Só pedem preço");
    expect(input.instrucao).toBe("Comece validando o investimento");
    expect(input.rota).toBe("A");
  });

  it("queues nothing without an active agent of the role", async () => {
    h.state.owned = { id: "c1" };
    h.state.agent = null;
    h.state.automations = [leadAutomation({}) as unknown as Record<string, unknown>];
    h.state.steps = [handoffStep];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "lead_received",
      contactId: "c1",
      context: { lead },
    });
    expect(h.state.taskInserts).toHaveLength(0);
  });
});
