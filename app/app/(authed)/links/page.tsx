import { LinksView } from "@/components/links/LinksView";

export default function LinksPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Links</h1>
        <p className="text-sm text-muted-foreground">
          Short links minted at publish time, and how many clicks each one drove.
        </p>
      </div>
      <LinksView />
    </div>
  );
}
