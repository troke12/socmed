import { SetupWizard } from "@/components/setup/SetupWizard";

export default function SetupPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Setup Wizard</h1>
        <p className="text-sm text-muted-foreground">
          Check that required env vars are set, then add accounts for the platforms you want.
        </p>
      </div>
      <SetupWizard />
    </div>
  );
}
