"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, X, ExternalLink, Clock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getPlatform, type PlatformId } from "@/lib/platform-meta";

interface PendingPost {
  id: number;
  accountLabel: string | null;
  platform: string | null;
  status: string;
  caption: string;
  hashtags: string;
  linkUrl: string | null;
  scheduledFor: number | null;
  authorName: string | null;
  createdAt: number;
}

export function ReviewView({ approvalRequired }: { approvalRequired: boolean }) {
  const [posts, setPosts] = useState<PendingPost[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/posts?review=pending");
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "could not load the review queue");
      return;
    }
    setPosts(((await res.json()) as { posts: PendingPost[] }).posts);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function act(id: number, action: "approve" | "reject", extra: Record<string, unknown> = {}) {
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id, note: notes[id]?.trim() || undefined, ...extra }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "request failed");
        return;
      }
      setInfo(action === "approve" ? "Approved and queued ✓" : "Sent back to the author ✓");
      setNotes((n) => { const next = { ...n }; delete next[id]; return next; });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {!approvalRequired && (
        <div className="rounded-md border border-info-border/50 bg-info/10 px-3 py-2 text-sm">
          <strong>SOCMED_REQUIRE_APPROVAL is off.</strong> Editors can still submit posts here, but
          nothing forces them to — they can publish directly. Set it to <code>true</code> to make
          review mandatory for everyone below admin.
        </div>
      )}
      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {info && <div className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">{info}</div>}

      {posts === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {posts?.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing waiting for review.
          </CardContent>
        </Card>
      )}

      {posts?.map((p) => {
        const meta = p.platform ? getPlatform(p.platform as PlatformId) : undefined;
        return (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <span>#{p.id}</span>
                {meta && <Badge variant="secondary">{meta.name}</Badge>}
                <span className="text-sm font-normal text-muted-foreground">{p.accountLabel}</span>
                <a
                  href={`/compose?id=${p.id}`}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-primary underline"
                >
                  Open in Compose <ExternalLink className="h-3 w-3" />
                </a>
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>By {p.authorName ?? "unknown"}</span>
                <span>Submitted {new Date(p.createdAt * 1000).toLocaleString()}</span>
                {p.scheduledFor && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Wants {new Date(p.scheduledFor * 1000).toLocaleString()}
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">
                {p.caption || <span className="italic text-muted-foreground">No caption</span>}
                {p.hashtags && <div className="mt-1 text-link">{p.hashtags}</div>}
                {p.linkUrl && <div className="mt-1 text-xs text-muted-foreground">{p.linkUrl}</div>}
              </div>
              <Input
                value={notes[p.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                placeholder="Note for the author (required in spirit when rejecting)"
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => void act(p.id, "approve")}>
                  <Check className="h-4 w-4" />
                  {p.scheduledFor && p.scheduledFor > Math.floor(Date.now() / 1000)
                    ? "Approve & keep schedule"
                    : "Approve & publish now"}
                </Button>
                {p.scheduledFor && p.scheduledFor > Math.floor(Date.now() / 1000) && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(p.id, "approve", { publish: true })}>
                    Approve & publish now
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(p.id, "reject")}>
                  <X className="h-4 w-4" /> Send back
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
