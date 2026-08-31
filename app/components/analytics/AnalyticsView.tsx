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

interface Overview {
  window: { days: number; since: number };
  totals: {
    impressions: number; reach: number; likes: number; comments: number;
    shares: number; saves: number; videoViews: number; watchTimeMs: number;
    engagementRate: number; postCount: number;
  };
  timeseries: Array<{ day: string; impressions: number; engagement: number; likes: number; comments: number; shares: number }>;
  byPlatform: Array<{ platform: string; impressions: number; engagement: number; likes: number; comments: number; shares: number; postCount: number }>;
  top: Array<{ postId: number; caption: string; url?: string; platform?: string; engagement: number; impressions: number; likes: number; comments: number }>;
}

const COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16"];

export function AnalyticsView() {
  const [data, setData] = useState<Overview | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/analytics/overview?days=${days}`);
    if (!res.ok) { setError("failed to load"); return; }
    setData(await res.json());
  }, [days]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const i = setInterval(refresh, 60_000);
    return () => clearInterval(i);
  }, [refresh]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (data.totals.postCount === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No analytics yet. The worker fetches metrics every 15 min for published posts.
        </p>
      </div>
    );
  }

  const t = data.totals;
  const fmt = (n: number) => n.toLocaleString();
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Last {days} days</h2>
        <select
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}d</option>)}
        </select>
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
