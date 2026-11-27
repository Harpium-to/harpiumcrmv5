import type { Notification } from "@/types";

// ============================================================
// Where a notification leads when someone clicks it.
//
// Shared by the Notificações screen and the bell in the top bar, so
// both open the same place for the same notification.
// ============================================================

export type NotificationTarget =
  | { kind: "harpi" }
  | { kind: "route"; href: string };

export function notificationTarget(
  n: Pick<Notification, "type" | "contact_id" | "conversation_id">,
): NotificationTarget | null {
  // A routine's report lives in its Harpi conversation.
  if (n.type === "assistente") return { kind: "harpi" };
  // New alerts and the week's digest both live on the Radar.
  if (n.type === "radar") return { kind: "route", href: "/radar" };
  if (n.type === "agency_access_request") {
    return { kind: "route", href: "/settings?tab=agencia" };
  }
  // The agenda lists what is waiting for approval at the top.
  if (n.type === "agenda_booking" || n.type === "agenda_google") {
    return { kind: "route", href: "/agenda" };
  }
  // Straight to the contact the task is about.
  if (n.type === "task_due" && n.contact_id) {
    return { kind: "route", href: `/contacts?contact=${n.contact_id}` };
  }
  if (n.conversation_id) {
    return { kind: "route", href: `/inbox?c=${n.conversation_id}` };
  }
  return null;
}
