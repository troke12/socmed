import { redirect } from "next/navigation";
import { trySession } from "@/lib/auth/require";
import { TokensView } from "@/components/tokens/TokensView";

export default async function TokensPage() {
  const user = await trySession();
  if (!user) redirect("/login");
  // /api/tokens enforces this again.
  if (user.role !== "admin") redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">API tokens</h1>
        <p className="text-sm text-muted-foreground">
          For calling the API from Zapier, Make, n8n, or a script. See API.md for the endpoints.
        </p>
      </div>
      <TokensView />
    </div>
  );
}
