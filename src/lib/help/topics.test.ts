import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "@/lib/nav";

import { HELP_TIPS, HELP_TOPICS, searchTopics, topicForPath } from "./topics";

describe("help topics", () => {
  it("gives every topic a unique anchor", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("explains every screen in the menu", () => {
    // The "?" in the top bar opens the topic for the current screen; a
    // new route without one would fall back to the plain help link.
    const missing = NAV_ITEMS.filter((i) => i.href !== "/ajuda")
      .filter((i) => !topicForPath(i.href))
      .map((i) => i.href);
    expect(missing).toEqual([]);
  });

  it("points every field tip at a topic that exists", () => {
    const ids = new Set(HELP_TOPICS.map((t) => t.id));
    for (const [key, tip] of Object.entries(HELP_TIPS)) {
      if (tip.topic) expect(ids.has(tip.topic), key).toBe(true);
    }
  });

  it("matches sub-routes to their screen, but nothing else to the dashboard", () => {
    expect(topicForPath("/flows/abc")?.id).toBe("fluxos");
    expect(topicForPath("/dashboard")?.id).toBe("painel");
    expect(topicForPath("/dashboardx")).toBeUndefined();
    expect(topicForPath("/ajuda")).toBeUndefined();
  });

  it("searches without caring about accents or case", () => {
    expect(searchTopics("TRANSMISSOES").map((t) => t.id)).toContain("transmissoes");
    expect(searchTopics("janela 24 horas").map((t) => t.id)).toContain("caixa-de-entrada");
    expect(searchTopics("palavra-que-nao-existe-xyz")).toEqual([]);
    expect(searchTopics("   ")).toHaveLength(HELP_TOPICS.length);
  });
});
