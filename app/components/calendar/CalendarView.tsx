"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Pencil, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getPlatform, type PlatformId } from "@/lib/platform-meta";
import { rescheduleTo, isMovable } from "@/lib/calendar/reschedule";

interface Post {
  id: number;
  accountId: number;
  accountLabel: string | null;
  platform: string | null;
  kind: string;
  status: "draft" | "scheduled" | "publishing" | "published" | "failed" | "archived";
  caption: string;
  scheduledFor: number | null;
  publishedAt: number | null;
  platformPostUrl: string | null;
  reviewStatus: "none" | "pending" | "approved" | "rejected";
  createdAt: number;
}

interface Account {
  id: number;
  platform: string;
  label: string;
}

type View = "month" | "week";

const STATUSES: Post["status"][] = ["draft", "scheduled", "publishing", "published", "failed"];

const STATUS_VARIANT: Record<Post["status"], "secondary" | "default" | "success" | "destructive" | "outline" | "warning"> = {
  draft: "secondary",
  scheduled: "default",
  publishing: "warning",
  published: "success",
  failed: "destructive",
  archived: "outline",
};

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - out.getDay());
  return out;
}

function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** When a post lands on the calendar: its schedule, else publish time, else creation. */
function anchorOf(p: Post): number {
  return p.scheduledFor ?? p.publishedAt ?? p.createdAt;
}

export function CalendarView() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cursor, setCursor] = useState<Date>(startOfMonth(new Date()));
  const [view, setView] = useState<View>("month");
  const [accountFilter, setAccountFilter] = useState<number[]>([]);
  const [statusFilter, setStatusFilter] = useState<Post["status"][]>([]);
  const [selected, setSelected] = useState<Post | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Polling would otherwise yank a post back mid-drag or clobber an optimistic move.
  const suspendPolling = useRef(false);

  const refresh = useCallback(async () => {
    if (suspendPolling.current) return;
    const [postsRes, accRes] = await Promise.all([fetch("/api/posts"), fetch("/api/accounts")]);
    if (postsRes.ok) setPosts(((await postsRes.json()) as { posts: Post[] }).posts);
    if (accRes.ok) setAccounts(((await accRes.json()) as { accounts: Account[] }).accounts);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const i = setInterval(() => { void refresh(); }, 15_000);
    return () => clearInterval(i);
  }, [refresh]);

  const days = useMemo(() => {
    const start = view === "month"
      ? (() => { const s = startOfMonth(cursor); s.setDate(s.getDate() - s.getDay()); return s; })()
      : startOfWeek(cursor);
    const count = view === "month" ? 42 : 7;
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor, view]);

  const visible = useMemo(() => {
    if (!posts) return [];
    return posts.filter((p) => {
      if (accountFilter.length > 0 && !accountFilter.includes(p.accountId)) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(p.status)) return false;
      return true;
    });
  }, [posts, accountFilter, statusFilter]);

  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of visible) {
      const key = fmtDay(new Date(anchorOf(p) * 1000));
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => anchorOf(a) - anchorOf(b));
    return map;
  }, [visible]);

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError(null);
    suspendPolling.current = true;
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "request failed");
        return false;
      }
      return true;
    } finally {
      suspendPolling.current = false;
      setBusy(false);
      await refresh();
    }
  }

  async function moveTo(post: Post, day: Date): Promise<void> {
    const result = rescheduleTo(post.scheduledFor, {
      year: day.getFullYear(),
      month: day.getMonth(),
      date: day.getDate(),
    });
    if (!result.ok) {
      setError(result.reason ?? "could not reschedule");
      return;
    }
    await send({ action: "update", id: post.id, scheduledFor: result.scheduledFor });
  }

  function toggle<T>(list: T[], value: T, set: (v: T[]) => void): void {
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

  if (!posts) return <p className="text-sm text-muted-foreground">Loading...</p>;

  const title = view === "month"
    ? cursor.toLocaleString("default", { month: "long", year: "numeric" })
    : (() => {
        const s = startOfWeek(cursor);
        const e = new Date(s);
        e.setDate(s.getDate() + 6);
        return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
      })();

  function step(dir: -1 | 1): void {
    setCursor((c) =>
      view === "month"
        ? new Date(c.getFullYear(), c.getMonth() + dir, 1)
        : (() => { const n = new Date(c); n.setDate(c.getDate() + dir * 7); return n; })(),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">{title}</h2>
        <div className="flex items-center gap-1">
          <div className="mr-2 flex overflow-hidden rounded-md border">
            {(["month", "week"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setView(v); setCursor(v === "month" ? startOfMonth(cursor) : startOfWeek(cursor)); }}
                className={`px-2.5 py-1 text-xs capitalize ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
              >
                {v}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(view === "month" ? startOfMonth(new Date()) : startOfWeek(new Date()))}>
            Today
          </Button>
          <Button variant="ghost" size="icon" onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {accounts.map((a) => {
          const meta = getPlatform(a.platform as PlatformId);
          const on = accountFilter.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => toggle(accountFilter, a.id, setAccountFilter)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                on ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta?.bg ?? "bg-muted-foreground"}`} />
              {a.label}
            </button>
          );
        })}
        <span className="mx-1 h-4 w-px bg-hairline" />
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => toggle(statusFilter, s, setStatusFilter)}
            className={`rounded-full border px-2.5 py-1 text-xs capitalize transition-colors ${
              statusFilter.includes(s) ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            {s}
          </button>
        ))}
        {(accountFilter.length > 0 || statusFilter.length > 0) && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => { setAccountFilter([]); setStatusFilter([]); }}
          >
            Clear
          </button>
        )}
      </div>

      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <div className={`grid gap-px overflow-hidden rounded-md border border-hairline bg-hairline text-sm ${view === "month" ? "grid-cols-7" : "grid-cols-7"}`}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-surface-soft px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const key = fmtDay(d);
          const list = byDay.get(key) ?? [];
          const inMonth = view === "week" || d.getMonth() === cursor.getMonth();
          const isToday = key === fmtDay(new Date());
          return (
            <div
              key={key}
              onDragOver={(e) => { if (dragId !== null) { e.preventDefault(); setDropDay(key); } }}
              onDragLeave={() => setDropDay((cur) => (cur === key ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                setDropDay(null);
                const post = posts.find((p) => p.id === dragId);
                setDragId(null);
                if (post) void moveTo(post, d);
              }}
              className={`bg-canvas p-1 transition-colors ${view === "month" ? "min-h-[104px]" : "min-h-[280px]"} ${
                inMonth ? "" : "opacity-40"
              } ${dropDay === key ? "ring-2 ring-inset ring-primary" : ""}`}
            >
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday ? "bg-primary font-medium text-white" : "text-muted-foreground"}`}>
                {d.getDate()}
              </div>
              <div className="mt-1 space-y-1">
                {(view === "month" ? list.slice(0, 3) : list).map((p) => {
                  const meta = getPlatform(p.platform ?? "");
                  const movable = isMovable(p.status);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      draggable={movable}
                      onDragStart={() => setDragId(p.id)}
                      onDragEnd={() => { setDragId(null); setDropDay(null); }}
                      onClick={() => setSelected(p)}
                      className={`flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-xs hover:bg-muted ${
                        selected?.id === p.id ? "bg-muted ring-1 ring-primary" : "bg-surface-soft"
                      } ${movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
                        dragId === p.id ? "opacity-40" : ""
                      }`}
                      title={p.caption}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta?.bg ?? "bg-muted-foreground"}`} />
                      <span className="truncate">{p.caption.slice(0, 30) || "(no caption)"}</span>
                    </button>
                  );
                })}
                {view === "month" && list.length > 3 && (
                  <button
                    type="button"
                    className="px-1 text-xs text-muted-foreground underline"
                    onClick={() => { setView("week"); setCursor(startOfWeek(d)); }}
                  >
                    +{list.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[selected.status]} className="capitalize">{selected.status}</Badge>
            {selected.reviewStatus !== "none" && (
              <Badge variant="outline" className="capitalize">review: {selected.reviewStatus}</Badge>
            )}
            <span className="text-sm text-muted-foreground">
              #{selected.id} · {selected.accountLabel ?? "unknown account"}
              {selected.scheduledFor ? ` · ${new Date(selected.scheduledFor * 1000).toLocaleString()}` : ""}
            </span>
            <button type="button" className="ml-auto text-muted-foreground" onClick={() => setSelected(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm">
            {selected.caption || <span className="italic text-muted-foreground">No caption</span>}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {selected.status !== "published" && (
              <Button size="sm" variant="outline" asChild>
                <a href={`/compose?id=${selected.id}`}><Pencil className="h-4 w-4" /> Edit</a>
              </Button>
            )}
            {selected.platformPostUrl && (
              <Button size="sm" variant="outline" asChild>
                <a href={selected.platformPostUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" /> View live
                </a>
              </Button>
            )}
            {isMovable(selected.status) && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  if (await send({ action: "publish_now", id: selected.id })) setSelected(null);
                }}
              >
                <Send className="h-4 w-4" /> Publish now
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (await send({ action: "delete", id: selected.id })) setSelected(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <Badge key={s} variant={STATUS_VARIANT[s]} className="capitalize">{s}</Badge>
        ))}
        <span className="text-xs text-muted-foreground">
          Drag a draft, scheduled or failed post to another day to reschedule it. Published posts stay put.
        </span>
      </div>
    </div>
  );
}
