"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldOff, Copy } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export function SecurityView({ required }: { required: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/auth/totp");
    if (!res.ok) return;
    setEnabled(((await res.json()) as { enabled: boolean }).enabled);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function send(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await fetch("/api/auth/totp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError((j.error as string) ?? "request failed");
        return null;
      }
      return j;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {info && <div className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">{info}</div>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {enabled ? <ShieldCheck className="h-4 w-4 text-success" /> : <ShieldOff className="h-4 w-4" />}
            Two-factor authentication
            {enabled !== null && (
              <Badge variant={enabled ? "default" : "secondary"} className="ml-1">
                {enabled ? "on" : "off"}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            A time-based code from an authenticator app, on top of your password. Without it, a single
            leaked password gives away every connected social account&apos;s credentials.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {required && !enabled && (
            <div className="rounded-md border border-info-border/50 bg-info/10 px-3 py-2 text-sm">
              This installation requires two-factor authentication. Set it up to keep using the app.
            </div>
          )}

          {enabled === null && <p className="text-sm text-muted-foreground">Loading…</p>}

          {enabled === false && !setup && (
            <Button
              disabled={busy}
              onClick={async () => {
                const j = await send({ action: "begin" });
                if (j) setSetup({ secret: j.secret as string, uri: j.uri as string });
              }}
            >
              Set up two-factor
            </Button>
          )}

          {enabled === false && setup && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>1. Add this key to your authenticator app</Label>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-sm">
                    {setup.secret}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void navigator.clipboard?.writeText(setup.secret)}
                    title="Copy key"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Choose &ldquo;enter a setup key&rdquo; in your app. Or open this link on the device
                  running the app:{" "}
                  <a href={setup.uri} className="break-all text-primary underline">{setup.uri}</a>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-code">2. Enter the code it shows</Label>
                <Input
                  id="confirm-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  placeholder="123456"
                  className="max-w-40"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  disabled={busy || code.length < 6}
                  onClick={async () => {
                    const j = await send({ action: "confirm", code });
                    if (j) {
                      setSetup(null);
                      setCode("");
                      setInfo("Two-factor is on. Keep the key somewhere safe — there are no backup codes.");
                      await refresh();
                    }
                  }}
                >
                  Turn on
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => { setSetup(null); setCode(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {enabled === true && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You will be asked for a code every time you sign in. There are no backup codes — if you
                lose the device, an admin has to reset it for you from the Users page.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1 space-y-1">
                  <Label htmlFor="disable-pw" className="text-xs">Confirm your password to turn it off</Label>
                  <Input
                    id="disable-pw"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={busy || !password}
                  onClick={async () => {
                    const j = await send({ action: "disable", password });
                    if (j) {
                      setPassword("");
                      setInfo("Two-factor turned off.");
                      await refresh();
                    }
                  }}
                >
                  Turn off
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
