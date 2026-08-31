"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Video, Send, CalendarClock, Save, X, CheckCircle2 } from "lucide-react";
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
import { getPlatform } from "@/lib/platform-meta";

interface Account {
  id: number;
  platform: string;
  label: string;
  handle: string;
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
      const active = j.accounts.filter((a) => a.status === "active");
      setAccounts(active);
      if (!accountId && active[0]) setAccountId(active[0].id);
    }
  }, [accountId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const kind = media.length === 0 ? "text" : media.length > 1 ? "carousel" : media[0]!.kind === "image" ? "image" : "video";
  const selectedPlatform = accounts?.find((a) => a.id === accountId)?.platform;
  const platformMeta = selectedPlatform ? getPlatform(selectedPlatform) : undefined;
  const charCount = caption.length + (hashtags ? hashtags.length + 2 : 0);

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
    setBusy(true); setError(null); setInfo(null);
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
        const pub = await fetch("/api/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "publish_now", id: j.id }),
        });
        if (!pub.ok) {
          const jj = (await pub.json().catch(() => ({}))) as { error?: string };
          setError(jj.error ?? "publish failed");
          return;
        }
        setInfo("Post queued for publishing ✓");
      } else if (action === "schedule") {
        setInfo("Post scheduled ✓");
      } else {
        setInfo("Draft saved ✓");
      }
      setCaption(""); setHashtags(""); setLinkUrl(""); setMedia([]); setScheduledFor("");
    } finally {
      setBusy(false);
    }
  }

  if (accounts === null) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* Editor */}
      <div className="space-y-4 lg:col-span-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New post</CardTitle>
            <CardDescription>Write once, publish to any connected platform.</CardDescription>
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
                <span className={`text-xs ${charCount > 2200 ? "text-destructive" : "text-muted-foreground"}`}>
                  {charCount} chars
                </span>
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

            {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            {info && <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700"><CheckCircle2 className="h-4 w-4" />{info}</div>}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void onSubmit("draft")}>
                <Save className="h-4 w-4" /> Save draft
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
                      <img src={`/api/media?path=${encodeURIComponent(m.path)}`} alt="" className="h-24 w-full object-cover" />
                    ) : (
                      <video src={`/api/media?path=${encodeURIComponent(m.path)}`} className="h-24 w-full object-cover" muted />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => setMedia((arr) => arr.filter((x) => x.id !== m.id))}
                        className="rounded-full bg-red-600 p-1 text-white"
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

        {/* Post preview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
            <CardDescription>
              {platformMeta ? `Will publish to ${platformMeta.name}` : "Pick an account to preview"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {platformMeta ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${platformMeta.bg}`}>
                    {platformMeta.short}
                  </div>
                  <div className="text-sm">
                    <div className="font-medium">{platformMeta.name}</div>
                    <div className="text-xs text-muted-foreground">{accounts?.find((a) => a.id === accountId)?.label}</div>
                  </div>
                </div>
                <div className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">
                  {caption || <span className="text-muted-foreground italic">No caption yet…</span>}
                  {hashtags && <div className="mt-1 text-blue-600">{hashtags}</div>}
                </div>
                {media[0] && (
                  <img src={`/api/media?path=${encodeURIComponent(media[0].path)}`} alt="" className="max-h-40 w-full rounded-md object-cover" />
                )}
                <Badge variant="secondary">{kind}</Badge>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Select an account to see the preview.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
