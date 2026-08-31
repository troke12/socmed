import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  PenSquare,
  BarChart3,
  Inbox,
  CalendarDays,
  LayoutGrid,
  ArrowRight,
} from "lucide-react";

export default function HomePage() {
  const cards = [
    { href: "/setup", title: "Setup Wizard", desc: "Check env vars, generate keys, get started", icon: LayoutGrid },
    { href: "/accounts", title: "Connect accounts", desc: "12 platforms — OAuth or bot tokens", icon: Users },
    { href: "/compose", title: "Compose a post", desc: "Draft, attach media, schedule or publish", icon: PenSquare },
    { href: "/analytics", title: "Analytics", desc: "Impressions, engagement, top posts", icon: BarChart3 },
    { href: "/inbox", title: "Inbox", desc: "Mentions and comments, reply in place", icon: Inbox },
    { href: "/calendar", title: "Calendar", desc: "Everything scheduled and published", icon: CalendarDays },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Welcome to socmed</h1>
        <p className="text-sm text-muted-foreground">
          Draft, schedule, publish, and engage across 12 social platforms from one place.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="group">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <c.icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">{c.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{c.desc}</CardDescription>
                <div className="mt-3 flex items-center gap-1 text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Open <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
