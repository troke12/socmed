import { redirect } from "next/navigation";
import { trySession } from "@/lib/auth/require";
import { twoFactorRequired } from "@/lib/auth/totp-policy";
import { SecurityView } from "@/components/security/SecurityView";

export default async function SecurityPage() {
  const user = await trySession();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Security</h1>
        <p className="text-sm text-muted-foreground">
          Settings for your own account, {user.username}.
        </p>
      </div>
      <SecurityView required={twoFactorRequired()} />
    </div>
  );
}
