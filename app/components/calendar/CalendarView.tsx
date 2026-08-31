"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getPlatform } from "@/lib/platform-meta";

interface Post {
  id: number;
  platform: string | null;
  kind: string;
  status: "draft" | "scheduled" | "publishing" | "published" | "failed" | "archived";
  caption: string;
  scheduledFor: number | null;
  publishedAt: number | null;
  platformPostUrl: string | null;
  createdAt: number;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_VARIANT: Record<Post["status"], "secondary" | "default" | "success" | "destructive" | "outline"> = {
  draft: "secondary",
  scheduled: "default",
  publishing: "warning",
  published: "success",
  failed: "destructive",
  archived: "outline",
} as never;

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

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const i = setInterval(refresh, 15_000);
    return () => clearInterval(i);
  }, [refresh]);

  if (!posts) return <p className="text-sm text-muted-foreground">Loading...</p>;

  const first = startOfMonth(cursor);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
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
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>
            Today
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-hairline bg-hairline text-sm">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-surface-soft px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const key = fmtDay(d);
          const list = byDay.get(key) ?? [];
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = fmtDay(d) === fmtDay(new Date());
          return (
            <div
              key={key}
              className={`min-h-[104px] bg-canvas p-1 ${inMonth ? "" : "opacity-40"}`}
            >
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday ? "bg-primary font-medium text-white" : "text-muted-foreground"}`}>
                {d.getDate()}
              </div>
              <div className="mt-1 space-y-1">
                {list.slice(0, 3).map((p) => {
                  const meta = getPlatform(p.platform ?? "");
                  return (
                    <a
                      key={p.id}
                      href={p.platformPostUrl ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 rounded-sm bg-surface-soft px-1.5 py-1 text-xs hover:bg-muted"
                      title={p.caption}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta?.bg ?? "bg-slate-400"}`} />
                      <span className="truncate">{p.caption.slice(0, 30)}</span>
                    </a>
                  );
                })}
                {list.length > 3 && (
                  <div className="px-1 text-xs text-muted-foreground">+{list.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {(["draft", "scheduled", "publishing", "published", "failed"] as Post["status"][]).map((s) => (
          <Badge key={s} variant={STATUS_VARIANT[s]} className="capitalize">{s}</Badge>
        ))}
      </div>
    </div>
  );
}
