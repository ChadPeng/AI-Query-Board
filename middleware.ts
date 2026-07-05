import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Edge-safe: only the authorized() callback runs here. Unauthenticated requests
// to non-public paths are redirected to /login.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
