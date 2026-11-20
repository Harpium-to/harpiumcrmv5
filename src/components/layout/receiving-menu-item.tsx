"use client";

import { PauseCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useMembers } from "@/hooks/use-atendimento";
import { createClient } from "@/lib/supabase/client";

/**
 * "Pausar recebimento" in the avatar menu: the person takes themselves
 * out of every rotation (lunch, a meeting, holidays) and back in, with
 * one click. Same switch as Configurações › Atendimento e setores.
 * Hidden for viewers (they never receive) and before migration 076.
 */
export function ReceivingMenuItem() {
  const { user, accountRole } = useAuth();
  const { members, loaded, reload } = useMembers();
  const me = members.find((m) => m.user_id === user?.id);

  if (!loaded || !me || accountRole === "viewer" || me.receives_conversations === undefined) {
    return null;
  }
  const receiving = me.receives_conversations !== false;

  const toggle = async () => {
    const { error } = await createClient().rpc("set_receives_conversations", {
      p_user_id: me.user_id,
      p_on: !receiving,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(receiving ? "Recebimento pausado: você saiu do rodízio" : "Você voltou a receber conversas");
    void reload();
  };

  return (
    <DropdownMenuItem
      onClick={() => void toggle()}
      className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
    >
      {receiving ? <PauseCircle className="size-4" /> : <PlayCircle className="size-4" />}
      {receiving ? "Pausar recebimento" : "Voltar a receber conversas"}
    </DropdownMenuItem>
  );
}
