import { redirect } from "next/navigation";
import { trySession } from "@/lib/auth/require";
import { approvalRequired } from "@/lib/review";
import { ReviewView } from "@/components/review/ReviewView";

export default async function ReviewPage() {
  const user = await trySession();
  if (!user) redirect("/login");
  // Approving is an admin action; the API enforces this again.
  if (user.role !== "admin") redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-sm text-muted-foreground">
          Posts submitted by editors, waiting for an admin to approve or send back.
        </p>
      </div>
      <ReviewView approvalRequired={approvalRequired()} />
    </div>
  );
}
