import { describe, expect, it } from "vitest";

import { notificationTarget } from "./target";

describe("notificationTarget", () => {
  it("opens the Harpi history for a routine's report", () => {
    expect(notificationTarget({ type: "assistente" })).toEqual({ kind: "harpi" });
  });

  it("sends Radar alerts to the Radar", () => {
    expect(notificationTarget({ type: "radar" })).toEqual({
      kind: "route",
      href: "/radar",
    });
  });

  it("sends an agency access request to the agency settings", () => {
    expect(notificationTarget({ type: "agency_access_request" })).toEqual({
      kind: "route",
      href: "/settings?tab=agencia",
    });
  });

  it("sends both agenda notifications to the agenda", () => {
    for (const type of ["agenda_booking", "agenda_google"] as const) {
      expect(notificationTarget({ type })).toEqual({ kind: "route", href: "/agenda" });
    }
  });

  it("sends a due task to its contact, or nowhere without one", () => {
    expect(notificationTarget({ type: "task_due", contact_id: "c1" })).toEqual({
      kind: "route",
      href: "/contacts?contact=c1",
    });
    expect(notificationTarget({ type: "task_due" })).toBeNull();
  });

  it("opens the conversation for conversation notifications", () => {
    expect(
      notificationTarget({ type: "conversation_assigned", conversation_id: "v1" }),
    ).toEqual({ kind: "route", href: "/inbox?c=v1" });
    expect(notificationTarget({ type: "team_queue" })).toBeNull();
  });
});
