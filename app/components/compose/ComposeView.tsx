"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ImagePlus, Video, Send, CalendarClock, Save, X, CheckCircle2, Pencil } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { countComposeText, validateComposeMedia, getContentRules } from "@/lib/platforms/content-rules";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

interface Account {
  id: number;
  platform: string;
  label: string;
  handle: string;
  status: "active" | "revoked" | "expired";
}

// datetime-local wants local wall-clock fields, so toISOString() (always UTC)
// would shift a stored schedule by the viewer's offset.
function toLocalInput(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const searchParams = useSearchParams();
  const editId = Number(searchParams.get("id")) || null;

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [postId, setPostId] = useState<number | null>(null);
  const [loadingPost, setLoadingPost] = useState(false);
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
      const active = j.accounts.filter((a) => a.status === "active");
      setAccounts(active);
      if (!accountId && active[0]) setAccountId(active[0].id);
    }
  }, [accountId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    setLoadingPost(true);
    void (async () => {
      try {
        const res = await fetch(`/api/posts?id=${editId}`);
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          if (!cancelled) setError(j.error ?? "could not load post");
          return;
        }
        const j = (await res.json()) as {
          post: {
            id: number; accountId: number; status: string; caption: string;
            hashtags: string; linkUrl: string | null; scheduledFor: number | null;
          };
          media: MediaItem[];
        };
        if (cancelled) return;
        // A published post is immutable server-side (/api/posts returns 409), so
        // load it read-only rather than letting someone edit into a dead end.
        if (j.post.status === "published") {
          setError("This post is already published and can no longer be edited.");
          return;
        }
        setPostId(j.post.id);
        setAccountId(j.post.accountId);
        setCaption(j.post.caption);
        setHashtags(j.post.hashtags);
        setLinkUrl(j.post.linkUrl ?? "");
        setMedia(j.media);
        setScheduledFor(j.post.scheduledFor ? toLocalInput(j.post.scheduledFor) : "");
      } finally {
        if (!cancelled) setLoadingPost(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editId]);

  const kind = media.length === 0 ? "text" : media.length > 1 ? "carousel" : media[0]!.kind === "image" ? "image" : "video";
  const selectedPlatform = accounts?.find((a) => a.id === accountId)?.platform as PlatformId | undefined;
  const platformMeta = selectedPlatform ? getPlatform(selectedPlatform) : undefined;
  const mediaKinds = media.map((m) => ({ kind: m.kind }));
  const selectedCount = selectedPlatform ? countComposeText(selectedPlatform, { caption, hashtags, linkUrl }) : null;

  // One preview card per unique platform among the connected accounts —
  // "write once, publish to any platform" needs to show how the same
  // caption behaves everywhere, not just on whichever account is selected.
  const previewPlatforms = accounts
    ? Array.from(new Set(accounts.map((a) => a.platform))) as PlatformId[]
    : [];

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
    if (!accountId) { setError("pick an account first"); return; }
    // Drafts can stay over-limit while still being edited; publishing or
    // scheduling must respect the target platform's rules since both will
    // eventually hit the real API.
    if (action !== "draft" && selectedPlatform && selectedCount) {
      const mediaCheck = validateComposeMedia(selectedPlatform, mediaKinds);
      if (selectedCount.overBy > 0) {
        setError(`Caption is ${selectedCount.overBy} ${selectedCount.unit} over ${platformMeta?.name}'s limit — trim it or save as a draft instead.`);
        return;
      }
      if (!mediaCheck.ok) {
        setError(mediaCheck.issues.join(" "));
        return;
      }
    }
    setBusy(true); setError(null); setInfo(null);
    try {
      const scheduledTs = scheduledFor ? Math.floor(new Date(scheduledFor).getTime() / 1000) : null;
      const fields = {
        accountId,
        kind,
        caption,
        hashtags,
        linkUrl: linkUrl || null,
        mediaIds: media.map((m) => m.id),
        scheduledFor: action === "schedule" ? scheduledTs : null,
      };
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(postId ? { action: "update", id: postId, ...fields } : fields),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? (postId ? "update failed" : "create failed"));
        return;
      }
      // Create returns the new id; update only returns { ok: true }.
      const j = (await res.json()) as { id?: number };
      const savedId = postId ?? j.id;
      if (savedId === undefined) {
        setError("server did not return a post id");
        return;
      }
      if (action === "publish") {
        const pub = await fetch("/api/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "publish_now", id: savedId }),
        });
        if (!pub.ok) {
          const jj = (await pub.json().catch(() => ({}))) as { error?: string };
          setError(jj.error ?? "publish failed");
          return;
        }
        setInfo("Post queued for publishing ✓");
      } else if (action === "schedule") {
        setInfo(postId ? "Schedule updated ✓" : "Post scheduled ✓");
      } else {
        setInfo(postId ? "Changes saved ✓" : "Draft saved ✓");
      }
      // Clearing is right after creating a post, but destructive when editing —
      // the fields still reflect the row that was just saved.
      if (!postId) {
        setCaption(""); setHashtags(""); setLinkUrl(""); setMedia([]); setScheduledFor("");
      }
    } finally {
      setBusy(false);
    }
  }

  if (accounts === null || loadingPost) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* Editor */}
      <div className="space-y-4 lg:col-span-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {postId ? <Pencil className="h-4 w-4" /> : null}
              {postId ? `Edit post #${postId}` : "New post"}
            </CardTitle>
            <CardDescription>
              {postId
                ? "Changes replace the saved draft — the schedule is re-queued if you change it."
                : "Write once, publish to any connected platform."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Account</Label>
              {accounts.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No active accounts.{" "}
                  <a href="/accounts" className="text-primary underline">Connect one first →</a>
                </div>
              ) : (
                <Select value={accountId ? String(accountId) : undefined} onValueChange={(v) => setAccountId(Number(v))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {getPlatform(a.platform)?.name ?? a.platform} · {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="caption">Caption</Label>
                {selectedCount ? (
                  <span className={`text-xs ${selectedCount.overBy > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {selectedCount.count}
                    {selectedCount.limit ? ` / ${selectedCount.limit}` : ""} {selectedCount.unit}
                    {selectedCount.overBy > 0 ? ` — ${selectedCount.overBy} over limit for ${platformMeta?.name}` : ""}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{caption.length} chars</span>
                )}
              </div>
              <Textarea
                id="caption"
                rows={6}
                placeholder="What's happening?"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hashtags">Hashtags</Label>
              <Input
                id="hashtags"
                placeholder="#growth #marketing"
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="link">Link (optional)</Label>
              <Input
                id="link"
                type="url"
                placeholder="https://..."
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sched">Schedule (optional)</Label>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="sched"
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
              </div>
            </div>

            {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            {info && <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" />{info}</div>}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void onSubmit("draft")}>
                <Save className="h-4 w-4" /> {postId ? "Save changes" : "Save draft"}
              </Button>
              <Button variant="outline" size="sm" disabled={busy || !scheduledFor} onClick={() => void onSubmit("schedule")}>
                <CalendarClock className="h-4 w-4" /> Schedule
              </Button>
              <Button size="sm" className="ml-auto" disabled={busy || !accountId} onClick={() => void onSubmit("publish")}>
                <Send className="h-4 w-4" /> Publish now
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Media + preview */}
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Media</CardTitle>
            <CardDescription>Images &amp; videos — up to 10 per post.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (!files) return;
                for (const f of Array.from(files)) void onUpload(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
              <ImagePlus className="h-4 w-4" /> Add media
            </Button>

            {media.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-muted-foreground">
                <Video className="h-6 w-6" />
                <span className="text-xs">No media yet</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {media.map((m, i) => (
                  <div key={m.id} className="group relative overflow-hidden rounded-md border">
                    {m.kind === "image" ? (
                      // Media is served from /api/media behind a session cookie —
                      // next/image optimization doesn't apply to authenticated media.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/media?path=${encodeURIComponent(m.path)}`} alt="" className="h-24 w-full object-cover" />
                    ) : (
                      <video src={`/api/media?path=${encodeURIComponent(m.path)}`} className="h-24 w-full object-cover" muted />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => setMedia((arr) => arr.filter((x) => x.id !== m.id))}
                        className="rounded-full bg-destructive p-1 text-white"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {i === 0 && media.length > 1 && (
                      <Badge className="absolute left-1 top-1 bg-primary text-[10px]">1st</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-platform preview — same caption/media, each platform's own rules */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
            <CardDescription>
              {previewPlatforms.length > 0
                ? "How this post behaves on each connected platform"
                : "Connect an account to see a preview"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {previewPlatforms.length === 0 && (
              <p className="text-sm text-muted-foreground">No connected accounts yet.</p>
            )}
            {previewPlatforms.map((platformId) => (
              <PlatformPreview
                key={platformId}
                platformId={platformId}
                caption={caption}
                hashtags={hashtags}
                linkUrl={linkUrl}
                media={media}
                isTarget={platformId === selectedPlatform}
              />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PlatformPreview({
  platformId, caption, hashtags, linkUrl, media, isTarget,
}: {
  platformId: PlatformId;
  caption: string;
  hashtags: string;
  linkUrl: string;
  media: MediaItem[];
  isTarget: boolean;
}) {
  const meta = getPlatform(platformId);
  if (!meta) return null;
  const rules = getContentRules(platformId);
  const count = countComposeText(platformId, { caption, hashtags, linkUrl });
  const mediaCheck = validateComposeMedia(platformId, media.map((m) => ({ kind: m.kind })));
  const hasIssue = count.overBy > 0 || !mediaCheck.ok;

  return (
    <div className={`overflow-hidden rounded-md border ${isTarget ? "border-info-border/60" : "border-hairline"}`}>
      <div className={`flex items-center gap-2 px-3 py-2 ${meta.bg} ${meta.text}`}>
        <FontAwesomeIcon icon={meta.icon} className="h-3.5 w-3.5" />
        <span className="text-sm font-medium">{meta.name}</span>
        {isTarget && <Badge className="ml-auto bg-white/20 text-[10px] text-white">selected</Badge>}
      </div>
      <div className="space-y-2 p-3">
        <div className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">
          {caption || <span className="text-muted-foreground italic">No caption yet…</span>}
          {hashtags && <div className="mt-1 text-link">{hashtags}</div>}
        </div>
        {media[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/media?path=${encodeURIComponent(media[0].path)}`} alt="" className="max-h-28 w-full rounded-md object-cover" />
        )}
        <div className="flex items-center justify-between text-xs">
          <span className={count.overBy > 0 ? "font-medium text-destructive" : "text-muted-foreground"}>
            {count.count}
            {count.limit ? ` / ${count.limit}` : ""} {count.unit}
            {count.overBy > 0 ? ` — will be cut/rejected (${count.overBy} over)` : rules.textLimit ? ` (${rules.textLimit - count.count} left)` : ""}
          </span>
          {rules.confidence !== "official" && (
            <span className="text-muted-foreground" title={rules.notes.join(" ")}>
              ⓘ {rules.confidence}
            </span>
          )}
        </div>
        {mediaCheck.issues.map((issue) => (
          <div key={issue} className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{issue}</div>
        ))}
        {!hasIssue && rules.notes.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">platform rules</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {rules.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
