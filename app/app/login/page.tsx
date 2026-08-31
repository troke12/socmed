import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Left: brand panel — DESIGN.md signature surface card */}
      <div className="hidden flex-col justify-between bg-primary p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-bold text-primary">
            S
          </div>
          <span className="text-lg font-medium">socmed</span>
        </div>
        <div className="max-w-md space-y-4">
          <h1 className="text-4xl font-medium leading-tight tracking-tight">
            One place for every platform.
          </h1>
          <p className="text-white/70">
            Draft, schedule, publish, and engage across X, LinkedIn, Instagram, Facebook,
            Threads, TikTok, YouTube, Pinterest, Reddit, Mastodon, Bluesky, and Discord.
          </p>
        </div>
        <p className="text-xs text-white/50">Self-hosted social media content management</p>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                S
              </div>
              <span className="text-lg font-medium">socmed</span>
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-medium tracking-tight">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">Single-user dashboard.</p>
          </div>
          <LoginForm next={searchParams.next ?? "/"} />
        </div>
      </div>
    </div>
  );
}
