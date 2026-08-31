import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  return (
    <main className="container flex min-h-screen flex-col items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">Single-user dashboard.</p>
        </div>
        <LoginForm next={searchParams.next ?? "/"} />
      </div>
    </main>
  );
}
