import { MediaLibraryView } from "@/components/media/MediaLibraryView";

export default function MediaPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Media Library</h1>
        <p className="text-sm text-muted-foreground">
          Everything you have uploaded, reusable across posts. Files are deduped by content,
          so re-uploading the same image reuses the original.
        </p>
      </div>
      <MediaLibraryView />
    </div>
  );
}
