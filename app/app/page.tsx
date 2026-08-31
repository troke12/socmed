import { redirect } from "next/navigation";
import { parseSessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { cookies } from "next/headers";

export default function HomePage() {
  const session = parseSessionCookie(cookies().get(SESSION_COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  redirect("/accounts");
}
