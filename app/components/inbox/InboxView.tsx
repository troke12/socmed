"use client";

import { useCallback, useEffect, useState } from "react";
import { AtSign, MessageSquare, CheckCheck, Reply, ExternalLink } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { getPlatform } from "@/lib/platform-meta";

interface Mention {
  id: number;
  platform: string;
  authorHandle: string;
  authorName: string | null;
  text: string;
  url: string | null;
  mentionedAt: number;
  isRead: number;
  accountLabel: string | null;
}

interface Comment {
  id: number;
  platform: string;
  authorHandle: string;
  text: string;
  postedAt: number;
  isReplied: number;
  postCaption: string | null;
  postUrl: string | null;
  accountLabel: string | null;
}

export function InboxView() {
  const [mentions, setMentions] = useState<Mention[] | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [mRes, cRes] = await Promise.all([
      fetch("/api/inbox/mentions"),
      fetch("/api/inbox/comments"),
    ]);
    if (mRes.ok) setMentions((await mRes.json()).mentions);
    if (cRes.ok) setComments((await cRes.json()).comments);
    if (!mRes.ok || !cRes.ok) setError("failed to load inbox");
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const i = setInterval(refresh, 30_000);
    return () => clearInterval(i);
  }, [refresh]);

  async function markAllRead() {
    await fetch("/api/inbox/mentions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    await refresh();
  }

  async function reply(targetType: "mention" | "comment", targetId: number, text: string) {
    const res = await fetch("/api/inbox/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetType, targetId, text }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      alert(`Reply failed: ${j.error ?? "unknown"}`);
      return;
    }
    await refresh();
  }

  const unreadMentions = mentions?.filter((m) => m.isRead === 0).length ?? 0;
  const unrepliedComments = comments?.filter((c) => c.isReplied === 0).length ?? 0;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Tabs defaultValue="mentions">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="mentions" className="flex items-center gap-1.5">
              <AtSign className="h-3.5 w-3.5" /> Mentions
              {unreadMentions > 0 && (
                <Badge className="bg-primary text-white">{unreadMentions}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="comments" className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" /> Comments
              {unrepliedComments > 0 && (
                <Badge className="bg-primary text-white">{unrepliedComments}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="sm" onClick={markAllRead} className="text-muted-foreground">
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        </div>

        <TabsContent value="mentions" className="space-y-2">
          {mentions === null && <p className="text-sm text-muted-foreground">Loading...</p>}
          {mentions && mentions.length === 0 && (
            <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
              No mentions yet — the poller checks every 10 minutes.
            </div>
          )}
          {mentions?.map((m) => (
            <InboxItem
              key={m.id}
              platform={m.platform}
              label={m.accountLabel ?? ""}
              author={m.authorHandle}
              text={m.text}
              time={m.mentionedAt}
              url={m.url ?? undefined}
              isNew={m.isRead === 0}
              onReply={(text) => void reply("mention", m.id, text)}
            />
          ))}
        </TabsContent>

        <TabsContent value="comments" className="space-y-2">
          {comments === null && <p className="text-sm text-muted-foreground">Loading...</p>}
          {comments && comments.length === 0 && (
            <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
              No comments yet.
            </div>
          )}
          {comments?.map((c) => (
            <InboxItem
              key={c.id}
              platform={c.platform}
              label={c.accountLabel ?? ""}
              author={c.authorHandle}
              text={c.text}
              context={c.postCaption ?? undefined}
              time={c.postedAt}
              url={c.postUrl ?? undefined}
              isNew={c.isReplied === 0}
              replied={c.isReplied === 1}
              onReply={(text) => void reply("comment", c.id, text)}
            />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InboxItem({
  platform, label, author, text, context, time, url, isNew, replied, onReply,
}: {
  platform: string;
  label: string;
  author: string;
  text: string;
  context?: string;
  time: number;
  url?: string;
  isNew?: boolean;
  replied?: boolean;
  onReply: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const meta = getPlatform(platform);

  return (
    <div className={`rounded-md border bg-card p-4 ${isNew ? "border-info-border/50 bg-surface-soft" : "border-hairline"}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${meta?.bg ?? "bg-slate-500"}`}>
          {meta?.short ?? "?"}
        </span>
        <span className="font-medium text-ink">{meta?.name ?? platform}</span>
        <span>· {label}</span>
        {isNew && <Badge className="bg-info text-white">new</Badge>}
        {replied && <Badge variant="success">replied</Badge>}
        <span className="ml-auto">{new Date(time * 1000).toLocaleString()}</span>
      </div>
      {context && (
        <p className="mt-2 text-xs text-muted-foreground">
          on: {context.length > 60 ? context.slice(0, 60) + "…" : context}
        </p>
      )}
      <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
        <span className="font-medium">@{author}</span> — {text}
      </p>
      <div className="mt-2 flex items-center gap-2">
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-link hover:underline">
            <ExternalLink className="h-3 w-3" /> view
          </a>
        )}
        <Button variant="ghost" size="sm" className="ml-auto text-xs text-muted-foreground" onClick={() => setOpen((o) => !o)}>
          <Reply className="h-3.5 w-3.5" /> {open ? "cancel" : "reply"}
        </Button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <Textarea
            rows={2}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder={`Reply to @${author}...`}
          />
          <Button
            size="sm"
            disabled={!replyText.trim()}
            onClick={() => { onReply(replyText); setReplyText(""); setOpen(false); }}
          >
            Send reply
          </Button>
        </div>
      )}
    </div>
  );
}
