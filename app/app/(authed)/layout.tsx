import Link from "next/link";
import { redirect } from "next/navigation";
import { trySession } from "@/lib/auth/require";
import { logoutAction } from "@/app/(authed)/actions";
import { atLeast, type Role } from "@/lib/auth/roles";
import {
  Users,
  PenSquare,
  CalendarDays,
  BarChart3,
  Inbox,
  Repeat,
  Images,
  UserCog,
  LogOut,
  LayoutGrid,
} from "lucide-react";

// `minRole` hides a link the user cannot use. It is presentation only — each
// page and API route enforces the same rule again on the server.
const NAV: { href: string; label: string; icon: typeof Users; minRole: Role }[] = [
  { href: "/setup", label: "Setup Wizard", icon: LayoutGrid, minRole: "admin" },
  { href: "/accounts", label: "Accounts", icon: Users, minRole: "viewer" },
  { href: "/compose", label: "Compose", icon: PenSquare, minRole: "editor" },
  { href: "/media", label: "Media", icon: Images, minRole: "viewer" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, minRole: "viewer" },
  { href: "/schedules", label: "Schedules", icon: Repeat, minRole: "viewer" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, minRole: "viewer" },
  { href: "/inbox", label: "Inbox", icon: Inbox, minRole: "viewer" },
  { href: "/users", label: "Users", icon: UserCog, minRole: "admin" },
];

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  // trySession resolves the cookie against a live user row, so a deleted or
  // disabled account is bounced to /login on its very next navigation.
  const user = await trySession();
  if (!user) redirect("/login");
  const nav = NAV.filter((item) => atLeast(user.role, item.minRole));

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-card md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            S
          </div>
          <span className="text-sm font-semibold">socmed</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="px-3 pb-2 text-xs text-muted-foreground">
            {user.username} · {user.role}
          </div>
          <form action={logoutAction}>
            <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col md:pl-60">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-card/95 px-4 backdrop-blur md:hidden">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            S
          </div>
          <span className="text-sm font-semibold">socmed</span>
          <div className="ml-auto flex gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md p-2 text-muted-foreground hover:bg-accent"
                title={item.label}
              >
                <item.icon className="h-4 w-4" />
              </Link>
            ))}
            <form action={logoutAction}>
              <button className="rounded-md p-2 text-muted-foreground hover:bg-accent">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
