import { auth } from "@/auth";
import { can, isRole, type Action, type Role } from "./auth/permissions";

/**
 * True when a request is from a logged-in user. The Semantic Layer is global and
 * any authenticated user may edit it (docs/adr/0002), so routes only need "is
 * there a session?", not a user id.
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user?.id);
}

/** The logged-in user's id + role, or null if unauthenticated. */
export async function currentUser(): Promise<{ id: number; role: Role } | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return { id: Number(id), role: isRole(session.user.role) ? session.user.role : "viewer" };
}

/**
 * True when the logged-in user may perform `action` (docs/adr/0004). Use in API
 * routes as the authorization gate; returns false for unauthenticated requests.
 */
export async function authorizeAction(action: Action): Promise<boolean> {
  const user = await currentUser();
  return user ? can(user.role, action) : false;
}
