"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, Trash2, KeyRound, Ban, Check, ShieldCheck, ShieldOff } from "lucide-react";
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
import { ROLE_DESCRIPTIONS, type Role } from "@/lib/auth/roles";

interface UserRow {
  id: number;
  username: string;
  role: Role;
  disabled: number;
  totpEnabled: number;
  createdAt: number;
}

const ROLES: Role[] = ["admin", "editor", "viewer"];

export function UsersView({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/users");
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "could not load users");
      return;
    }
    setUsers(((await res.json()) as { users: UserRow[] }).users);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function send(body: Record<string, unknown>, okMsg: string): Promise<boolean> {
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "request failed");
        return false;
      }
      setInfo(okMsg);
      await refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  // Lives on /api/auth/totp rather than /api/users because it is the same
  // enrolment record the user manages themselves.
  async function resetTotp(id: number): Promise<void> {
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await fetch("/api/auth/totp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "admin_reset", id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "could not reset two-factor");
        return;
      }
      setInfo("Two-factor reset — they can enrol again from Security.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  // The API is the real gate; this only avoids offering a button that is going
  // to come back 409.
  const activeAdmins = (users ?? []).filter((u) => u.role === "admin" && !u.disabled).length;
  const isLastAdmin = (u: UserRow) => u.role === "admin" && !u.disabled && activeAdmins <= 1;

  return (
    <div className="space-y-6">
      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {info && <div className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">{info}</div>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4" /> Invite a user
          </CardTitle>
          <CardDescription>
            Creates the account directly — there is no email step, so hand over the password yourself
            and have them change it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="u-name">Username</Label>
              <Input id="u-name" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="jane" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-pass">Password</Label>
              <Input id="u-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 8 characters" />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
          <Button
            disabled={busy}
            onClick={async () => {
              const ok = await send({ action: "create", username: username.trim(), password, role }, "user created");
              if (ok) { setUsername(""); setPassword(""); }
            }}
          >
            Create user
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Users</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {users === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {users?.map((u) => (
            <div key={u.id} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{u.username}</span>
                    {u.id === currentUserId && <Badge variant="secondary" className="text-[10px]">you</Badge>}
                    {u.disabled ? <Badge variant="secondary" className="text-[10px]">disabled</Badge> : null}
                    {u.totpEnabled ? (
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <ShieldCheck className="h-2.5 w-2.5" /> 2FA
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Added {new Date(u.createdAt * 1000).toLocaleDateString()} · {ROLE_DESCRIPTIONS[u.role]}
                  </p>
                </div>

                <Select
                  value={u.role}
                  onValueChange={(v) => void send({ action: "set_role", id: u.id, role: v }, "role updated")}
                >
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r} disabled={r !== "admin" && isLastAdmin(u)}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    title={u.disabled ? "Re-enable" : "Disable"}
                    disabled={busy || (!u.disabled && (u.id === currentUserId || isLastAdmin(u)))}
                    onClick={() => void send({ action: "set_disabled", id: u.id, disabled: !u.disabled }, u.disabled ? "user re-enabled" : "user disabled")}
                  >
                    {u.disabled ? <Check className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    title="Set a new password"
                    disabled={busy}
                    onClick={() => { setResetFor(resetFor === u.id ? null : u.id); setNewPassword(""); }}
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                  {u.totpEnabled ? (
                    <Button
                      variant="outline"
                      size="sm"
                      title="Reset two-factor (they lost their device)"
                      disabled={busy}
                      onClick={() => void resetTotp(u.id)}
                    >
                      <ShieldOff className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    title="Delete"
                    disabled={busy || u.id === currentUserId || isLastAdmin(u)}
                    onClick={() => void send({ action: "delete", id: u.id }, "user deleted")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {resetFor === u.id && (
                <div className="flex flex-wrap items-end gap-2 border-t pt-2">
                  <div className="min-w-48 flex-1 space-y-1">
                    <Label htmlFor={`pw-${u.id}`} className="text-xs">New password</Label>
                    <Input
                      id={`pw-${u.id}`}
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="min 8 characters"
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={busy || newPassword.length < 8}
                    onClick={async () => {
                      const ok = await send({ action: "set_password", id: u.id, password: newPassword }, "password updated");
                      if (ok) { setResetFor(null); setNewPassword(""); }
                    }}
                  >
                    Save
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
