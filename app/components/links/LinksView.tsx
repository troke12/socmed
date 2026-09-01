"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface LinkRow {
  id: number;
  slug: string;
  targetUrl: string;
  clicks: number;
  lastClickedAt: number | null;
  createdAt: number;
  postId: number | null;
  caption: string | null;
  accountLabel: string | null;
  platform: string | null;
}

export function LinksView() {
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [origin, setOrigin] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/links");
    if (!res.ok) return;
    const j = (await res.json()) as { links: LinkRow[]; enabled: boolean; origin: string | null };
    setLinks(j.links);
    setEnabled(j.enabled);
    setOrigin(j.origin);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="space-y-4">
      {!enabled && (
        <div className="rounded-md border border-info-border/50 bg-info/10 px-3 py-2 text-sm">
          Link shortening is off. Set <code>SOCMED_SHORTEN_LINKS=true</code> and{" "}
          <code>SOCMED_PUBLIC_URL</code> to the origin this app is reachable at. UTM tagging
          works independently and is on by default.
        </div>
      )}
      {enabled && !origin && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Shortening is enabled but <code>SOCMED_PUBLIC_URL</code> is unset or invalid, so no
          short links can be minted. Posts publish with the full URL instead.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Short links</CardTitle>
        </CardHeader>
        <CardContent>
          {links === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {links?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing yet. A short link is minted when a post carrying a link publishes.
            </p>
          )}
          {links && links.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2">Short</th>
                    <th className="py-2">Destination</th>
                    <th className="py-2">Post</th>
                    <th className="py-2 text-right">Clicks</th>
                    <th className="py-2 text-right">Last click</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-2 font-mono text-xs">/s/{l.slug}</td>
                      <td className="max-w-[320px] truncate py-2">
                        <a href={l.targetUrl} target="_blank" rel="noreferrer" className="hover:underline">
                          {l.targetUrl}
                        </a>
                      </td>
                      <td className="max-w-[220px] truncate py-2 text-muted-foreground">
                        {l.postId ? (
                          <a href={`/compose?id=${l.postId}`} className="hover:underline">
                            {l.accountLabel ? `${l.accountLabel} · ` : ""}
                            {l.caption?.slice(0, 40) || `#${l.postId}`}
                          </a>
                        ) : (
                          <span className="italic">post deleted</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <Badge variant={l.clicks > 0 ? "default" : "secondary"}>{l.clicks}</Badge>
                      </td>
                      <td className="py-2 text-right text-xs text-muted-foreground">
                        {l.lastClickedAt ? new Date(l.lastClickedAt * 1000).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
