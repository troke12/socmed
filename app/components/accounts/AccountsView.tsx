"use client";

import { useCallback, useEffect, useState } from "react";

interface Account {
  id: number;
  platform: "tiktok" | "linkedin" | "instagram" | "x";
  handle: string;
  displayName: string | null;
  status: "active" | "revoked" | "expired";
  tokenExpiresAt: number | null;
  createdAt: number;
}

const PLATFORMS: Account["platform"][] = ["x", "linkedin", "instagram", "tiktok"];

export function AccountsView() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Manual token add (for testing / sandbox tokens)
  const [platform, setPlatform] = useState<Account["platform"]>("x");
  const [handle, setHandle] = useState("");
  const [accessToken, setAccessToken] = useState("");

  // OAuth start
  const [oauthPlatform, setOauthPlatform] = useState<Account["platform"]>("x");
  const [oauthHandle, setOauthHandle] = useState("");

  const refresh = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/accounts");
    if (!res.ok) {
      setError("failed to load accounts");
      return;
    }
    const j = (await res.json()) as { accounts: Account[] };
    setAccounts(j.accounts);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, handle, creds: { accessToken } }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "failed");
        return;
      }
      setHandle("");
      setAccessToken("");
      setInfo("Account added");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onOauth(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/accounts/oauth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: oauthPlatform, handle: oauthHandle }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `OAuth start failed (env vars may be missing: ${envHintFor(oauthPlatform)})`);
        return;
      }
      const j = (await res.json()) as { authUrl: string };
      window.location.href = j.authUrl;
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete this account?")) return;
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    if (!res.ok) {
      setError("delete failed");
      return;
    }
    await refresh();
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-medium">Connect with OAuth</h2>
        <form onSubmit={onOauth} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="oauth-p">Platform</label>
            <select
              id="oauth-p"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={oauthPlatform}
              onChange={(e) => setOauthPlatform(e.target.value as Account["platform"])}
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="oauth-h">Handle</label>
            <input
              id="oauth-h"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={oauthHandle}
              onChange={(e) => setOauthHandle(e.target.value)}
              placeholder="@yourbrand"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !oauthHandle}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Starting..." : "Connect"}
          </button>
          <p className="w-full text-xs text-muted-foreground">
            Requires {envHintFor(oauthPlatform)} in <code className="rounded bg-muted px-1">.env</code>.
            See the Setup Wizard for details.
          </p>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Add manually (paste token)</h2>
        <form onSubmit={onAdd} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="p">Platform</label>
            <select
              id="p"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Account["platform"])}
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="h">Handle</label>
            <input
              id="h"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@yourbrand"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="text-sm font-medium" htmlFor="t">Access token</label>
            <input
              id="t"
              type="password"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="paste a token"
            />
          </div>
          <div className="sm:col-span-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !handle || !accessToken}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Saving..." : "Add account"}
            </button>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {info && <p className="text-sm text-green-600">{info}</p>}
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Connected</h2>
        {accounts === null && <p className="text-sm text-muted-foreground">Loading...</p>}
        {accounts && accounts.length === 0 && (
          <p className="text-sm text-muted-foreground">No accounts yet.</p>
        )}
        <ul className="space-y-2">
          {accounts?.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium">{a.platform} · {a.handle}</div>
                <div className="text-xs text-muted-foreground">
                  {a.displayName ?? "—"} · {a.status}
                  {a.tokenExpiresAt ? ` · expires ${new Date(a.tokenExpiresAt * 1000).toLocaleDateString()}` : ""}
                </div>
              </div>
              <button
                onClick={() => onDelete(a.id)}
                className="text-xs text-destructive hover:underline"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function envHintFor(p: Account["platform"]): string {
  switch (p) {
    case "x": return "X_CLIENT_ID + X_CLIENT_SECRET";
    case "linkedin": return "LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET";
    case "instagram": return "INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET";
    case "tiktok": return "TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET";
  }
}
