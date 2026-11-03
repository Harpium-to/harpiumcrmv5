"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Sparkles, Trash2, Upload, Wand2, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PillNav } from "@/components/ui/pill-nav";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { removeReplacedAvatar, removeUploadedAvatar } from "@/lib/storage/avatars";
import { useAuth } from "@/hooks/use-auth";
import { AGENT_ROLES } from "@/lib/agents/roles";
import { AGENT_TOOLS, AGENT_CHANNELS } from "@/lib/agents/tools";
import { AUTONOMY_LEVELS } from "@/lib/agents/autonomy";
import {
  AGENT_GOAL_METRICS,
  findGoalMetric,
  goalLabelKey,
} from "@/lib/agents/goals";
import type { Agent } from "@/lib/agents/types";
import { AGENT_ICONS, FALLBACK_AGENT_ICON, TOOL_ICONS } from "./agent-icon";
import { AgentFace } from "./agent-face";

// The `avatars` bucket caps size and mime type itself (migration 008),
// so these two are only here to turn a rejection into a sentence the
// operator can act on instead of a storage error code.
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

interface AgentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create mode. */
  agent: Agent | null;
  onSaved: (agent: Agent) => void;
  onDeleted: (id: string) => void;
}

interface FormState {
  name: string;
  role: string;
  department: string;
  avatarUrl: string;
  goals: Record<string, number>;
  objective: string;
  systemPrompt: string;
  keywords: string;
  model: string;
  priority: string;
  maxReplies: string;
  autonomy: number;
  tools: string[];
  channels: string[];
  workDays: number[];
  workStart: string;
  workEnd: string;
  timezone: string;
  isFallback: boolean;
  isActive: boolean;
}

const EMPTY: FormState = {
  name: "",
  role: "custom",
  department: "geral",
  avatarUrl: "",
  goals: {},
  objective: "",
  systemPrompt: "",
  keywords: "",
  model: "",
  priority: "10",
  maxReplies: "3",
  autonomy: 1,
  tools: [],
  channels: [],
  workDays: [1, 2, 3, 4, 5],
  workStart: "09:00",
  workEnd: "18:00",
  timezone: "America/Sao_Paulo",
  isFallback: false,
  isActive: false,
};

type Source = "factory" | "library" | "blank";
type Section = "basics" | "behavior" | "limits";

/**
 * Create or edit one agent.
 *
 * Creating offers three doors, in the order people actually want them:
 * describe it in a sentence and let the model draft it, pick a role
 * off the shelf, or start blank. All three land in the same reviewable
 * form — nothing an agent will be told is hidden behind a wizard,
 * because the prompt is the agent and an operator who never reads it
 * cannot know what they switched on.
 *
 * The form is sectioned rather than scrolled: identity, behaviour,
 * limits. The limits section is where the consequential settings live
 * (autonomy, tools, hours), and burying them under a long prompt
 * textarea is how they end up never being read.
 */
export function AgentForm({
  open,
  onOpenChange,
  agent,
  onSaved,
  onDeleted,
}: AgentFormProps) {
  const t = useTranslations("Agents");
  const { user } = useAuth();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [source, setSource] = useState<Source>("factory");
  const [section, setSection] = useState<Section>("basics");
  const [description, setDescription] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The picture is staged, not uploaded on pick: cancelling the dialog
  // then has nothing to clean up in storage.
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Reload whenever the dialog opens, so reopening after a cancel
  // never shows the abandoned edits of a previous session.
  useEffect(() => {
    if (!open) return;
    setSection("basics");
    setSource(agent ? "blank" : "factory");
    setDescription("");
    setPendingAvatar(null);
    setPreviewUrl(null);
    setForm(
      agent
        ? {
            name: agent.name,
            role: agent.role,
            department: agent.department,
            avatarUrl: agent.avatarUrl ?? "",
            goals: agent.goals,
            objective: agent.objective ?? "",
            systemPrompt: agent.systemPrompt,
            keywords: agent.keywords.join(", "),
            model: agent.model ?? "",
            priority: String(agent.priority),
            maxReplies: String(agent.maxRepliesPerConversation),
            autonomy: agent.autonomy,
            tools: agent.tools,
            channels: agent.channels,
            workDays: agent.workDays,
            workStart: agent.workStart.slice(0, 5),
            workEnd: agent.workEnd.slice(0, 5),
            timezone: agent.timezone,
            isFallback: agent.isFallback,
            isActive: agent.isActive,
          }
        : EMPTY,
    );
  }, [open, agent]);

  // Revoke the previous object URL whenever it is replaced or the
  // dialog goes away, so staging several pictures in one sitting
  // doesn't leak a blob per attempt.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function pickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so re-picking the same file still fires
    if (!file) return;
    if (!ALLOWED_AVATAR_MIME.has(file.type)) {
      toast.error(t("avatarUnsupported"));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(t("avatarTooLarge"));
      return;
    }
    setPendingAvatar(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function clearAvatar() {
    setPendingAvatar(null);
    setPreviewUrl(null);
    set("avatarUrl", "");
  }

  /**
   * Add or drop a target. Adding seeds the catalogue's suggested value
   * rather than an empty box: a goal of nothing is the same as no goal,
   * and it would save as one.
   */
  function toggleGoal(id: string) {
    setForm((prev) => {
      const next = { ...prev.goals };
      if (id in next) delete next[id];
      else next[id] = findGoalMetric(id)?.suggested ?? 1;
      return { ...prev, goals: next };
    });
  }

  function setGoal(id: string, raw: string) {
    const n = Number(raw);
    setForm((prev) => ({
      ...prev,
      goals: {
        ...prev.goals,
        [id]: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
      },
    }));
  }

  function toggleIn(key: "tools" | "channels", value: string) {
    setForm((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }));
  }

  function toggleDay(day: number) {
    setForm((prev) => ({
      ...prev,
      workDays: prev.workDays.includes(day)
        ? prev.workDays.filter((d) => d !== day)
        : [...prev.workDays, day].sort((a, b) => a - b),
    }));
  }

  function applyRole(id: string) {
    const role = AGENT_ROLES.find((r) => r.id === id);
    if (!role) return;
    setForm((prev) => ({
      ...prev,
      // Don't rename an agent the user already named — switching
      // templates to compare prompts shouldn't undo that.
      name: prev.name.trim() ? prev.name : t(role.labelKey),
      role: role.id,
      department: role.department,
      objective: t(role.objectiveKey),
      systemPrompt: role.systemPrompt,
      keywords: role.keywords.join(", "),
      priority: String(role.priority),
      autonomy: role.autonomy,
      tools: role.tools,
      channels: role.channels,
      goals: role.goals,
    }));
    setSection("basics");
  }

  async function handleDraft() {
    if (drafting || description.trim().length < 15) return;
    setDrafting(true);
    try {
      const res = await fetch("/api/agents/factory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "erro");
      const d = data.draft as {
        name: string;
        role: string;
        department: string;
        objective: string;
        systemPrompt: string;
        keywords: string[];
        tools: string[];
        channels: string[];
        autonomy: number;
        priority: number;
        goals: Record<string, number>;
      };
      setForm((prev) => ({
        ...prev,
        name: d.name,
        role: d.role,
        department: d.department,
        objective: d.objective,
        systemPrompt: d.systemPrompt,
        keywords: d.keywords.join(", "),
        tools: d.tools,
        channels: d.channels,
        autonomy: d.autonomy,
        priority: String(d.priority),
        goals: d.goals ?? {},
      }));
      toast.success(t("factoryDone"));
      setSource("blank");
      setSection("basics");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "erro");
    } finally {
      setDrafting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    let uploadedPath: string | null = null;
    try {
      let avatarUrl = form.avatarUrl.trim();
      if (pendingAvatar) {
        if (!user) throw new Error(t("avatarNoSession"));
        const ext = pendingAvatar.name.split(".").pop()?.toLowerCase() || "png";
        // The bucket's write policy keys on the first path segment
        // matching auth.uid() (migration 008), so an agent's picture
        // lives under the admin who uploaded it. Reads are public
        // bucket-wide, so the URL keeps working for the whole account —
        // and no new bucket or migration is needed for this to be the
        // right place to put it.
        const path = `${user.id}/agent-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, pendingAvatar, {
            cacheControl: "3600",
            upsert: true,
            contentType: pendingAvatar.type,
          });
        if (uploadError) throw new Error(uploadError.message);
        uploadedPath = path;
        avatarUrl = supabase.storage.from("avatars").getPublicUrl(path).data
          .publicUrl;
      }

      const payload = {
        name: form.name,
        role: form.role,
        department: form.department,
        avatar_url: avatarUrl,
        goals: form.goals,
        objective: form.objective,
        system_prompt: form.systemPrompt,
        keywords: form.keywords,
        model: form.model,
        priority: Number(form.priority),
        max_replies_per_conversation: Number(form.maxReplies),
        autonomy: form.autonomy,
        tools: form.tools,
        channels: form.channels,
        work_days: form.workDays,
        work_start: form.workStart,
        work_end: form.workEnd,
        timezone: form.timezone,
        is_fallback: form.isFallback,
        is_active: form.isActive,
      };
      const res = await fetch(
        agent ? `/api/agents/${agent.id}` : "/api/agents",
        {
          method: agent ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "erro");
      uploadedPath = null;
      if (agent) {
        // A duplicated agent shares the file; the helper checks for that.
        void removeReplacedAvatar(
          supabase,
          agent.avatarUrl,
          (data.agent as Agent).avatarUrl,
          { agentId: agent.id },
        );
      }
      toast.success(t("saved"));
      onSaved(data.agent as Agent);
      onOpenChange(false);
    } catch (err) {
      // Uploaded, then the save failed: nothing references the file.
      if (uploadedPath) void removeUploadedAvatar(supabase, uploadedPath);
      toast.error(err instanceof Error ? err.message : "erro");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!agent || deleting) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "erro");
      // The row is gone (a hard delete), so its picture goes too —
      // unless a duplicate of this agent still shows it.
      void removeReplacedAvatar(supabase, agent.avatarUrl, null, { agentId: agent.id });
      toast.success(t("deleted"));
      onDeleted(agent.id);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "erro");
    } finally {
      setDeleting(false);
    }
  }

  const showDoors = !agent;

  // Catalogue metrics first, in catalogue order, then anything the
  // factory invented. An unlisted key still gets a row — dropping it
  // would silently delete a target the operator can see stored on the
  // agent, and `goalLabelKey` returns null precisely so this can
  // render the raw key instead of crashing on a missing message.
  const goalRows: Array<{ id: string; labelKey: string | null }> = [
    ...AGENT_GOAL_METRICS.filter((m) => m.id in form.goals).map((m) => ({
      id: m.id,
      labelKey: m.labelKey,
    })),
    ...Object.keys(form.goals)
      .filter((id) => !findGoalMetric(id))
      .map((id) => ({ id, labelKey: goalLabelKey(id) })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-popover sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {agent ? agent.name : t("newAgent")}
          </DialogTitle>
          {showDoors ? (
            <DialogDescription className="text-muted-foreground">
              {t("createFromPreset")}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {showDoors ? (
          <PillNav
            items={[
              { value: "factory", label: t("factoryTab"), icon: Wand2 },
              { value: "library", label: t("libraryTab"), icon: Sparkles },
              { value: "blank", label: t("blankTab") },
            ]}
            value={source}
            onChange={(v) => setSource(v as Source)}
            className="self-start"
          />
        ) : null}

        {showDoors && source === "factory" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("factoryHint")}</p>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder={t("factoryPlaceholder")}
            />
            <Button
              type="button"
              onClick={handleDraft}
              disabled={drafting || description.trim().length < 15}
            >
              {drafting ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {drafting ? t("factoryGenerating") : t("factoryGenerate")}
            </Button>
          </div>
        ) : null}

        {showDoors && source === "library" ? (
          <div className="space-y-5">
            {(["outbound", "inbound"] as const).map((track) => (
              <div key={track} className="space-y-2">
                <p className="eyebrow">
                  {t(track === "outbound" ? "trackOutbound" : "trackInbound")}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {AGENT_ROLES.filter((r) => r.track === track).map((role) => {
                    const Icon =
                      AGENT_ICONS[role.id] ?? FALLBACK_AGENT_ICON;
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => applyRole(role.id)}
                        className="surface flex items-start gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-foreground/8"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground/8 text-muted-foreground">
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">
                            {t(role.labelKey)}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {t(role.objectiveKey)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {!showDoors || source === "blank" || form.name ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            <PillNav
              items={[
                { value: "basics", label: t("tabBasics") },
                { value: "behavior", label: t("tabBehavior") },
                { value: "limits", label: t("tabLimits") },
              ]}
              value={section}
              onChange={(v) => setSection(v as Section)}
              className="self-start"
            />

            {section === "basics" ? (
              <div className="space-y-5">
                {/* The picture is the first thing on the form because
                    it is the first thing on every card, the operation
                    floor and the network view — and because an agent
                    with a face is one an operator refers to by name
                    when something goes wrong. */}
                <div className="flex items-center gap-4">
                  <AgentFace
                    agent={{
                      name: form.name,
                      role: form.role,
                      department: form.department,
                      avatarUrl: previewUrl ?? (form.avatarUrl || null),
                    }}
                    className="size-16 bg-foreground/8 text-muted-foreground"
                    iconClassName="size-7"
                  />
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={pickAvatar}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload />
                        {t("avatarUpload")}
                      </Button>
                      {previewUrl || form.avatarUrl ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={clearAvatar}
                        >
                          {t("avatarRemove")}
                        </Button>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("avatarHint")}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="agent-name">{t("formName")}</Label>
                    <Input
                      id="agent-name"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      maxLength={80}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="agent-department">
                      {t("formDepartment")}
                    </Label>
                    <Input
                      id="agent-department"
                      value={form.department}
                      onChange={(e) => set("department", e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agent-objective">{t("formObjective")}</Label>
                  <Input
                    id="agent-objective"
                    value={form.objective}
                    onChange={(e) => set("objective", e.target.value)}
                    maxLength={200}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("formObjectiveHint")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agent-prompt">{t("formPrompt")}</Label>
                  <Textarea
                    id="agent-prompt"
                    value={form.systemPrompt}
                    onChange={(e) => set("systemPrompt", e.target.value)}
                    rows={12}
                    required
                    className="font-mono text-xs leading-relaxed"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("formPromptHint")}
                  </p>
                </div>
              </div>
            ) : null}

            {section === "behavior" ? (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="agent-keywords">{t("formKeywords")}</Label>
                  <Input
                    id="agent-keywords"
                    value={form.keywords}
                    onChange={(e) => set("keywords", e.target.value)}
                    placeholder="preço, comprar, orçamento"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("formKeywordsHint")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>{t("formChannels")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {AGENT_CHANNELS.map((channel) => (
                      <button
                        key={channel}
                        type="button"
                        data-active={form.channels.includes(channel)}
                        onClick={() => toggleIn("channels", channel)}
                        className="chip"
                      >
                        {t(
                          `channel${channel.charAt(0).toUpperCase()}${channel.slice(1)}`,
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("formChannelsHint")}
                  </p>
                </div>

                {/* Targets. The chips pick which metrics this agent is
                    measured on; the rows carry the numbers. Two steps
                    rather than nine always-visible inputs, because an
                    agent normally has one or two targets and a grid of
                    empty boxes reads as work left undone. */}
                <div className="space-y-3 rounded-2xl bg-foreground/5 p-4">
                  <Label>{t("formGoals")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {AGENT_GOAL_METRICS.map((metric) => (
                      <button
                        key={metric.id}
                        type="button"
                        data-active={metric.id in form.goals}
                        onClick={() => toggleGoal(metric.id)}
                        className="chip"
                      >
                        {t(metric.labelKey)}
                      </button>
                    ))}
                  </div>

                  {goalRows.length > 0 ? (
                    <ul className="space-y-2">
                      {goalRows.map((row) => (
                        <li key={row.id} className="flex items-center gap-3">
                          <Label
                            htmlFor={`agent-goal-${row.id}`}
                            className="min-w-0 flex-1 truncate font-normal text-muted-foreground"
                          >
                            {row.labelKey ? t(row.labelKey) : row.id}
                          </Label>
                          <Input
                            id={`agent-goal-${row.id}`}
                            type="number"
                            min={0}
                            max={100000}
                            value={String(form.goals[row.id] ?? 0)}
                            onChange={(e) => setGoal(row.id, e.target.value)}
                            className="w-24 text-right tabular-nums"
                          />
                          {row.labelKey ? null : (
                            <button
                              type="button"
                              onClick={() => toggleGoal(row.id)}
                              aria-label={t("goalRemove")}
                              className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/8"
                            >
                              <X className="size-3.5" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <p className="text-xs text-muted-foreground">
                    {t("formGoalsHint")}
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="agent-priority">{t("formPriority")}</Label>
                    <Input
                      id="agent-priority"
                      type="number"
                      min={0}
                      max={100}
                      value={form.priority}
                      onChange={(e) => set("priority", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="agent-max">{t("formMaxReplies")}</Label>
                    <Input
                      id="agent-max"
                      type="number"
                      min={1}
                      max={20}
                      value={form.maxReplies}
                      onChange={(e) => set("maxReplies", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="agent-model">{t("formModel")}</Label>
                    <Input
                      id="agent-model"
                      value={form.model}
                      onChange={(e) => set("model", e.target.value)}
                      placeholder="—"
                    />
                  </div>
                </div>
                <p className="-mt-3 text-xs text-muted-foreground">
                  {t("formPriorityHint")} {t("formModelHint")}
                </p>
              </div>
            ) : null}

            {section === "limits" ? (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label>{t("autonomy")}</Label>
                  <div className="grid gap-2">
                    {AUTONOMY_LEVELS.map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => set("autonomy", level)}
                        className={cn(
                          "flex items-start gap-3 rounded-2xl p-3 text-left transition-colors",
                          form.autonomy === level
                            ? "surface-on"
                            : "surface hover:bg-foreground/8",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                            form.autonomy === level
                              ? "bg-primary-foreground/15"
                              : "bg-foreground/8 text-muted-foreground",
                          )}
                        >
                          {level}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            {t(`autonomy${level}`)}
                          </span>
                          <span
                            className={cn(
                              "block text-xs",
                              form.autonomy === level
                                ? "text-primary-foreground/70"
                                : "text-muted-foreground",
                            )}
                          >
                            {t(`autonomy${level}Desc`)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("autonomyNote")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>{t("formTools")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {AGENT_TOOLS.map((tool) => {
                      const Icon = TOOL_ICONS[tool.id] ?? FALLBACK_AGENT_ICON;
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          data-active={form.tools.includes(tool.id)}
                          onClick={() => toggleIn("tools", tool.id)}
                          title={t(tool.descriptionKey)}
                          className="chip"
                        >
                          <Icon className="size-4" />
                          {t(tool.labelKey)}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("formToolsHint")}
                  </p>
                </div>

                <div className="space-y-3 rounded-2xl bg-foreground/5 p-4">
                  <Label>{t("formWorkDays")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                      <button
                        key={day}
                        type="button"
                        data-active={form.workDays.includes(day)}
                        onClick={() => toggleDay(day)}
                        className="chip px-3"
                      >
                        {t(`day${day}`)}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="agent-start">{t("formWorkHours")}</Label>
                      <Input
                        id="agent-start"
                        type="time"
                        value={form.workStart}
                        onChange={(e) => set("workStart", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="agent-end" className="opacity-0">
                        {t("formWorkHours")}
                      </Label>
                      <Input
                        id="agent-end"
                        type="time"
                        value={form.workEnd}
                        onChange={(e) => set("workEnd", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="agent-tz">{t("formTimezone")}</Label>
                      <Input
                        id="agent-tz"
                        value={form.timezone}
                        onChange={(e) => set("timezone", e.target.value)}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("formWorkHint")}
                  </p>
                </div>

                <div className="space-y-3 rounded-2xl bg-foreground/5 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <Label htmlFor="agent-fallback">
                        {t("formFallback")}
                      </Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("formFallbackHint")}
                      </p>
                    </div>
                    <Switch
                      id="agent-fallback"
                      checked={form.isFallback}
                      onCheckedChange={(v) => set("isFallback", v)}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="agent-active">{t("enabled")}</Label>
                    <Switch
                      id="agent-active"
                      checked={form.isActive}
                      onCheckedChange={(v) => set("isActive", v)}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              {agent ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  {t("delete")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                className="ml-auto"
                onClick={() => onOpenChange(false)}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : null}
                {t("save")}
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
