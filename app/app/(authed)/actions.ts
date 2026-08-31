"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function logoutAction(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  redirect("/login");
}
