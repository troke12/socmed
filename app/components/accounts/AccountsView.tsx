"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, ExternalLink } from "lucide-react";
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

export function AccountsView() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // OAuth connect form state per platform
  const [oauthHandle, setOauthHandle] = useState<Record<string, string>>({});

  // Manual token add form
  const [manual, setManual] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/accounts");
    if (!res.ok) { setError("failed to load accounts"); return; }
    const j = (await res.json()) as { accounts: Account[] };
    setAccounts(j.accounts);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function onOauth(platform: PlatformId) {
    const handle = (oauthHandle[platform] ?? "").trim();
    if (!handle) { setError(`Enter a handle for ${platform}`); return; }
    setBusyId(`oauth-${platform}`);
    setError(null); setInfo(null);
    try {
      const res = await fetch("/api/accounts/oauth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, handle }),
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

  async function onManualAdd(platform: PlatformId) {
    const label = (manual[`label-${platform}`] ?? "").trim();
    const token = (manual[`token-${platform}`] ?? "").trim();
    if (!label || !token) { setError("Enter a label and token"); return; }
    setBusyId(`manual-${platform}`);
    setError(null); setInfo(null);
    try {
      const body: Record<string, unknown> = {
        platform,
        label,
        creds: { accessToken: token },
      };
      const handle = (manual[`handle-${platform}`] ?? "").trim();
      if (handle) body.handle = handle;
      if (platform === "discord") {
        const guild = (manual[`guild-${platform}`] ?? "").trim();
        if (guild) {
          body.instanceUrl = guild;
          body.creds = {
            accessToken: token,
            raw: { channelIds: guild.split(",").map((s) => s.trim()).filter(Boolean) },
          };
        }
      }
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
      setManual((m) => ({ ...m, [`label-${platform}`]: "", [`token-${platform}`]: "" }));
      setInfo("Account added");
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

      {/* Platform grid */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Connect a platform</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {PLATFORMS.map((p) => {
            const connected = byPlatform.get(p.id) ?? [];
            const busy = busyId === `oauth-${p.id}` || busyId === `manual-${p.id}`;
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

                  {p.auth !== "token" && (
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="@handle"
                        className="h-9 text-sm"
                        value={oauthHandle[p.id] ?? ""}
                        onChange={(e) => setOauthHandle((m) => ({ ...m, [p.id]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        className="shrink-0"
                        disabled={busy}
                        onClick={() => void onOauth(p.id)}
                      >
                        <ExternalLink className="h-4 w-4" /> Connect
                      </Button>
                    </div>
                  )}

                  {p.auth !== "oauth" && (
                    <div className="space-y-2 rounded-md bg-muted/50 p-2">
                      <p className="text-xs text-muted-foreground">{p.description}</p>
                      <Input
                        placeholder="Label (e.g. Marketing Bot)"
                        className="h-9 text-sm"
                        value={manual[`label-${p.id}`] ?? ""}
                        onChange={(e) => setManual((m) => ({ ...m, [`label-${p.id}`]: e.target.value }))}
                      />
                      <Input
                        placeholder={p.id === "discord" ? "Bot token" : "App password / token"}
                        type="password"
                        className="h-9 text-sm"
                        value={manual[`token-${p.id}`] ?? ""}
                        onChange={(e) => setManual((m) => ({ ...m, [`token-${p.id}`]: e.target.value }))}
                      />
                      {p.id === "discord" && (
                        <Input
                          placeholder="Channel IDs (comma separated)"
                          className="h-9 text-sm"
                          value={manual[`guild-${p.id}`] ?? ""}
                          onChange={(e) => setManual((m) => ({ ...m, [`guild-${p.id}`]: e.target.value }))}
                        />
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        disabled={busy}
                        onClick={() => void onManualAdd(p.id)}
                      >
                        <Plus className="h-4 w-4" /> Add
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
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
                >
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
