import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";
import { getUserByEmail } from "./lib/state/users";

/**
 * Full Auth.js setup (Node runtime). The Credentials authorize callback queries
 * the state DB and verifies the bcrypt hash — we never roll our own session or
 * crypto; Auth.js signs the JWT session cookie and handles CSRF.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (creds) => {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;

        const user = await getUserByEmail(email);
        if (!user) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return { id: String(user.id), email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
});
