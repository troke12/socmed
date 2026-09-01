"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, ImageIcon, Film, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export interface LibraryItem {
  id: number;
  path: string;
  kind: "image" | "video";
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  posterPath: string | null;
  altText: string | null;
  createdAt: number;
  usageCount: number;
}

type KindFilter = "all" | "image" | "video";

export function mediaSrc(path: string): string {
  return `/api/media?path=${encodeURIComponent(path)}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Shared browser for previously uploaded assets. Used both as the standalone
 * Media Library page and as the "pick from library" panel inside Compose, so
 * selection is driven entirely by the caller.
 */
export function MediaGrid({
  selectedIds,
  onToggle,
  onLoaded,
  emptyHint,
  compact = false,
}: {
  selectedIds?: number[];
  onToggle?: (item: LibraryItem) => void;
  onLoaded?: (items: LibraryItem[]) => void;
  emptyHint?: string;
  compact?: boolean;
}) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query: string, kindFilter: KindFilter) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (kindFilter !== "all") params.set("kind", kindFilter);
    const res = await fetch(`/api/media/library?${params.toString()}`);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "could not load media");
      return;
    }
    const j = (await res.json()) as { media: LibraryItem[]; total: number };
    setItems(j.media);
    setTotal(j.total);
    setError(null);
    onLoaded?.(j.media);
  }, [onLoaded]);

  // Debounced so typing in the search box does not fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { void load(q, kind); }, 200);
    return () => clearTimeout(t);
  }, [q, kind, load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search alt text, filename or type"
            className="pl-8"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "image", "video"] as KindFilter[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-md border px-2.5 py-1.5 text-xs capitalize transition-colors ${
                kind === k ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {items === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {items?.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {q || kind !== "all"
            ? "Nothing matches that filter."
            : emptyHint ?? "No uploads yet — anything you attach to a post shows up here."}
        </div>
      )}

      {items && items.length > 0 && (
        <>
          <div className={`grid gap-2 ${compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`}>
            {items.map((m) => {
              const on = selectedIds?.includes(m.id) ?? false;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onToggle?.(m)}
                  disabled={!onToggle}
                  className={`group relative overflow-hidden rounded-md border text-left transition-colors ${
                    on ? "border-primary ring-1 ring-primary" : "hover:border-primary/50"
                  } ${onToggle ? "cursor-pointer" : "cursor-default"}`}
                >
                  {m.kind === "image" ? (
                    // Media is served from /api/media behind a session cookie —
                    // next/image optimization does not apply to authenticated media.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaSrc(m.path)} alt={m.altText ?? ""} className={compact ? "h-20 w-full object-cover" : "h-28 w-full object-cover"} />
                  ) : m.posterPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaSrc(m.posterPath)} alt={m.altText ?? ""} className={compact ? "h-20 w-full object-cover" : "h-28 w-full object-cover"} />
                  ) : (
                    <video src={mediaSrc(m.path)} className={compact ? "h-20 w-full object-cover" : "h-28 w-full object-cover"} muted />
                  )}

                  <div className="absolute left-1 top-1 flex gap-1">
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      {m.kind === "image" ? <ImageIcon className="h-2.5 w-2.5" /> : <Film className="h-2.5 w-2.5" />}
                      {m.kind}
                    </Badge>
                    {m.usageCount > 0 && (
                      <Badge variant="secondary" className="text-[10px]">×{m.usageCount}</Badge>
                    )}
                  </div>
                  {on && (
                    <div className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </div>
                  )}
                  {!compact && (
                    <div className="space-y-0.5 p-2">
                      <p className="truncate text-xs">{m.altText || m.path.split("/").pop()}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {m.width && m.height ? `${m.width}×${m.height} · ` : ""}
                        {formatBytes(m.sizeBytes)}
                        {m.usageCount > 0 ? ` · used in ${m.usageCount} post${m.usageCount > 1 ? "s" : ""}` : " · unused"}
                      </p>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {total > items.length && (
            <p className="text-xs text-muted-foreground">
              Showing {items.length} of {total} — narrow the search to see the rest.
            </p>
          )}
        </>
      )}
    </div>
  );
}
