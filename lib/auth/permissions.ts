/**
 * Role-based authorization (docs/adr/0004). Three tiers, each user holds exactly
 * one, and a higher tier includes everything the lower tiers can do. This module
 * is PURE (no DB, no next-auth, no server-only imports) so it is edge-safe — the
 * middleware, API routes, and the client UI all share the same `can()` predicate.
 *
 *   super_admin — manages users + role assignment and edits system Settings
 *   editor      — the "RD": authors/edits Reports, writes raw SQL, declares params
 *   viewer      — the "operations" user: runs Reports, fills params, exports
 */
export const ROLES = ["viewer", "editor", "super_admin"] as const;
export type Role = (typeof ROLES)[number];

/** Rank encodes the hierarchy: a higher rank can do everything a lower rank can. */
const RANK: Record<Role, number> = { viewer: 0, editor: 1, super_admin: 2 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Everything a role might be allowed to do. Keep in sync with MIN_ROLE below. */
export type Action =
  | "report:list"
  | "report:run"
  | "report:create"
  | "report:edit"
  | "report:delete"
  | "user:manage"
  | "setting:manage";

/**
 * The minimum role each action requires. Because `can()` compares ranks, a role
 * automatically inherits every action of the roles beneath it — the hierarchy is
 * expressed once here, not repeated per role.
 */
const MIN_ROLE: Record<Action, Role> = {
  "report:list": "viewer",
  "report:run": "viewer",
  "report:create": "editor",
  "report:edit": "editor",
  "report:delete": "editor",
  "user:manage": "super_admin",
  "setting:manage": "super_admin",
};

/** True if `role` is allowed to perform `action`. */
export function can(role: Role, action: Action): boolean {
  return RANK[role] >= RANK[MIN_ROLE[action]];
}
