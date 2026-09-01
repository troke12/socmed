import { redirect } from "next/navigation";
import { trySession } from "@/lib/auth/require";
import { UsersView } from "@/components/users/UsersView";

export default async function UsersPage() {
  const user = await trySession();
  // The layout only hides the nav link; a non-admin who types the URL still has
  // to be turned away here. /api/users enforces it again server-side.
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Who can sign in, and what each of them is allowed to do.
        </p>
      </div>
      <UsersView currentUserId={user.id} />
    </div>
  );
}
