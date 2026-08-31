import { ComposeView } from "@/components/compose/ComposeView";

export default function ComposePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Compose</h1>
        <p className="text-sm text-muted-foreground">
          Draft a post, attach media, pick an account, and publish or schedule.
        </p>
      </div>
      <ComposeView />
    </div>
  );
}
