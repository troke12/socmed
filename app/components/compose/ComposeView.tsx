"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ImagePlus, Video, Send, CalendarClock, Save, X, CheckCircle2, Pencil, Library, ClipboardCheck, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { getPlatform, type PlatformId } from "@/lib/platform-meta";
import { countComposeText, validateComposeMedia, getContentRules } from "@/lib/platforms/content-rules";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { MediaGrid, type LibraryItem } from "@/components/media/MediaGrid";
import { nextOccurrence, WEEKDAY_NAMES, type Slot } from "@/lib/analytics/best-time";
import { supportsFirstComment } from "@/lib/platforms/capabilities";
import { TONES, type Tone, type Suggestion } from "@/lib/ai/shapes";

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
  const [accountIds, setAccountIds] = useState<number[]>([]);
  const [postId, setPostId] = useState<number | null>(null);
  const [loadingPost, setLoadingPost] = useState(false);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [campaign, setCampaign] = useState("");
  const [firstComment, setFirstComment] = useState("");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [scheduledFor, setScheduledFor] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [role, setRole] = useState<"admin" | "editor" | "viewer" | null>(null);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<"none" | "pending" | "approved" | "rejected">("none");
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  const [bestTimes, setBestTimes] = useState<{ slots: Slot[]; sampleSize: number; confident: boolean } | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [tone, setTone] = useState<Tone>("keep");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/accounts");
    if (res.ok) {
      const j = (await res.json()) as { accounts: Account[] };
      const active = j.accounts.filter((a) => a.status === "active");
      setAccounts(active);
      setAccountIds((cur) => (cur.length > 0 || !active[0] ? cur : [active[0].id]));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return;
      const j = (await res.json()) as {
        user: { role: "admin" | "editor" | "viewer" } | null;
        approvalRequired?: boolean;
      };
      setRole(j.user?.role ?? null);
      setApprovalRequired(j.approvalRequired ?? false);
    })();
  }, []);

  // Suggestions are per selected account when exactly one is picked; mixing
  // accounts would average away the per-audience differences that make the
  // recommendation worth anything.
  useEffect(() => {
    const params = new URLSearchParams({
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    if (accountIds.length === 1) params.set("accountId", String(accountIds[0]));
    void (async () => {
      const res = await fetch(`/api/analytics/best-time?${params.toString()}`);
      if (!res.ok) { setBestTimes(null); return; }
      setBestTimes((await res.json()) as { slots: Slot[]; sampleSize: number; confident: boolean });
    })();
  }, [accountIds]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/ai/suggest");
      if (!res.ok) return;
      setAiEnabled(((await res.json()) as { enabled: boolean }).enabled);
    })();
  }, []);

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
            hashtags: string; linkUrl: string | null; campaign: string | null;
            firstComment: string | null; scheduledFor: number | null;
            reviewStatus: "none" | "pending" | "approved" | "rejected";
            reviewNote: string | null;
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
        setAccountIds([j.post.accountId]);
        setCaption(j.post.caption);
        setHashtags(j.post.hashtags);
        setLinkUrl(j.post.linkUrl ?? "");
        setCampaign(j.post.campaign ?? "");
        setFirstComment(j.post.firstComment ?? "");
        setMedia(j.media);
        setScheduledFor(j.post.scheduledFor ? toLocalInput(j.post.scheduledFor) : "");
        setReviewStatus(j.post.reviewStatus);
        setReviewNote(j.post.reviewNote);
      } finally {
        if (!cancelled) setLoadingPost(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editId]);

  const kind = media.length === 0 ? "text" : media.length > 1 ? "carousel" : media[0]!.kind === "image" ? "image" : "video";
  const selectedAccounts = (accounts ?? []).filter((a) => accountIds.includes(a.id));
  const selectedPlatforms = Array.from(
    new Set(selectedAccounts.map((a) => a.platform as PlatformId)),
  );
  const mediaKinds = media.map((m) => ({ kind: m.kind }));

  // With several targets the caption has to satisfy the strictest of them, so
  // the counter shows the platform closest to (or furthest past) its limit
  // rather than an arbitrary one.
  const counts = selectedPlatforms.map((p) => ({
    platform: p,
    result: countComposeText(p, { caption, hashtags, linkUrl }),
  }));
  const tightest = counts.length
    ? counts.reduce((worst, c) => {
        if (c.result.overBy !== worst.result.overBy) {
          return c.result.overBy > worst.result.overBy ? c : worst;
        }
        const remaining = (r: typeof c.result) => (r.limit ? r.limit - r.count : Number.MAX_SAFE_INTEGER);
        return remaining(c.result) < remaining(worst.result) ? c : worst;
      })
    : null;
  const selectedCount = tightest?.result ?? null;
  const platformMeta = tightest ? getPlatform(tightest.platform) : undefined;

  // Named up front so the warning below the field can be honest about which of
  // the selected targets will silently skip it.
  const unsupportedFirstComment = selectedPlatforms
    .filter((p) => !supportsFirstComment(p))
    .map((p) => getPlatform(p)?.name ?? p);

  function toggleAccount(id: number): void {
    // Editing targets exactly one existing row, so selection stays single there.
    if (postId) { setAccountIds([id]); return; }
    setAccountIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

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

  // Library items carry extra fields (usage count, poster) that the composer
  // does not need; narrow to the MediaItem shape the rest of the form uses.
  function toggleLibraryItem(item: LibraryItem): void {
    setMedia((cur) => {
      if (cur.some((m) => m.id === item.id)) return cur.filter((m) => m.id !== item.id);
      return [...cur, {
        id: item.id,
        path: item.path,
        kind: item.kind,
        mime: item.mime,
        width: item.width,
        height: item.height,
      }];
    });
  }

  // With approval on, an editor's only route to publication is the review queue.
  const gated = approvalRequired && role !== null && role !== "admin";

  async function onReviewSubmit(): Promise<void> {
    if (!postId) { setError("save the post first, then submit it for review"); return; }
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "submit_review", id: postId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "could not submit for review");
        return;
      }
      setReviewStatus("pending");
      setReviewNote(null);
      setInfo("Submitted for review ✓");
    } finally {
      setBusy(false);
    }
  }

  async function onSuggest(): Promise<void> {
    setAiBusy(true); setAiError(null); setSuggestion(null);
    try {
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          caption,
          hashtags,
          linkUrl: linkUrl || null,
          // Suggestions are written against the selected platforms' limits, so
          // the target list has to travel with the request.
          platforms: selectedPlatforms,
          tone,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as Suggestion & { error?: string };
      if (!res.ok) { setAiError(j.error ?? "suggestion failed"); return; }
      setSuggestion(j);
    } finally {
      setAiBusy(false);
    }
  }

  async function onSubmit(action: "draft" | "schedule" | "publish") {
    if (accountIds.length === 0) { setError("pick at least one account first"); return; }
    // Drafts can stay over-limit while still being edited; publishing or
    // scheduling must respect every target platform's rules, since each one
    // will eventually hit its real API.
    if (action !== "draft") {
      const blockers: string[] = [];
      for (const platform of selectedPlatforms) {
        const name = getPlatform(platform)?.name ?? platform;
        const count = countComposeText(platform, { caption, hashtags, linkUrl });
        if (count.overBy > 0) {
          blockers.push(`${name}: caption is ${count.overBy} ${count.unit} over the limit.`);
        }
        const mediaCheck = validateComposeMedia(platform, mediaKinds);
        if (!mediaCheck.ok) blockers.push(`${name}: ${mediaCheck.issues.join(" ")}`);
      }
      if (blockers.length > 0) {
        setError(`${blockers.join(" ")} Trim it, deselect that account, or save as a draft instead.`);
        return;
      }
    }
    setBusy(true); setError(null); setInfo(null);
    try {
      const scheduledTs = scheduledFor ? Math.floor(new Date(scheduledFor).getTime() / 1000) : null;
      const fields = {
        accountIds,
        kind,
        caption,
        hashtags,
        linkUrl: linkUrl || null,
        campaign: campaign.trim() || null,
        firstComment: firstComment.trim() || null,
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
      // Create returns one id per target; update only returns { ok: true }.
      const j = (await res.json()) as { ids?: number[] };
      const savedIds = postId ? [postId] : j.ids ?? [];
      if (savedIds.length === 0) {
        setError("server did not return a post id");
        return;
      }
      if (action === "publish") {
        // One publish call per target. They are issued in sequence so a failure
        // reports which account it belongs to instead of a bare rejection.
        const failures: string[] = [];
        for (const id of savedIds) {
          const pub = await fetch("/api/posts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "publish_now", id }),
          });
          if (!pub.ok) {
            const jj = (await pub.json().catch(() => ({}))) as { error?: string };
            failures.push(`#${id}: ${jj.error ?? "publish failed"}`);
          }
        }
        if (failures.length > 0) {
          setError(
            failures.length === savedIds.length
              ? `Publish failed — ${failures.join("; ")}`
              : `Queued ${savedIds.length - failures.length} of ${savedIds.length}. Failed — ${failures.join("; ")}`,
          );
          return;
        }
        setInfo(savedIds.length > 1 ? `Queued for ${savedIds.length} accounts ✓` : "Post queued for publishing ✓");
      } else if (action === "schedule") {
        setInfo(postId ? "Schedule updated ✓" : `Scheduled for ${savedIds.length} account${savedIds.length > 1 ? "s" : ""} ✓`);
      } else {
        setInfo(postId ? "Changes saved ✓" : `Draft saved for ${savedIds.length} account${savedIds.length > 1 ? "s" : ""} ✓`);
      }
      // Clearing is right after creating a post, but destructive when editing —
      // the fields still reflect the row that was just saved.
      if (!postId) {
        setCaption(""); setHashtags(""); setLinkUrl(""); setCampaign("");
        setFirstComment(""); setMedia([]); setScheduledFor("");
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
              <div className="flex items-center justify-between">
                <Label>{postId ? "Account" : "Accounts"}</Label>
                {!postId && accounts.length > 1 && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                    onClick={() =>
                      setAccountIds(accountIds.length === accounts.length ? [] : accounts.map((a) => a.id))
                    }
                  >
                    {accountIds.length === accounts.length ? "Clear all" : "Select all"}
                  </button>
                )}
              </div>
              {accounts.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No active accounts.{" "}
                  <a href="/accounts" className="text-primary underline">Connect one first →</a>
                </div>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {accounts.map((a) => {
                    const meta = getPlatform(a.platform as PlatformId);
                    const on = accountIds.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleAccount(a.id)}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                          on ? "border-primary bg-primary/10" : "hover:bg-accent"
                        }`}
                      >
                        {meta && <FontAwesomeIcon icon={meta.icon} className="h-3.5 w-3.5 shrink-0" />}
                        <span className="min-w-0 flex-1 truncate">{a.label}</span>
                        {on && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}
              {!postId && accountIds.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  Creates {accountIds.length} separate posts — one per account — so each keeps its own
                  metrics and platform post URL.
                </p>
              )}
              {postId && (
                <p className="text-xs text-muted-foreground">
                  Editing one existing post, so only a single account applies here.
                </p>
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

            {aiEnabled && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="mr-auto flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" /> Suggestions
                  </Label>
                  <select
                    className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                    value={tone}
                    onChange={(e) => setTone(e.target.value as Tone)}
                  >
                    {TONES.map((t) => (
                      <option key={t} value={t}>{t === "keep" ? "keep my tone" : t}</option>
                    ))}
                  </select>
                  <Button size="sm" variant="outline" disabled={aiBusy} onClick={() => void onSuggest()}>
                    {aiBusy ? "Thinking…" : "Suggest"}
                  </Button>
                </div>

                {aiError && <p className="text-xs text-destructive">{aiError}</p>}

                {suggestion && (
                  <div className="space-y-2">
                    {suggestion.notes && <p className="text-xs text-muted-foreground">{suggestion.notes}</p>}
                    {suggestion.captions.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setCaption(c)}
                        className="block w-full rounded-md border p-2 text-left text-sm transition-colors hover:bg-accent"
                        title="Click to use this caption"
                      >
                        {c}
                      </button>
                    ))}
                    {suggestion.hashtags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        {suggestion.hashtags.map((h) => (
                          <button
                            key={h}
                            type="button"
                            onClick={() =>
                              setHashtags((cur) => (cur.includes(`#${h}`) ? cur : `${cur} #${h}`.trim()))
                            }
                            className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          >
                            #{h}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="ml-1 text-xs text-muted-foreground underline"
                          onClick={() => setHashtags(suggestion.hashtags.map((h) => `#${h}`).join(" "))}
                        >
                          use all
                        </button>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Nothing is applied until you click it. Check the facts — the model rewrites
                      wording, it does not verify claims.
                    </p>
                  </div>
                )}
              </div>
            )}

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
              {linkUrl && (
                <>
                  <Input
                    id="campaign"
                    placeholder="Campaign name for utm_campaign (optional)"
                    value={campaign}
                    onChange={(e) => setCampaign(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    UTM parameters are added per platform when the post publishes, so each
                    target reports its own utm_source. Parameters already on your link are
                    left alone.
                  </p>
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="first-comment">First comment (optional)</Label>
              <Textarea
                id="first-comment"
                rows={2}
                placeholder="Posted right after publishing — where Instagram hashtags usually go"
                value={firstComment}
                onChange={(e) => setFirstComment(e.target.value)}
                className="resize-none"
              />
              {firstComment.trim() && unsupportedFirstComment.length > 0 && (
                <p className="text-xs text-destructive">
                  {unsupportedFirstComment.join(", ")} cannot post comments through this app yet, so
                  the first comment will be skipped there. The post itself still publishes.
                </p>
              )}
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
              {bestTimes && bestTimes.slots.length > 0 && (
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-1">
                    {bestTimes.slots.map((slot) => (
                      <button
                        key={`${slot.weekday}-${slot.hour}`}
                        type="button"
                        onClick={() => setScheduledFor(toLocalInput(Math.floor(nextOccurrence(slot).getTime() / 1000)))}
                        className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        title={`${slot.postCount} post${slot.postCount === 1 ? "" : "s"} · ${(slot.avgEngagementRate * 100).toFixed(1)}% avg engagement`}
                      >
                        {WEEKDAY_NAMES[slot.weekday]?.slice(0, 3)} {String(slot.hour).padStart(2, "0")}:00
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {bestTimes.confident
                      ? `Your best-performing slots across ${bestTimes.sampleSize} published posts.`
                      : `Based on only ${bestTimes.sampleSize} published post${bestTimes.sampleSize === 1 ? "" : "s"} — treat as an observation, not a recommendation.`}
                  </p>
                </div>
              )}
            </div>

            {reviewStatus === "rejected" && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                <strong className="text-destructive">Sent back for changes.</strong>{" "}
                {reviewNote ? reviewNote : "No note was left — ask the reviewer what they want changed."}
              </div>
            )}
            {reviewStatus === "pending" && (
              <div className="rounded-md border border-info-border/50 bg-info/10 px-3 py-2 text-sm">
                Awaiting review. Editing the caption or media keeps it in the queue.
              </div>
            )}
            {reviewStatus === "approved" && (
              <div className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
                Approved{gated ? " — editing the content sends it back for review." : "."}
              </div>
            )}

            {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            {info && <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" />{info}</div>}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void onSubmit("draft")}>
                <Save className="h-4 w-4" /> {postId ? "Save changes" : "Save draft"}
              </Button>
              <Button variant="outline" size="sm" disabled={busy || !scheduledFor} onClick={() => void onSubmit("schedule")}>
                <CalendarClock className="h-4 w-4" /> Schedule
              </Button>
              {gated ? (
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={busy || !postId || reviewStatus === "pending"}
                  title={postId ? undefined : "Save the post first"}
                  onClick={() => void onReviewSubmit()}
                >
                  <ClipboardCheck className="h-4 w-4" />
                  {reviewStatus === "pending" ? "Awaiting review" : "Submit for review"}
                </Button>
              ) : (
                <Button size="sm" className="ml-auto" disabled={busy || accountIds.length === 0} onClick={() => void onSubmit("publish")}>
                  <Send className="h-4 w-4" /> Publish now
                </Button>
              )}
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
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <ImagePlus className="h-4 w-4" /> Upload
              </Button>
              <Button
                variant={showLibrary ? "default" : "outline"}
                onClick={() => setShowLibrary((v) => !v)}
              >
                <Library className="h-4 w-4" /> Library
              </Button>
            </div>

            {showLibrary && (
              <div className="rounded-md border p-2">
                <MediaGrid
                  compact
                  selectedIds={media.map((m) => m.id)}
                  onToggle={toggleLibraryItem}
                  emptyHint="Nothing uploaded yet — use Upload above and it lands here for reuse."
                />
              </div>
            )}

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
                isTarget={selectedPlatforms.includes(platformId)}
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
