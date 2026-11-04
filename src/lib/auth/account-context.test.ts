import { describe, expect, it } from "vitest";

import {
  isMissingFunction,
  isMissingTable,
  parseAccountContext,
} from "./account-context";

describe("parseAccountContext", () => {
  it("reads a membership context", () => {
    expect(
      parseAccountContext({
        account_id: "a1",
        account_name: "Clínica X",
        role: "owner",
        via_agency: false,
        status: "onboarding",
      }),
    ).toEqual({
      accountId: "a1",
      role: "owner",
      account: { id: "a1", name: "Clínica X" },
      viaAgency: false,
      status: "onboarding",
    });
  });

  it("reads an agency context", () => {
    expect(
      parseAccountContext({
        account_id: "a1",
        account_name: "X",
        role: "admin",
        via_agency: true,
      })?.viaAgency,
    ).toBe(true);
  });

  it("reads a context from before migration 050 as active", () => {
    expect(
      parseAccountContext({ account_id: "a1", role: "agent" })?.status,
    ).toBe("active");
  });

  it("treats SQL NULL as no active CRM", () => {
    expect(parseAccountContext(null)).toBeNull();
  });

  it("never guesses a role it doesn't know", () => {
    expect(
      parseAccountContext({ account_id: "a1", role: "superuser" }),
    ).toBeNull();
    expect(parseAccountContext({ account_id: "", role: "owner" })).toBeNull();
    expect(parseAccountContext({ role: "owner" })).toBeNull();
    expect(parseAccountContext("owner")).toBeNull();
  });

  it("only a literal true marks an agency session", () => {
    expect(
      parseAccountContext({ account_id: "a1", role: "viewer", via_agency: "yes" })
        ?.viaAgency,
    ).toBe(false);
  });
});

describe("missing-migration detection", () => {
  it("recognises a function that doesn't exist yet", () => {
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ code: "42501" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });

  it("recognises a table that doesn't exist yet", () => {
    expect(isMissingTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable({ code: "23505" })).toBe(false);
  });
});
