import { SchedulesView } from "@/components/schedules/SchedulesView";

export default function SchedulesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Schedules</h1>
        <p className="text-sm text-muted-foreground">
          Recurring rules that re-publish an evergreen post on a repeating cadence.
        </p>
      </div>
      <SchedulesView />
    </div>
  );
}
