"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, KeyRound, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Check {
  id: string;
  label: string;
  description: string;
  done: boolean;
  hint?: string;
  required: boolean;
  platforms?: string[];
}

interface SetupStatus {
  checks: Check[];
  summary: { required: { done: number; total: number }; optional: { done: number; total: number }; ready: boolean };
  accountsByPlatform: Record<string, number>;
}

export function SetupWizard() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/setup");
    if (!res.ok) { setError("failed to load setup status"); return; }
    setStatus(await res.json());
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function onGenerateMasterKey() {
    if (!confirm("Generate SOCMED_MASTER_KEY and SOCMED_COOKIE_SECRET in .env? This overwrites existing values.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/setup/generate-keys", { method: "POST" });
      if (!res.ok) { setError("failed to generate keys"); return; }
      const j = await res.json();
      alert(`Generated. Restart web + worker for the new keys to take effect.\n\nMaster: ${j.masterKey.slice(0, 8)}…\nCookie: ${j.cookieSecret.slice(0, 8)}…`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!status) return <p className="text-sm text-muted-foreground">Loading...</p>;

  const required = status.checks.filter((c) => c.required);
  const optional = status.checks.filter((c) => !c.required);

  return (
    <div className="space-y-8">
      {/* Summary band */}
      <Card className={status.summary.ready ? "border-success-border/40 bg-green-50/50" : "bg-primary text-white"}>
        <CardContent className="flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {status.summary.ready ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-signature-yellow" />
              )}
              <h2 className="text-lg font-medium">
                {status.summary.ready ? "Everything's ready" : "Setup needed"}
              </h2>
            </div>
            <p className={status.summary.ready ? "text-sm text-muted-foreground" : "text-sm text-white/70"}>
              Required {status.summary.required.done}/{status.summary.required.total} · Platforms
              configured {status.summary.optional.done}/{status.summary.optional.total}
            </p>
          </div>
          <Button
            variant={status.summary.ready ? "outline" : "default"}
            onClick={onGenerateMasterKey}
            disabled={busy}
            className={status.summary.ready ? "" : "bg-white text-primary hover:bg-white/90"}
          >
            <KeyRound className="h-4 w-4" />
            {busy ? "Generating..." : "Generate master keys"}
          </Button>
        </CardContent>
      </Card>

      {/* Required checks */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Required</h2>
        {required.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </section>

      {/* Platform integrations */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-medium">Platform integrations</h2>
          <p className="text-sm text-muted-foreground">
            Set env vars per platform, then connect accounts on{" "}
            <a href="/accounts" className="text-link hover:underline">/accounts</a>.
          </p>
        </div>
        {optional.map((c) => (
          <CheckRow
            key={c.id}
            check={c}
            count={c.platforms?.map((p) => status.accountsByPlatform[p] ?? 0).reduce((a, b) => a + b, 0)}
          />
        ))}
      </section>

      {/* Next steps */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Next steps</h2>
        <Card>
          <CardContent className="p-6">
            <ol className="space-y-3">
              {[
                ["Generate master keys", "Button above — writes to .env (mode 0600)."],
                ["Restart", "docker compose down && docker compose up -d"],
                ["Sign in", "Use SOCMED_ADMIN_USERNAME / SOCMED_ADMIN_PASSWORD (default admin/changeme)."],
                ["Connect platforms", "Add accounts per platform on /accounts."],
                ["Compose your first post", "Head to /compose and publish."],
              ].map(([title, desc], i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-white">
                    {i + 1}
                  </span>
                  <div>
                    <div className="text-sm font-medium">{title}</div>
                    <div className="text-sm text-muted-foreground">{desc}</div>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function CheckRow({ check, count }: { check: Check; count?: number }) {
  return (
    <Card className={check.done ? "" : "border-amber-300 bg-signature-cream/30"}>
      <CardContent className="flex items-start gap-3 p-4">
        <div
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center ${
            check.done ? "text-success" : "text-signature-mustard"
          }`}
        >
          {check.done ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">{check.label}</div>
            {count !== undefined && count > 0 && (
              <Badge variant="success">{count} account{count === 1 ? "" : "s"}</Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{check.description}</p>
          {check.hint && (
            <a
              href={check.hint}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm text-link hover:underline"
            >
              Get credentials <ArrowRight className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
