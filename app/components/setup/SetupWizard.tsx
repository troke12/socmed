"use client";

import { useCallback, useEffect, useState } from "react";

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
    if (!res.ok) {
      setError("failed to load setup status");
      return;
    }
    setStatus(await res.json());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onGenerateMasterKey() {
    if (!confirm("Generate SOCMED_MASTER_KEY and SOCMED_COOKIE_SECRET in .env? This overwrites existing values.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/setup/generate-keys", { method: "POST" });
      if (!res.ok) {
        setError("failed to generate keys");
        return;
      }
      const j = await res.json();
      alert(`Generated. Restart the web and worker containers for the new keys to take effect.\n\nMaster: ${j.masterKey.slice(0,8)}…\nCookie: ${j.cookieSecret.slice(0,8)}…`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!status) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center justify-between rounded-md border border-border bg-card p-4">
          <div>
            <h2 className="text-lg font-medium">
              {status.summary.ready ? "✓ Ready" : "Setup needed"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Required: {status.summary.required.done} / {status.summary.required.total}
              {" · "}
              Optional platforms configured: {status.summary.optional.done} / {status.summary.optional.total}
            </p>
          </div>
          {!status.summary.ready && (
            <button
              onClick={onGenerateMasterKey}
              disabled={busy}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Generating..." : "Generate master keys"}
            </button>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Required</h2>
        <ul className="space-y-2">
          {status.checks.filter((c) => c.required).map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Platform integrations</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Set the env vars for each platform you want to use, then connect an account on the
          {" "}<a className="underline" href="/accounts">Accounts page</a>.
        </p>
        <ul className="space-y-2">
          {status.checks.filter((c) => !c.required).map((c) => (
            <CheckRow
              key={c.id}
              check={c}
              count={c.platforms?.map((p) => status.accountsByPlatform[p] ?? 0).reduce((a, b) => a + b, 0)}
            />
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">What's next?</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Generate master keys (button above) — this writes them to <code>.env</code>.</li>
          <li>Restart the web and worker containers: <code>bash scripts/tmux-down.sh && bash scripts/tmux-up.sh</code></li>
          <li>Open <a className="underline" href="/login">/login</a> and sign in with <code>SOCMED_ADMIN_USERNAME</code> / <code>SOCMED_ADMIN_PASSWORD</code>.</li>
          <li>Set the env vars for the platforms you want (left side), then add an account on <a className="underline" href="/accounts">/accounts</a>.</li>
          <li>Compose your first post on <a className="underline" href="/compose">/compose</a>.</li>
        </ol>
      </section>
    </div>
  );
}

function CheckRow({ check, count }: { check: Check; count?: number }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-border bg-card p-3 text-sm">
      <div
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
          check.done ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
        }`}
      >
        {check.done ? "✓" : "!"}
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <div className="font-medium">{check.label}</div>
          {count !== undefined && count > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
              {count} account{count === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{check.description}</p>
        {check.hint && (
          <p className="mt-1 text-xs">
            <a className="text-blue-600 underline" href={check.hint} target="_blank" rel="noreferrer">
              Get credentials →
            </a>
          </p>
        )}
      </div>
    </li>
  );
}
