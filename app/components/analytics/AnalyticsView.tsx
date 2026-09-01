"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

interface Account {
  id: number;
  label: string;
  platform: string;
}

interface Overview {
  window: { days: number; since: number; until: number };
  totals: {
    impressions: number; reach: number; likes: number; comments: number;
    shares: number; saves: number; videoViews: number; watchTimeMs: number;
    engagementRate: number; postCount: number;
  };
  timeseries: Array<{ day: string; impressions: number; engagement: number; likes: number; comments: number; shares: number }>;
  byPlatform: Array<{ platform: string; impressions: number; engagement: number; likes: number; comments: number; shares: number; postCount: number }>;
  byAccount: Array<{ accountId: number; label: string; platform: string; impressions: number; engagement: number; likes: number; comments: number; shares: number; postCount: number }>;
  top: Array<{ postId: number; caption: string; url?: string; platform?: string; engagement: number; impressions: number; likes: number; comments: number }>;
}

const COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16"];

// datetime-local/date inputs speak local wall clock; the API speaks unix seconds.
function dayStartTs(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  return Math.floor(new Date(y!, m! - 1, d!, 0, 0, 0, 0).getTime() / 1000);
}

function dayEndTs(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  // Inclusive of the day the user picked — an end date of the 5th should
  // include everything captured on the 5th, not stop at midnight.
  return Math.floor(new Date(y!, m! - 1, d!, 23, 59, 59, 999).getTime() / 1000);
}

export function AnalyticsView() {
  const [data, setData] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [days, setDays] = useState(30);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(() => {
    const params = new URLSearchParams();
    if (custom?.from && custom?.to) {
      params.set("from", String(dayStartTs(custom.from)));
      params.set("to", String(dayEndTs(custom.to)));
    } else {
      params.set("days", String(days));
    }
    if (accountId) params.set("accountId", String(accountId));
    return params.toString();
  }, [custom, days, accountId]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/analytics/overview?${query()}`);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "failed to load");
      return;
    }
    setError(null);
    setData(await res.json());
  }, [query]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/accounts");
      if (res.ok) setAccounts(((await res.json()) as { accounts: Account[] }).accounts);
    })();
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const i = setInterval(refresh, 60_000);
    return () => clearInterval(i);
  }, [refresh]);

  const controls = (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex gap-1">
        {[7, 14, 30, 60, 90].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => { setCustom(null); setDays(d); }}
            className={`rounded-md border px-2.5 py-1.5 text-xs ${
              !custom && days === d ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      <div className="flex items-end gap-1">
        <label className="text-xs text-muted-foreground">
          From
          <input
            type="date"
            value={custom?.from ?? ""}
            onChange={(e) => setCustom((c) => ({ from: e.target.value, to: c?.to ?? e.target.value }))}
            className="ml-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          To
          <input
            type="date"
            value={custom?.to ?? ""}
            onChange={(e) => setCustom((c) => ({ from: c?.from ?? e.target.value, to: e.target.value }))}
            className="ml-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
        </label>
        {custom && (
          <button type="button" className="px-1 text-xs text-muted-foreground underline" onClick={() => setCustom(null)}>
            Clear
          </button>
        )}
      </div>

      <select
        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        value={accountId ?? ""}
        onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.label}</option>
        ))}
      </select>

      <a
        href={`/api/analytics/export?${query()}`}
        className="rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
      >
        Export CSV
      </a>
    </div>
  );

  if (error) {
    return (
      <div className="space-y-4">
        {controls}
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (data.totals.postCount === 0) {
    return (
      <div className="space-y-4">
        {controls}
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No analytics in this range. The worker fetches metrics every 15 min for published posts.
          </p>
        </div>
      </div>
    );
  }

  const t = data.totals;
  const fmt = (n: number) => n.toLocaleString();
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">
          {custom?.from && custom?.to
            ? `${custom.from} – ${custom.to}`
            : `Last ${days} days`}
          {accountId ? ` · ${accounts.find((a) => a.id === accountId)?.label ?? ""}` : ""}
        </h2>
        {controls}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="Impressions" value={fmt(t.impressions)} />
        <KPI label="Reach" value={fmt(t.reach)} />
        <KPI label="Engagement" value={pct(t.engagementRate)} />
        <KPI label="Posts" value={fmt(t.postCount)} />
        <KPI label="Likes" value={fmt(t.likes)} />
        <KPI label="Comments" value={fmt(t.comments)} />
        <KPI label="Shares" value={fmt(t.shares)} />
        <KPI label="Saves" value={fmt(t.saves)} />
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Impressions over time</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.timeseries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="impressions" stroke="#2563eb" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Engagement by platform</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byPlatform}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="platform" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="likes" fill="#2563eb" />
                <Bar dataKey="comments" fill="#10b981" />
                <Bar dataKey="shares" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Reach by platform</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.byPlatform}
                  dataKey="impressions"
                  nameKey="platform"
                  outerRadius={80}
                  label={(e: { platform?: string; percent?: number }) => `${e.platform ?? ""} ${((e.percent ?? 0) * 100).toFixed(0)}%`}
                >
                  {data.byPlatform.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <h3 className="mb-1 text-sm font-medium">By account</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Two accounts on the same platform were previously merged into one row.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2">Account</th>
              <th className="py-2">Platform</th>
              <th className="py-2 text-right">Impr.</th>
              <th className="py-2 text-right">Likes</th>
              <th className="py-2 text-right">Comments</th>
              <th className="py-2 text-right">Shares</th>
              <th className="py-2 text-right">Eng.</th>
            </tr>
          </thead>
          <tbody>
            {data.byAccount.map((a) => (
              <tr key={a.accountId} className="border-b last:border-0">
                <td className="py-2">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => setAccountId(accountId === a.accountId ? null : a.accountId)}
                  >
                    {a.label}
                  </button>
                </td>
                <td className="py-2 capitalize text-muted-foreground">{a.platform}</td>
                <td className="py-2 text-right">{fmt(a.impressions)}</td>
                <td className="py-2 text-right">{fmt(a.likes)}</td>
                <td className="py-2 text-right">{fmt(a.comments)}</td>
                <td className="py-2 text-right">{fmt(a.shares)}</td>
                <td className="py-2 text-right">{pct(a.engagement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Top posts by engagement</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2">Caption</th>
              <th className="py-2 text-right">Impr.</th>
              <th className="py-2 text-right">Likes</th>
              <th className="py-2 text-right">Comments</th>
              <th className="py-2 text-right">Eng.</th>
            </tr>
          </thead>
          <tbody>
            {data.top.map((p) => (
              <tr key={p.postId} className="border-b last:border-0">
                <td className="max-w-[420px] truncate py-2">
                  {p.url ? <a className="hover:underline" href={p.url} target="_blank" rel="noreferrer">{p.caption}</a> : p.caption}
                </td>
                <td className="py-2 text-right">{fmt(p.impressions)}</td>
                <td className="py-2 text-right">{fmt(p.likes)}</td>
                <td className="py-2 text-right">{fmt(p.comments)}</td>
                <td className="py-2 text-right">{pct(p.engagement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
