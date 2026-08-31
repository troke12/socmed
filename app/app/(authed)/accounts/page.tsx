import { AccountsView } from "@/components/accounts/AccountsView";

export default function AccountsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Connect a social account by entering credentials. M3 wires real OAuth flows per platform.
        </p>
      </div>
      <AccountsView />
    </div>
  );
}
