import { afterEach, describe, expect, it, vi } from "vitest";

// getCurrentAccount resolves the caller's account context.
//
// Since migration 049 it asks the database (`current_account_context`
// RPC) for the active CRM and the effective role. When that function
// doesn't exist yet (049 not applied) it falls back to the pre-049
// lookup, which carries the regression this file has always guarded
// (issue #294): no PostgREST embedded FK join (`accounts!inner`) — a
// stale schema cache makes that embed fail hard and blanks the whole
// context — but two plain point queries.

// ------------------------------------------------------------
// Chainable Supabase query-builder mock. Each `.from(table)` hands back
// a thenable builder pre-loaded with the result queued for that table,
// so we can assert which tables were queried and with what filters.
// ------------------------------------------------------------
interface BuilderCall {
  table: string;
  columns?: string;
  eqArgs: [string, unknown][];
}

// Pre-049 database: the context RPC doesn't exist.
const RPC_MISSING = { data: null, error: { code: "PGRST202" } };

function makeClient(opts: {
  user: { id: string } | null;
  userErr?: unknown;
  rpc?: { data: unknown; error: unknown };
  byTable: Record<string, { data: unknown; error: unknown }>;
}) {
  const calls: BuilderCall[] = [];
  const rpcCalls: string[] = [];

  const from = (table: string) => {
    const call: BuilderCall = { table, eqArgs: [] };
    calls.push(call);
    const builder = {
      select(columns: string) {
        call.columns = columns;
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqArgs.push([col, val]);
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(
          opts.byTable[table] ?? { data: null, error: null },
        );
      },
    };
    return builder;
  };

  return {
    calls,
    rpcCalls,
    client: {
      rpc: (fn: string) => {
        rpcCalls.push(fn);
        return Promise.resolve(opts.rpc ?? RPC_MISSING);
      },
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: opts.user },
            error: opts.userErr ?? null,
          }),
      },
      from,
    },
  };
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { getCurrentAccount, requireRole, UnauthorizedError, ForbiddenError } =
  await import("./account");

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentAccount — migration 049 applied", () => {
  it("trusts the database's active CRM and effective role", async () => {
    const { client, calls, rpcCalls } = makeClient({
      user: { id: "user-1" },
      rpc: {
        data: {
          account_id: "acct-1",
          account_name: "Clínica X",
          role: "agent",
          via_agency: false,
        },
        error: null,
      },
      byTable: {},
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(rpcCalls).toEqual(["current_account_context"]);
    expect(calls).toEqual([]); // no profile/account reads
    expect(ctx).toMatchObject({
      userId: "user-1",
      accountId: "acct-1",
      role: "agent",
      account: { id: "acct-1", name: "Clínica X" },
      viaAgency: false,
    });
  });

  it("carries an agency session through as viaAgency", async () => {
    const { client } = makeClient({
      user: { id: "agency-1" },
      rpc: {
        data: {
          account_id: "acct-9",
          account_name: "Academia Y",
          role: "viewer",
          via_agency: true,
        },
        error: null,
      },
      byTable: {},
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).resolves.toMatchObject({
      role: "viewer",
      viaAgency: true,
    });
  });

  it("rejects a caller with no active CRM (RPC returns null)", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      rpc: { data: null, error: null },
      byTable: {},
    });
    createClient.mockReturnValue(client);
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe("Você não está em nenhum CRM");
  });

  it("a suspended CRM reads but refuses writes, and says why", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      rpc: {
        data: {
          account_id: "acct-1",
          account_name: "Clínica X",
          role: "owner",
          status: "suspended",
          via_agency: false,
        },
        error: null,
      },
      byTable: {},
    });
    createClient.mockReturnValue(client);
    await expect(requireRole("viewer")).resolves.toMatchObject({
      status: "suspended",
    });
    await expect(requireRole("agent")).rejects.toThrow(
      "Este CRM está suspenso: só leitura. Fale com a agência.",
    );
  });

  it("fails closed on any other RPC error instead of falling back", async () => {
    const { client, calls } = makeClient({
      user: { id: "user-1" },
      rpc: { data: null, error: { code: "57014" } },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "owner" },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Não consegui carregar os dados da conta",
    );
    expect(calls).toEqual([]);
  });
});

describe("getCurrentAccount — before migration 049 (fallback)", () => {
  it("resolves context via a plain accounts lookup, not an embedded join", async () => {
    const { client, calls } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "owner" },
          error: null,
        },
        accounts: { data: { id: "acct-1", name: "Acme" }, error: null },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: "user-1",
      accountId: "acct-1",
      role: "owner",
      account: { id: "acct-1", name: "Acme" },
      viaAgency: false,
    });

    // Two queries: profiles by user_id, then accounts by id. Neither
    // selects an embedded relationship — the regression guard.
    expect(calls.map((c) => c.table)).toEqual(["profiles", "accounts"]);
    expect(calls[0].columns).not.toMatch(/accounts!/);
    expect(calls[0].eqArgs).toEqual([["user_id", "user-1"]]);
    expect(calls[1].columns).not.toMatch(/accounts!/);
    expect(calls[1].eqArgs).toEqual([["id", "acct-1"]]);
  });

  it("throws UnauthorizedError when there is no session", async () => {
    const { client } = makeClient({ user: null, byTable: {} });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("maps a profiles query error to 'Não consegui carregar os dados da conta'", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: null, error: { code: "PGRST200" } },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Não consegui carregar os dados da conta",
    );
  });

  it("maps an accounts query error to 'Não consegui carregar os dados da conta'", async () => {
    // The exact #294 shape if the embed were still in play, but now on
    // the decoupled accounts lookup: profile resolves, account read errors.
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "admin" },
          error: null,
        },
        accounts: { data: null, error: { code: "PGRST200" } },
      },
    });
    createClient.mockReturnValue(client);
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe("Não consegui carregar os dados da conta");
  });

  it("rejects a profile not linked to an account", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: { account_id: null, account_role: null }, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "O perfil não está ligado a uma conta",
    );
  });

  it("rejects an account_id that resolves to no readable account", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "viewer" },
          error: null,
        },
        accounts: { data: null, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "O perfil não está ligado a uma conta",
    );
  });
});
