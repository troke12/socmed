import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, parseSessionCookie } from "@/lib/auth/session";
import { logoutAction } from "@/app/(authed)/actions";

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  const session = parseSessionCookie(cookies().get(SESSION_COOKIE_NAME)?.value);
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-semibold">socmed</Link>
            <nav className="flex gap-4 text-sm text-muted-foreground">
              <Link href="/setup">Setup</Link>
              <Link href="/accounts">Accounts</Link>
              <Link href="/compose">Compose</Link>
              <Link href="/calendar">Calendar</Link>
              <Link href="/analytics">Analytics</Link>
              <Link href="/inbox">Inbox</Link>
            </nav>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="text-sm text-muted-foreground hover:text-foreground">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="container py-8">{children}</main>
    </div>
  );
}
