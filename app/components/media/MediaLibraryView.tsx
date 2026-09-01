"use client";

import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MediaGrid, mediaSrc, formatBytes, type LibraryItem } from "./MediaGrid";

export function MediaLibraryView() {
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumping this key remounts MediaGrid, which is how the list picks up a new
  // upload or an edited alt text without MediaGrid needing to expose a reload.
  const [reloadKey, setReloadKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  function select(item: LibraryItem): void {
    setSelected(item);
    setAlt(item.altText ?? "");
    setInfo(null);
    setError(null);
  }

  async function onUpload(file: File): Promise<void> {
    setBusy(true); setError(null); setInfo(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/media/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "upload failed");
        return;
      }
      const j = (await res.json()) as { deduped?: boolean };
      setInfo(j.deduped ? "Already in the library — reused the existing file." : "Uploaded ✓");
      setReloadKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  async function saveAlt(): Promise<void> {
    if (!selected) return;
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await fetch("/api/media/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set_alt", id: selected.id, altText: alt }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "could not save");
        return;
      }
      setInfo("Alt text saved ✓");
      setSelected({ ...selected, altText: alt });
      setReloadKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">All uploads</CardTitle>
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
            <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              <ImagePlus className="h-4 w-4" /> Upload
            </Button>
          </CardHeader>
          <CardContent>
            {error && <div className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            {info && <div className="mb-3 rounded-md bg-success/10 px-3 py-2 text-sm text-success">{info}</div>}
            <MediaGrid
              key={reloadKey}
              selectedIds={selected ? [selected.id] : []}
              onToggle={select}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!selected && <p className="text-sm text-muted-foreground">Pick an item to see its details.</p>}
          {selected && (
            <>
              {selected.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaSrc(selected.path)} alt={selected.altText ?? ""} className="w-full rounded-md border object-contain" />
              ) : (
                <video src={mediaSrc(selected.path)} className="w-full rounded-md border" controls />
              )}
              <dl className="space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between"><dt>Type</dt><dd>{selected.mime}</dd></div>
                <div className="flex justify-between"><dt>Size</dt><dd>{formatBytes(selected.sizeBytes)}</dd></div>
                {selected.width && selected.height && (
                  <div className="flex justify-between"><dt>Dimensions</dt><dd>{selected.width}×{selected.height}</dd></div>
                )}
                {selected.durationMs && (
                  <div className="flex justify-between"><dt>Duration</dt><dd>{(selected.durationMs / 1000).toFixed(1)}s</dd></div>
                )}
                <div className="flex justify-between">
                  <dt>Used in</dt>
                  <dd>{selected.usageCount} post{selected.usageCount === 1 ? "" : "s"}</dd>
                </div>
                <div className="flex justify-between"><dt>Uploaded</dt><dd>{new Date(selected.createdAt * 1000).toLocaleDateString()}</dd></div>
              </dl>
              <div className="space-y-2">
                <Label htmlFor="alt">Alt text</Label>
                <Input id="alt" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Describe the image" />
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveAlt()}>
                  Save alt text
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
