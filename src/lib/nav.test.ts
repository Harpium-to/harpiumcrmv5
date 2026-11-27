import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import pt from "../../messages/pt.json";

import {
  NAV_GROUP_LABEL_KEYS,
  NAV_GROUPS,
  NAV_ITEMS,
  visibleNavGroups,
} from "./nav";

/** What the desktop rail draws, in order: everything not in the top bar. */
const railHrefs = () =>
  NAV_GROUPS.flatMap((g) =>
    NAV_ITEMS.filter((i) => i.group === g && !i.topbar).map((i) => i.href),
  );

describe("nav registry", () => {
  it("orders the rail by the client's day, in four groups", () => {
    expect(railHrefs()).toEqual([
      // Dia a dia
      "/dashboard",
      "/inbox",
      "/leads",
      "/pipelines",
      "/agenda",
      "/contacts",
      // Acompanhar
      "/relatorios",
      "/radar",
      // Automatizar
      "/agents",
      "/automations",
      "/flows",
      "/broadcasts",
      // Ajustes
      "/canais",
      "/settings",
    ]);
  });

  it("keeps the rail short enough for a laptop window", () => {
    // 14 items is about 740px. Past that the rail scrolls with a hidden
    // scrollbar, and the last items just vanish below the fold (Ajuda
    // did, with 16). Make room elsewhere before raising this.
    expect(railHrefs().length).toBeLessThanOrEqual(14);
  });

  it("puts Notificações, Ajuda and Ferramentas in the top bar", () => {
    const topbar = NAV_ITEMS.filter((i) => i.topbar).map((i) => i.href);
    expect(topbar.sort()).toEqual(["/ajuda", "/ferramentas", "/notifications"]);
  });

  it("lists every item in a group the rail knows", () => {
    for (const item of NAV_ITEMS) expect(NAV_GROUPS, item.href).toContain(item.group);
  });

  it("names every group in both languages", () => {
    for (const group of NAV_GROUPS) {
      const key = NAV_GROUP_LABEL_KEYS[group];
      expect(pt.Sidebar, `pt ${key}`).toHaveProperty(key);
      expect(en.Sidebar, `en ${key}`).toHaveProperty(key);
    }
  });
});

describe("visibleNavGroups", () => {
  it("gives owners and admins the whole menu", () => {
    expect(visibleNavGroups("owner", false)).toEqual(NAV_GROUPS);
    expect(visibleNavGroups("admin", false)).toEqual(NAV_GROUPS);
  });

  it("gives attendants and viewers only the day's work and the numbers", () => {
    expect(visibleNavGroups("agent", false)).toEqual(["work", "track"]);
    expect(visibleNavGroups("viewer", false)).toEqual(["work", "track"]);
  });

  it("keeps the whole menu for the agency, even as a viewer", () => {
    expect(visibleNavGroups("viewer", true)).toEqual(NAV_GROUPS);
    expect(visibleNavGroups("agent", true)).toEqual(NAV_GROUPS);
  });

  it("does not hide anything while the role is still loading", () => {
    expect(visibleNavGroups(null, false)).toEqual(NAV_GROUPS);
  });
});
