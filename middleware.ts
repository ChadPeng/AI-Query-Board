import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Edge-safe: only the authorized() callback runs here. Unauthenticated requests
// to non-public paths are redirected to /login.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Run on everything except Next internals, static assets, and Auth.js's own
  // routes — /api/auth/* already runs the full Auth.js handler; letting the
  // middleware run there too makes both layers write session/CSRF cookies on
  // the same response (e.g. sign-out both re-issuing and clearing the session).
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
