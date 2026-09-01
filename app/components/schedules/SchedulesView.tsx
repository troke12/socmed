"use client";

import { useCallback, useEffect, useState } from "react";
import { Repeat, Trash2, Play, Pause, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getPlatform, type PlatformId } from "@/lib/platform-meta";
import { describeCron, isValidCron, nextCronRun } from "@/lib/schedule/cron";

interface Account {
  id: number;
  platform: string;
  label: string;
  handle: string;
  status: "active" | "revoked" | "expired";
}

interface PostOption {
  id: number;
  accountId: number;
  caption: string;
  status: string;
}

interface Rule {
  id: number;
  accountId: number;
  accountLabel: string | null;
  platform: string | null;
  name: string;
  cronExpr: string;
  timezone: string;
  templatePostId: number | null;
  templateCaption: string | null;
  enabled: number;
  nextRunAt: number;
  lastRunAt: number | null;
}

// Starting points that cover the overwhelming majority of evergreen schedules.
// The expression stays editable — this is a shortcut, not a constraint.
const PRESETS = [
  { label: "Every day at 09:00", expr: "0 9 * * *" },
  { label: "Every Monday at 09:00", expr: "0 9 * * 1" },
  { label: "Weekdays at 12:00", expr: "0 12 * * 1-5" },
  { label: "1st of the month at 09:00", expr: "0 9 1 * *" },
  { label: "Every 6 hours", expr: "0 */6 * * *" },
];

function fmt(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

export function SchedulesView() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [postOptions, setPostOptions] = useState<PostOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [templatePostId, setTemplatePostId] = useState<number | null>(null);
  const [cronExpr, setCronExpr] = useState("0 9 * * 1");
  // Default to the browser's zone rather than UTC: a rule authored as "09:00"
  // almost always means 09:00 where the person creating it lives.
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );

  const refresh = useCallback(async () => {
    const [rulesRes, accRes, postsRes] = await Promise.all([
      fetch("/api/schedules"),
      fetch("/api/accounts"),
      fetch("/api/posts"),
    ]);
    if (rulesRes.ok) setRules(((await rulesRes.json()) as { rules: Rule[] }).rules);
    if (accRes.ok) {
      const active = ((await accRes.json()) as { accounts: Account[] }).accounts.filter(
        (a) => a.status === "active",
      );
      setAccounts(active);
      setAccountId((cur) => cur ?? active[0]?.id ?? null);
    }
    if (postsRes.ok) {
      setPostOptions(((await postsRes.json()) as { posts: PostOption[] }).posts);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const cronOk = isValidCron(cronExpr);
  let preview: string | null = null;
  if (cronOk) {
    try {
      preview = new Date(nextCronRun(cronExpr, timezone, Math.floor(Date.now() / 1000)) * 1000).toLocaleString();
    } catch {
      preview = null;
    }
  }

  // Only the selected account's posts can act as a template — cloning a post
  // from another account would publish it to the wrong place.
  const templateChoices = postOptions.filter((p) => p.accountId === accountId);

  async function post(body: Record<string, unknown>, okMsg: string) {
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "request failed");
        return;
      }
      setInfo(okMsg);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    if (!accountId) { setError("pick an account first"); return; }
    if (!name.trim()) { setError("give the rule a name"); return; }
    if (!cronOk) { setError("cron expression is not valid"); return; }
    await post(
      { accountId, name: name.trim(), cronExpr, timezone, templatePostId, enabled: true },
      "rule created",
    );
    setName("");
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
          {info}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" />
            New recurring schedule
          </CardTitle>
          <CardDescription>
            Re-publishes a template post on a repeating schedule. Each run creates a fresh
            post, so metrics stay separate per occurrence.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rule-name">Name</Label>
              <Input
                id="rule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Monday evergreen"
              />
            </div>
            <div className="space-y-2">
              <Label>Account</Label>
              <Select
                value={accountId ? String(accountId) : undefined}
                onValueChange={(v) => { setAccountId(Number(v)); setTemplatePostId(null); }}
              >
                <SelectTrigger><SelectValue placeholder="Pick an account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {getPlatform(a.platform as PlatformId)?.name ?? a.platform} · {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Template post</Label>
            <Select
              value={templatePostId ? String(templatePostId) : undefined}
              onValueChange={(v) => setTemplatePostId(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder={templateChoices.length ? "Pick a post to repeat" : "No posts on this account yet"} />
              </SelectTrigger>
              <SelectContent>
                {templateChoices.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    #{p.id} · {p.caption.slice(0, 60) || "(no caption)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cron">Schedule (cron)</Label>
              <Input
                id="cron"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                placeholder="0 9 * * 1"
                className={cronOk ? undefined : "border-destructive"}
              />
              <p className="text-xs text-muted-foreground">
                {cronOk ? describeCron(cronExpr) : "Not a valid 5-field cron expression."}
              </p>
              <div className="flex flex-wrap gap-1 pt-1">
                {PRESETS.map((p) => (
                  <button
                    key={p.expr}
                    type="button"
                    onClick={() => setCronExpr(p.expr)}
                    className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tz">Timezone</Label>
              <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
              <p className="text-xs text-muted-foreground">
                Next run: {preview ?? "—"}
              </p>
            </div>
          </div>

          <Button onClick={() => void onCreate()} disabled={busy}>
            <Repeat className="mr-2 h-4 w-4" />
            Create rule
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active rules</CardTitle>
        </CardHeader>
        <CardContent>
          {rules === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {rules?.length === 0 && (
            <p className="text-sm text-muted-foreground">No recurring schedules yet.</p>
          )}
          <div className="space-y-3">
            {rules?.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{r.name}</span>
                    <Badge variant={r.enabled ? "default" : "secondary"}>
                      {r.enabled ? "enabled" : "paused"}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.accountLabel ?? "unknown account"} · <code>{r.cronExpr}</code> ({r.timezone})
                    {" · "}
                    {isValidCron(r.cronExpr) ? describeCron(r.cronExpr) : "invalid expression"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Next {fmt(r.enabled ? r.nextRunAt : null)} · Last {fmt(r.lastRunAt)}
                    {r.templateCaption ? ` · repeats "${r.templateCaption.slice(0, 40)}"` : " · no template"}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void post({ action: "update", id: r.id, enabled: !r.enabled }, r.enabled ? "rule paused" : "rule enabled")}
                  >
                    {r.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void post({ action: "run_now", id: r.id }, "queued one run")}
                  >
                    Run now
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void post({ action: "delete", id: r.id }, "rule deleted")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
