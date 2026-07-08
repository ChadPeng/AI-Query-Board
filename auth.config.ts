import type { NextAuthConfig } from "next-auth";
import { can, isRole, type Role } from "./lib/auth/permissions";

/**
 * Edge-safe Auth.js config: no DB or bcrypt imports here, so it can be used by
 * the middleware (Edge runtime). The Credentials provider's authorize (which
 * needs MySQL + bcrypt, Node-only) lives in auth.ts.
 */
export const authConfig = {
  // Self-hosted behind a known host/proxy (PRD §5, 內網自架) — trust the host
  // header. (Vercel sets this automatically; self-hosted must opt in.)
  trustHost: true,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [], // real providers added in auth.ts
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      if (user && isRole(user.role)) token.role = user.role;
      return token;
    },
    session({ session, token }) {
      const uid = typeof token.uid === "string" ? token.uid : undefined;
      if (uid && session.user) session.user.id = uid;
      // Default to the least-privileged tier if a token predates the role claim.
      if (session.user) session.user.role = isRole(token.role) ? token.role : "viewer";
      return session;
    },
    /**
     * Route gating: everything requires login except the public paths below.
     * The /admin area (pages + API) additionally requires super_admin — a
     * logged-in user without it is sent home (pages) or gets a 403 (API).
     */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic =
        pathname.startsWith("/login") ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/register");
      if (isPublic) return true;
      if (!auth?.user) return false;

      const isAdminArea = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
      if (isAdminArea) {
        const role: Role = isRole(auth.user.role) ? auth.user.role : "viewer";
        if (!can(role, "user:manage")) {
          if (pathname.startsWith("/api")) {
            return Response.json({ error: "需要管理員權限" }, { status: 403 });
          }
          return Response.redirect(new URL("/", request.nextUrl));
        }
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
