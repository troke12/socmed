"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Copy, Ban, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TokenRow {
  id: number;
  name: string;
  prefix: string;
  role: "editor" | "viewer";
  createdByName: string | null;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

function fmt(ts: number | null): string {
  return ts ? new Date(ts * 1000).toLocaleString() : "—";
}

export function TokensView() {
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/tokens");
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "could not load tokens");
      return;
    }
    setTokens(((await res.json()) as { tokens: TokenRow[] }).tokens);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function send(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) { setError((j.error as string) ?? "request failed"); return null; }
      await refresh();
      return j;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      {fresh && (
        <div className="space-y-2 rounded-md border border-success-border/40 bg-success/10 p-3">
          <p className="text-sm font-medium text-success">
            Copy this token now — it is not stored and cannot be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-card px-3 py-2 font-mono text-xs">{fresh}</code>
            <Button variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(fresh)}>
              <Copy className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFresh(null)}>Done</Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> New API token
          </CardTitle>
          <CardDescription>
            For calling the API from an automation tool. Tokens cap out at editor — managing
            accounts, users and tokens themselves stays sign-in only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="t-name">Name</Label>
              <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Zapier — blog to social" />
            </div>
            <div className="space-y-2">
              <Label>Access</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "editor" | "viewer")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">editor — create and schedule posts</SelectItem>
                  <SelectItem value="viewer">viewer — read only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-exp">Expires in (days)</Label>
              <Input
                id="t-exp"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder="blank = never"
                inputMode="numeric"
              />
            </div>
          </div>
          <Button
            disabled={busy || !name.trim()}
            onClick={async () => {
              const days = Number(expiresInDays);
              const j = await send({
                action: "create",
                name: name.trim(),
                role,
                expiresInDays: expiresInDays.trim() && Number.isInteger(days) && days > 0 ? days : null,
              });
              if (j) { setFresh(j.token as string); setName(""); setExpiresInDays(""); }
            }}
          >
            Create token
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tokens</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tokens === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {tokens?.length === 0 && <p className="text-sm text-muted-foreground">No tokens yet.</p>}
          {tokens?.map((t) => {
            const expired = t.expiresAt !== null && t.expiresAt <= Math.floor(Date.now() / 1000);
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{t.name}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{t.prefix}…</code>
                    <Badge variant="secondary">{t.role}</Badge>
                    {t.revokedAt && <Badge variant="destructive">revoked</Badge>}
                    {!t.revokedAt && expired && <Badge variant="secondary">expired</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Created {fmt(t.createdAt)}{t.createdByName ? ` by ${t.createdByName}` : ""} · Last used {fmt(t.lastUsedAt)}
                    {t.expiresAt ? ` · Expires ${fmt(t.expiresAt)}` : " · Never expires"}
                  </p>
                </div>
                <div className="flex gap-1">
                  {!t.revokedAt && (
                    <Button variant="outline" size="sm" title="Revoke" disabled={busy} onClick={() => void send({ action: "revoke", id: t.id })}>
                      <Ban className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="outline" size="sm" title="Delete" disabled={busy} onClick={() => void send({ action: "delete", id: t.id })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
