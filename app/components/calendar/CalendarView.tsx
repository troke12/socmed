"use client";

import { useCallback, useEffect, useState } from "react";

interface Post {
  id: number;
  accountId: number;
  accountHandle: string | null;
  platform: "tiktok" | "linkedin" | "instagram" | "x" | null;
  kind: string;
  status: "draft" | "scheduled" | "publishing" | "published" | "failed" | "archived";
  caption: string;
  hashtags: string;
  linkUrl: string | null;
  scheduledFor: number | null;
  publishedAt: number | null;
  platformPostUrl: string | null;
  error: string | null;
  createdAt: number;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_COLOR: Record<Post["status"], string> = {
  draft: "bg-slate-200 text-slate-800",
  scheduled: "bg-blue-100 text-blue-800",
  publishing: "bg-amber-100 text-amber-800",
  published: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  archived: "bg-slate-100 text-slate-500",
};

export function CalendarView() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [cursor, setCursor] = useState<Date>(startOfMonth(new Date()));

  const refresh = useCallback(async () => {
    const res = await fetch("/api/posts");
    if (res.ok) {
      const j = (await res.json()) as { posts: Post[] };
      setPosts(j.posts);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const i = setInterval(refresh, 15_000);
    return () => clearInterval(i);
  }, [refresh]);

  if (!posts) return <p className="text-sm text-muted-foreground">Loading...</p>;

  // Build a 6-week grid (42 days) starting from the Sunday of the week containing the 1st
  const first = startOfMonth(cursor);
  const startWeekday = first.getDay();
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startWeekday);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }

  const byDay = new Map<string, Post[]>();
  for (const p of posts) {
    const ts = p.scheduledFor ?? p.publishedAt ?? p.createdAt;
    const key = fmtDay(new Date(ts * 1000));
    const list = byDay.get(key) ?? [];
    list.push(p);
    byDay.set(key, list);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">
          {cursor.toLocaleString("default", { month: "long", year: "numeric" })}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm hover:bg-accent"
          >
            ←
          </button>
          <button
            onClick={() => setCursor(startOfMonth(new Date()))}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm hover:bg-accent"
          >
            Today
          </button>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm hover:bg-accent"
          >
            →
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-sm">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-muted px-2 py-1 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const key = fmtDay(d);
          const list = byDay.get(key) ?? [];
          const inMonth = d.getMonth() === cursor.getMonth();
          return (
            <div
              key={key}
              className={`min-h-[100px] bg-background p-1 ${inMonth ? "" : "opacity-50"}`}
            >
              <div className="text-xs text-muted-foreground">{d.getDate()}</div>
              <div className="mt-1 space-y-1">
                {list.slice(0, 3).map((p) => (
                  <a
                    key={p.id}
                    href={p.platformPostUrl ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className={`block truncate rounded px-1 text-xs ${STATUS_COLOR[p.status]}`}
                    title={p.caption}
                  >
                    {p.platform ?? "?"} · {p.caption.slice(0, 40)}
                  </a>
                ))}
                {list.length > 3 && (
                  <div className="text-xs text-muted-foreground">+{list.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
