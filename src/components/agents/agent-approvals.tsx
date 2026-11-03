"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/dashboard/skeleton";
import { compactAgo } from "./format";
import type { AgentApproval } from "@/lib/agents/types";

/** Known action kinds → a label. Anything else reads as "Ação". */
const KIND_LABEL: Record<string, string> = {
  send_message: "kindSendMessage",
  discount: "kindDiscount",
  give_discount: "kindDiscount",
  proposal: "kindProposal",
  send_proposal: "kindProposal",
  contract: "kindContract",
  delete: "kindDelete",
  delete_data: "kindDelete",
};

const REASON_LABEL: Record<string, string> = {
  autonomy_below_threshold: "approvalReasonAutonomy",
  never_unattended: "approvalReasonNever",
  pinned_by_operator: "approvalReasonPinned",
};

interface ApprovalsProps {
  /** Admin/agent members decide; viewers read. */
  canDecide: boolean;
}

/**
 * The approvals queue.
 *
 * Every row is an action an agent wanted to take and stopped short of.
 * The operator can approve it as written, edit the text and approve
 * the edit, or reject it — and rejecting cancels the task behind it,
 * so "no" actually means no rather than "ask me again in a minute".
 *
 * The message body is editable in place for a reason: the common case
 * is not "this agent was wrong", it is "this is nearly right". Making
 * the operator reject, then go and rewrite the prompt, then wait for
 * the agent to try again, is how an approvals queue becomes a thing
 * people stop opening.
 */
export function AgentApprovals({ canDecide }: ApprovalsProps) {
  const t = useTranslations("Agents");
  const [approvals, setApprovals] = useState<AgentApproval[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/approvals?status=pending");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { approvals: AgentApproval[] };
      setApprovals(data.approvals ?? []);
    } catch {
      setApprovals((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(
    approval: AgentApproval,
    decision: "approve" | "reject",
    editedText?: string,
    note?: string,
  ) {
    setPendingId(approval.id);
    try {
      const body: Record<string, unknown> = { decision };
      if (note) body.note = note;
      // Only send an edit when the text actually changed — an
      // `edited_payload` identical to the original would make the audit
      // trail claim a human rewrote something they didn't touch.
      if (
        decision === "approve" &&
        editedText !== undefined &&
        editedText !== String(approval.payload.text ?? "")
      ) {
        body.edited_payload = { ...approval.payload, text: editedText };
      }

      const res = await fetch(`/api/agents/approvals/${approval.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "erro");

      setApprovals((prev) => (prev ?? []).filter((a) => a.id !== approval.id));
      toast.success(
        t(decision === "approve" ? "approvalApproved" : "approvalRejected"),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "erro");
    } finally {
      setPendingId(null);
    }
  }

  if (approvals === null) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (approvals.length === 0) {
    return (
      <div className="surface rounded-2xl px-6 py-16 text-center">
        <ShieldCheck
          className="mx-auto size-8 text-muted-foreground/60"
          aria-hidden
        />
        <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
          {t("approvalsEmpty")}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {approvals.map((approval) => (
        <ApprovalRow
          key={approval.id}
          approval={approval}
          canDecide={canDecide}
          pending={pendingId === approval.id}
          onDecide={decide}
        />
      ))}
    </ul>
  );
}

function ApprovalRow({
  approval,
  canDecide,
  pending,
  onDecide,
}: {
  approval: AgentApproval;
  canDecide: boolean;
  pending: boolean;
  onDecide: (
    approval: AgentApproval,
    decision: "approve" | "reject",
    editedText?: string,
    note?: string,
  ) => void;
}) {
  const t = useTranslations("Agents");
  const originalText = String(approval.payload.text ?? "");
  const [text, setText] = useState(originalText);
  const [note, setNote] = useState("");

  const kindKey = KIND_LABEL[approval.kind] ?? "kindCustom";
  const reasonKey = REASON_LABEL[String(approval.payload.reason ?? "")];
  const edited = text !== originalText;

  return (
    <li className="surface rounded-2xl p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs text-amber-400">
          {t(kindKey)}
        </span>
        <span className="truncate text-sm font-medium text-foreground">
          {approval.agentName}
        </span>
        {reasonKey ? (
          <span className="text-xs text-muted-foreground">{t(reasonKey)}</span>
        ) : null}
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {compactAgo(approval.createdAt)}
          {approval.expiresAt
            ? ` · ${t("approvalExpires", { when: compactAgo(approval.expiresAt) })}`
            : ""}
        </span>
      </div>

      <p className="mt-3 text-sm text-foreground">{approval.summary}</p>

      {originalText ? (
        <div className="mt-3 space-y-2">
          <Label htmlFor={`approval-${approval.id}`} className="eyebrow">
            {t("kindSendMessage")}
          </Label>
          <Textarea
            id={`approval-${approval.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            disabled={!canDecide || pending}
          />
        </div>
      ) : (
        // No message body — show the raw action so approving is never a
        // blind click. A JSON blob is not pretty, but it is honest.
        <pre className="mt-3 overflow-x-auto rounded-xl bg-foreground/5 p-3 text-xs text-muted-foreground">
          {JSON.stringify(approval.payload, null, 2)}
        </pre>
      )}

      {canDecide ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("approvalNote")}
            maxLength={500}
            className="h-9 min-w-0 flex-1 sm:max-w-xs"
            disabled={pending}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => onDecide(approval, "reject", undefined, note)}
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" /> : <X />}
            {t("reject")}
          </Button>
          <Button
            type="button"
            onClick={() => onDecide(approval, "approve", text, note)}
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
            {edited ? t("approveEdited") : t("approve")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
