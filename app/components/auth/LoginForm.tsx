"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Once the password checks out the server holds a short-lived pending cookie,
  // so the second leg sends only the code — the password is never resent.
  const [stage, setStage] = useState<"password" | "totp">("password");
  const [code, setCode] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(stage === "totp" ? { totp: code } : { username, password }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; needsTotp?: boolean };
      if (!res.ok) {
        setError(j.error ?? "login failed");
        // An expired hand-off has to start over from the password.
        if (res.status === 401 && stage === "totp" && j.error?.includes("sign in again")) {
          setStage("password");
          setCode("");
        }
        return;
      }
      if (j.needsTotp) {
        setStage("totp");
        return;
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "totp") {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="totp">Authentication code</Label>
          <Input
            id="totp"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            From your authenticator app. Codes are valid for about a minute.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || code.length < 6} className="w-full">
          {busy ? "Verifying..." : "Verify"}
        </Button>
        <button
          type="button"
          className="w-full text-xs text-muted-foreground underline"
          onClick={() => { setStage("password"); setCode(""); setError(null); }}
        >
          Back
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
