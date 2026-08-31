"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, ExternalLink, KeyRound, AtSign } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PLATFORMS, getPlatform, type PlatformId } from "@/lib/platform-meta";

interface Account {
  id: number;
  platform: PlatformId;
  label: string;
  handle: string;
  displayName: string | null;
  instanceUrl: string | null;
  status: "active" | "revoked" | "expired";
  tokenExpiresAt: number | null;
  createdAt: number;
}

// Platforms where the user needs to enter something beyond clicking Connect
const NEEDS_HANDLE: PlatformId[] = ["bluesky"]; // handle + app password
const NEEDS_INSTANCE: PlatformId[] = ["mastodon", "discord", "bluesky"]; // instance URL / guild / PDS

export function AccountsView() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Per-platform form state
  const [form, setForm] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/accounts");
    if (!res.ok) { setError("failed to load accounts"); return; }
    const j = (await res.json()) as { accounts: Account[] };
    setAccounts(j.accounts);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  function setField(p: PlatformId, key: string, value: string) {
    setForm((f) => ({ ...f, [`${p}:${key}`]: value }));
  }
  function getField(p: PlatformId, key: string) {
    return form[`${p}:${key}`] ?? "";
  }

  /** OAuth platforms — one click, no input needed */
  async function onOauth(platform: PlatformId) {
    setBusyId(`oauth-${platform}`);
    setError(null); setInfo(null);
    try {
      const res = await fetch("/api/accounts/oauth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, handle: getField(platform, "label") }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `OAuth start failed — set the ${platform} env vars in .env first (check /setup)`);
        return;
      }
      const j = (await res.json()) as { authUrl: string };
      window.location.href = j.authUrl;
    } finally {
      setBusyId(null);
    }
  }

  /** Mastodon — instance URL required, then OAuth */
  async function onMastodonConnect() {
    const instanceUrl = getField("mastodon", "instance").trim();
    if (!instanceUrl) { setError("Enter your Mastodon instance URL (e.g. https://mastodon.social)"); return; }
    setBusyId(`oauth-mastodon`);
    setError(null); setInfo(null);
    try {
      const res = await fetch("/api/accounts/oauth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: "mastodon", handle: "", instanceUrl }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "failed");
        return;
      }
      const j = (await res.json()) as { authUrl: string };
      window.location.href = j.authUrl;
    } finally {
      setBusyId(null);
    }
  }

  /** Bluesky — handle + app password (identifier + app password) */
  async function onBlueskyAdd() {
    const handle = getField("bluesky", "handle").trim();
    const token = getField("bluesky", "token").trim();
    if (!handle || !token) { setError("Bluesky needs your handle (e.g. you.bsky.social) and an app password"); return; }
    setBusyId(`manual-bluesky`);
    setError(null); setInfo(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: "bluesky",
          label: getField("bluesky", "label") || undefined,
          handle,
          creds: { accessToken: token },
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "failed");
        return;
      }
      setForm((f) => ({ ...f, "bluesky:handle": "", "bluesky:token": "" }));
      setInfo("Bluesky account added");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  /** Discord — bot token + channel IDs (label optional) */
  async function onDiscordAdd() {
    const token = getField("discord", "token").trim();
    const channels = getField("discord", "channels").trim();
    if (!token) { setError("Discord needs a bot token"); return; }
    setBusyId(`manual-discord`);
    setError(null); setInfo(null);
    try {
      const body: Record<string, unknown> = {
        platform: "discord",
        label: getField("discord", "label") || undefined,
        handle: getField("discord", "label") || "",
        creds: {
          accessToken: token,
          raw: channels ? { channelIds: channels.split(",").map((s) => s.trim()).filter(Boolean) } : {},
        },
      };
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "failed");
        return;
      }
      setForm((f) => ({ ...f, "discord:token": "" }));
      setInfo("Discord bot added");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete this account?")) return;
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    if (!res.ok) { setError("delete failed"); return; }
    await refresh();
  }

  if (accounts === null) return <p className="text-sm text-muted-foreground">Loading...</p>;

  const byPlatform = new Map<PlatformId, Account[]>();
  for (const a of accounts) {
    const list = byPlatform.get(a.platform) ?? [];
    list.push(a);
    byPlatform.set(a.platform, list);
  }

  return (
    <div className="space-y-8">
      {error && <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {info && <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">{info}</div>}

      <div>
        <h2 className="mb-3 text-lg font-semibold">Connect a platform</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          OAuth platforms connect with one click. A few need extra details — the form will show you what.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {PLATFORMS.map((p) => {
            const connected = byPlatform.get(p.id) ?? [];
            return (
              <Card key={p.id} className="overflow-hidden">
                <CardHeader className={`flex flex-row items-center gap-3 ${p.bg} ${p.text} bg-gradient-to-br`}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 text-lg font-bold backdrop-blur">
                    {p.short}
                  </div>
                  <div>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <CardDescription className={`text-xs ${p.text} opacity-80`}>
                      {p.auth === "oauth" ? "OAuth 2.0" : p.auth === "token" ? "Token / bot" : "OAuth or token"}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-4">
                  {connected.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {connected.map((a) => (
                        <Badge key={a.id} variant="secondary" className="text-xs">
                          {a.label}
                          {a.status !== "active" && ` · ${a.status}`}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* ── OAuth: one-click connect ─────────────── */}
                  {p.id === "mastodon" && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">{p.description}</p>
                      <Input
                        placeholder="Instance URL (e.g. https://mastodon.social)"
                        className="h-9 text-sm"
                        value={getField("mastodon", "instance")}
                        onChange={(e) => setField("mastodon", "instance", e.target.value)}
                      />
                      <Button size="sm" className="w-full" disabled={busyId === "oauth-mastodon"} onClick={() => void onMastodonConnect()}>
                        <ExternalLink className="h-4 w-4" /> Connect with Mastodon
                      </Button>
                    </div>
                  )}

                  {p.id === "bluesky" && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">{p.description}</p>
                      <Input
                        placeholder="Your handle (e.g. you.bsky.social)"
                        className="h-9 text-sm"
                        value={getField("bluesky", "handle")}
                        onChange={(e) => setField("bluesky", "handle", e.target.value)}
                      />
                      <Input
                        placeholder="App password (Settings → App Passwords)"
                        type="password"
                        className="h-9 text-sm"
                        value={getField("bluesky", "token")}
                        onChange={(e) => setField("bluesky", "token", e.target.value)}
                      />
                      <Input
                        placeholder="Label (optional — e.g. Personal)"
                        className="h-9 text-sm"
                        value={getField("bluesky", "label")}
                        onChange={(e) => setField("bluesky", "label", e.target.value)}
                      />
                      <Button size="sm" className="w-full" disabled={busyId === "manual-bluesky"} onClick={() => void onBlueskyAdd()}>
                        <KeyRound className="h-4 w-4" /> Add Bluesky account
                      </Button>
                    </div>
                  )}

                  {p.id === "discord" && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">{p.description}</p>
                      <Input
                        placeholder="Bot token"
                        type="password"
                        className="h-9 text-sm"
                        value={getField("discord", "token")}
                        onChange={(e) => setField("discord", "token", e.target.value)}
                      />
                      <Input
                        placeholder="Channel IDs, comma separated (optional)"
                        className="h-9 text-sm"
                        value={getField("discord", "channels")}
                        onChange={(e) => setField("discord", "channels", e.target.value)}
                      />
                      <Input
                        placeholder="Label (optional — e.g. Main bot)"
                        className="h-9 text-sm"
                        value={getField("discord", "label")}
                        onChange={(e) => setField("discord", "label", e.target.value)}
                      />
                      <Button size="sm" className="w-full" disabled={busyId === "manual-discord"} onClick={() => void onDiscordAdd()}>
                        <KeyRound className="h-4 w-4" /> Add Discord bot
                      </Button>
                    </div>
                  )}

                  {p.id !== "mastodon" && p.id !== "bluesky" && p.id !== "discord" && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">{p.description}</p>
                      <Input
                        placeholder="Label (optional — e.g. Personal)"
                        className="h-9 text-sm"
                        value={getField(p.id, "label")}
                        onChange={(e) => setField(p.id, "label", e.target.value)}
                      />
                      <Button size="sm" className="w-full" disabled={busyId === `oauth-${p.id}`} onClick={() => void onOauth(p.id)}>
                        <ExternalLink className="h-4 w-4" /> Connect {p.name}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* All accounts */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Connected accounts ({accounts.length})</h2>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts yet — pick a platform above.</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => {
              const meta = getPlatform(a.platform);
              return (
                <div key={a.id} className="flex items-center justify-between rounded-md border border-hairline bg-card px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold text-white ${meta?.bg ?? "bg-slate-500"}`}>
                      {meta?.short ?? "?"}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {meta?.name ?? a.platform} · {a.label}
                        <Badge variant={a.status === "active" ? "success" : "destructive"} className="text-[10px]">
                          {a.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a.handle || "—"}
                        {a.instanceUrl ? ` · ${a.instanceUrl}` : ""}
                        {a.tokenExpiresAt ? ` · expires ${new Date(a.tokenExpiresAt * 1000).toLocaleDateString()}` : ""}
                      </div>
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => void onDelete(a.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
