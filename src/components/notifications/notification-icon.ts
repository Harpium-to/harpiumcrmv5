import {
  AlarmClock,
  Bell,
  Bot,
  CalendarCheck,
  CalendarDays,
  ListTodo,
  Radar,
  ShieldCheck,
  Undo2,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Notification } from "@/types";

/** Icon per notification type, for the Notificações screen and the bell. */
export const NOTIFICATION_ICON: Record<Notification["type"], LucideIcon> = {
  conversation_assigned: UserPlus,
  agency_access_request: ShieldCheck,
  task_due: ListTodo,
  agenda_booking: CalendarDays,
  agenda_google: CalendarCheck,
  assistente: Bot,
  team_queue: Users,
  conversation_overdue: AlarmClock,
  conversation_returned: Undo2,
  radar: Radar,
};

export function notificationIcon(type: Notification["type"]): LucideIcon {
  return NOTIFICATION_ICON[type] ?? Bell;
}
