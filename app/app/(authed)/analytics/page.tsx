import { AnalyticsView } from "@/components/analytics/AnalyticsView";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Engagement, reach, and conversion across all connected platforms.
          </p>
        </div>
      </div>
      <AnalyticsView />
    </div>
  );
}
