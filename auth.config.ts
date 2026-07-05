import type { NextAuthConfig } from "next-auth";

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
      return token;
    },
    session({ session, token }) {
      const uid = typeof token.uid === "string" ? token.uid : undefined;
      if (uid && session.user) session.user.id = uid;
      return session;
    },
    /** Route gating: everything requires login except the public paths below. */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic =
        pathname.startsWith("/login") ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/register");
      if (isPublic) return true;
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
