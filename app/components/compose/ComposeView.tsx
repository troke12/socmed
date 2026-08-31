"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Account {
  id: number;
  platform: "tiktok" | "linkedin" | "instagram" | "x";
  handle: string;
  displayName: string | null;
  status: "active" | "revoked" | "expired";
}

interface MediaItem {
  id: number;
  path: string;
  kind: "image" | "video";
  mime: string;
  width: number | null;
  height: number | null;
}

export function ComposeView() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [scheduledFor, setScheduledFor] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/accounts");
    if (res.ok) {
      const j = (await res.json()) as { accounts: Account[] };
      setAccounts(j.accounts);
      if (!accountId && j.accounts[0]) setAccountId(j.accounts[0].id);
    }
  }, [accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const kind = media.length === 0 ? "text" : media.length > 1 ? "carousel" : media[0]!.kind === "image" ? "image" : "video";

  async function onUpload(file: File) {
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/media/upload", { method: "POST", body: fd });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "upload failed");
      return;
    }
    const j = (await res.json()) as { media: MediaItem };
    setMedia((m) => [...m, j.media]);
  }

  async function onSubmit(action: "draft" | "schedule" | "publish") {
    if (!accountId) {
      setError("pick an account first");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const scheduledTs = scheduledFor ? Math.floor(new Date(scheduledFor).getTime() / 1000) : null;
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          kind,
          caption,
          hashtags,
          linkUrl: linkUrl || null,
          mediaIds: media.map((m) => m.id),
          scheduledFor: action === "schedule" ? scheduledTs : null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "create failed");
        return;
      }
      const j = (await res.json()) as { id: number; status: string };
      if (action === "publish") {
        const pub = await fetch(`/api/posts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "publish_now", id: j.id }),
        });
        if (!pub.ok) {
          const jj = (await pub.json().catch(() => ({}))) as { error?: string };
          setError(jj.error ?? "publish failed");
          return;
        }
        setInfo("Post queued for publishing");
      } else if (action === "schedule") {
        setInfo("Post scheduled");
      } else {
        setInfo("Draft saved");
      }
      setCaption("");
      setHashtags("");
      setLinkUrl("");
      setMedia([]);
      setScheduledFor("");
    } finally {
      setBusy(false);
    }
  }

  if (accounts === null) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (accounts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No accounts yet. Add one on the <a className="underline" href="/accounts">Accounts page</a> first.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="account">Account</label>
          <select
            id="account"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={accountId ?? ""}
            onChange={(e) => setAccountId(Number(e.target.value))}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.platform} · {a.handle}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="caption">Caption</label>
          <textarea
            id="caption"
            rows={6}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Write something..."
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="hashtags">Hashtags</label>
          <input
            id="hashtags"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="#tag1 #tag2"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="link">Link (optional)</label>
          <input
            id="link"
            type="url"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="sched">Schedule (optional)</label>
          <input
            id="sched"
            type="datetime-local"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {info && <p className="text-sm text-green-600">{info}</p>}
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => onSubmit("draft")}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            disabled={busy || !scheduledFor}
            onClick={() => onSubmit("schedule")}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Schedule
          </button>
          <button
            disabled={busy}
            onClick={() => onSubmit("publish")}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Publish now
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Media</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
            multiple
            onChange={(e) => {
              const files = e.target.files;
              if (!files) return;
              for (const f of Array.from(files)) void onUpload(f);
              e.target.value = "";
            }}
            className="block w-full text-sm"
          />
        </div>
        <ul className="space-y-2">
          {media.map((m, i) => (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded-md border border-border bg-card p-2 text-sm"
            >
              {m.kind === "image" ? (
                <img
                  src={`/api/media?path=${encodeURIComponent(m.path)}`}
                  alt=""
                  className="h-12 w-12 rounded object-cover"
                />
              ) : (
                <video
                  src={`/api/media?path=${encodeURIComponent(m.path)}`}
                  className="h-12 w-12 rounded object-cover"
                  muted
                />
              )}
              <div className="flex-1">
                <div className="font-medium">{m.kind} #{i + 1}</div>
                <div className="text-xs text-muted-foreground">
                  {m.width && m.height ? `${m.width}×${m.height}` : ""} · {m.mime}
                </div>
              </div>
              <button
                onClick={() => setMedia((arr) => arr.filter((x) => x.id !== m.id))}
                className="text-xs text-destructive hover:underline"
              >
                remove
              </button>
            </li>
          ))}
          {media.length === 0 && (
            <li className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No media. Upload images or videos above.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
