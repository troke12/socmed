import { InboxView } from "@/components/inbox/InboxView";

export default function InboxPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Mentions and comments from all connected platforms. Reply directly from here.
        </p>
      </div>
      <InboxView />
    </div>
  );
}
