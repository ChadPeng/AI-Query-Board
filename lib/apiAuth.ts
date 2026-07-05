import { auth } from "@/auth";

/**
 * True when a request is from a logged-in user. The Semantic Layer is global and
 * any authenticated user may edit it (docs/adr/0002), so routes only need "is
 * there a session?", not a user id.
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user?.id);
}
