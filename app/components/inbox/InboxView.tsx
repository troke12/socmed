"use client";

import { useCallback, useEffect, useState } from "react";

interface Mention {
  id: number;
  accountId: number;
  platform: string;
  platformMentionId: string;
  authorHandle: string;
  authorName: string | null;
  text: string;
  url: string | null;
  mentionedAt: number;
  isRead: number;
  accountLabel: string | null;
  accountHandle: string | null;
}

interface Comment {
  id: number;
  postId: number;
  accountId: number;
  platform: string;
  platformCommentId: string;
  authorHandle: string;
  text: string;
  postedAt: number;
  isReplied: number;
  replyId: string | null;
  postCaption: string | null;
  postUrl: string | null;
  accountLabel: string | null;
}

type Tab = "mentions" | "comments";

export function InboxView() {
  const [tab, setTab] = useState<Tab>("mentions");
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
    alert("Reply queued");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTab("mentions")}
          className={`rounded-md px-3 py-1 text-sm ${tab === "mentions" ? "bg-primary text-primary-foreground" : "border border-border bg-background"}`}
        >
          Mentions {mentions && <span className="ml-1 text-xs opacity-70">({mentions.length})</span>}
        </button>
        <button
          onClick={() => setTab("comments")}
          className={`rounded-md px-3 py-1 text-sm ${tab === "comments" ? "bg-primary text-primary-foreground" : "border border-border bg-background"}`}
        >
          Comments {comments && <span className="ml-1 text-xs opacity-70">({comments.length})</span>}
        </button>
        {tab === "mentions" && (
          <button onClick={markAllRead} className="ml-auto text-xs text-muted-foreground hover:underline">
            Mark all read
          </button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {tab === "mentions" && (
        <ul className="space-y-2">
          {mentions === null && <p className="text-sm text-muted-foreground">Loading...</p>}
          {mentions && mentions.length === 0 && (
            <li className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No mentions yet. The poller checks every 10 min.
            </li>
          )}
          {mentions?.map((m) => (
            <Item
              key={m.id}
              header={
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{m.platform}</span>
                  <span className="text-muted-foreground">{m.accountLabel ?? m.accountHandle}</span>
                  <span>@{m.authorHandle}</span>
                  {m.isRead === 0 && <span className="rounded-full bg-blue-500 px-1.5 text-[10px] text-white">new</span>}
                </div>
              }
              body={m.text}
              link={m.url ?? undefined}
              time={m.mentionedAt}
              onReply={(text) => void reply("mention", m.id, text)}
            />
          ))}
        </ul>
      )}

      {tab === "comments" && (
        <ul className="space-y-2">
          {comments === null && <p className="text-sm text-muted-foreground">Loading...</p>}
          {comments && comments.length === 0 && (
            <li className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No comments yet. The poller runs on every analytics poll cycle.
            </li>
          )}
          {comments?.map((c) => (
            <Item
              key={c.id}
              header={
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{c.platform}</span>
                  <span className="text-muted-foreground">{c.accountLabel}</span>
                  <span>@{c.authorHandle}</span>
                  {c.isReplied === 1 && <span className="rounded-full bg-green-100 px-1.5 text-[10px] text-green-700">replied</span>}
                </div>
              }
              context={c.postCaption ?? undefined}
              body={c.text}
              link={c.postUrl ?? undefined}
              time={c.postedAt}
              onReply={c.isReplied ? undefined : (text) => void reply("comment", c.id, text)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Item({
  header, body, context, link, time, onReply,
}: {
  header: React.ReactNode;
  body: string;
  context?: string;
  link?: string;
  time: number;
  onReply?: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-border bg-card p-3 text-sm">
      {header}
      {context && (
        <p className="mt-1 text-xs text-muted-foreground">
          on: {context.length > 60 ? context.slice(0, 60) + "..." : context}
        </p>
      )}
      <p className="mt-2 whitespace-pre-wrap">{body}</p>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span>{new Date(time * 1000).toLocaleString()}</span>
        {link && <a className="text-blue-600 hover:underline" href={link} target="_blank" rel="noreferrer">view</a>}
        {onReply && (
          <button onClick={() => setOpen((o) => !o)} className="ml-auto text-blue-600 hover:underline">
            {open ? "cancel" : "reply"}
          </button>
        )}
      </div>
      {open && onReply && (
        <div className="mt-2 space-y-2">
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            placeholder="Write a reply..."
          />
          <button
            onClick={() => { onReply(text); setText(""); setOpen(false); }}
            disabled={!text.trim()}
            className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50"
          >
            Send
          </button>
        </div>
      )}
    </li>
  );
}
