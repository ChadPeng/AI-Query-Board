"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { can, isRole, type Role } from "@/lib/auth/permissions";

export type NavKey =
  | "dashboard"
  | "explore"
  | "reports"
  | "models"
  | "knowledge"
  | "users"
  | "settings";

const ROLE_LABEL: Record<Role, string> = {
  viewer: "Viewer",
  editor: "Editor",
  super_admin: "Super Admin",
};

const S = 1.5; // 統一的 icon 線寬

const ICONS: Record<NavKey, React.ReactNode> = {
  dashboard: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth={S} />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth={S} />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth={S} />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth={S} />
    </svg>
  ),
  explore: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth={S} />
      <path d="M10.5 5.5L9 9L5.5 10.5L7 7L10.5 5.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  reports: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M9.5 1.5H4.5C3.94772 1.5 3.5 1.94772 3.5 2.5V13.5C3.5 14.0523 3.94772 14.5 4.5 14.5H11.5C12.0523 14.5 12.5 14.0523 12.5 13.5V4.5L9.5 1.5Z" stroke="currentColor" strokeWidth={S} strokeLinejoin="round" />
      <path d="M6 8.5H10M6 11H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  models: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <ellipse cx="8" cy="3.5" rx="5.5" ry="2" stroke="currentColor" strokeWidth={S} />
      <path d="M2.5 3.5V12.5C2.5 13.6 4.96 14.5 8 14.5C11.04 14.5 13.5 13.6 13.5 12.5V3.5" stroke="currentColor" strokeWidth={S} />
      <path d="M2.5 8C2.5 9.1 4.96 10 8 10C11.04 10 13.5 9.1 13.5 8" stroke="currentColor" strokeWidth={S} />
    </svg>
  ),
  knowledge: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 3C2 3 3.5 2 5.5 2C7.5 2 8 3 8 3V14C8 14 7.5 13 5.5 13C3.5 13 2 14 2 14V3Z" stroke="currentColor" strokeWidth={S} strokeLinejoin="round" />
      <path d="M14 3C14 3 12.5 2 10.5 2C8.5 2 8 3 8 3V14C8 14 8.5 13 10.5 13C12.5 13 14 14 14 14V3Z" stroke="currentColor" strokeWidth={S} strokeLinejoin="round" />
    </svg>
  ),
  users: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="5.5" cy="5" r="2.5" stroke="currentColor" strokeWidth={S} />
      <path d="M1.5 13.5C1.5 11.3 3.3 9.5 5.5 9.5C7.7 9.5 9.5 11.3 9.5 13.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
      <circle cx="11.5" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11 9.6C12.9 9.8 14.5 11.4 14.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth={S} />
      <path d="M13.3 8C13.3 7.6 13.26 7.2 13.18 6.83L14.6 5.72L13.27 3.42L11.6 4.1C11.03 3.6 10.36 3.21 9.62 3L9.33 1.2H6.67L6.38 3C5.64 3.21 4.97 3.6 4.4 4.1L2.73 3.42L1.4 5.72L2.82 6.83C2.74 7.2 2.7 7.6 2.7 8C2.7 8.4 2.74 8.8 2.82 9.17L1.4 10.28L2.73 12.58L4.4 11.9C4.97 12.4 5.64 12.79 6.38 13L6.67 14.8H9.33L9.62 13C10.36 12.79 11.03 12.4 11.6 11.9L13.27 12.58L14.6 10.28L13.18 9.17C13.26 8.8 13.3 8.4 13.3 8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
};

function NavItem({ href, active, icon, label }: { href: string; active: boolean; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className={`navitem ${active ? "active" : ""}`}>
      {icon}
      <span>{label}</span>
    </Link>
  );
}

/** 全站固定左側導覽列：依角色分區（分析／建模／管理），底部帳號區含登出。 */
export function Sidebar({ active }: { active: NavKey }) {
  const { data: session } = useSession();
  const role: Role = isRole(session?.user?.role) ? session.user.role : "viewer";
  const canAuthor = can(role, "report:create");
  const isSuper = role === "super_admin";
  const displayName = session?.user?.name || session?.user?.email || "";
  const initial = (displayName || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <nav className="sidebar">
      <div className="side-logo">
        <span className="logo-mark">
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
            <path d="M2 13.5V9M6 13.5V5.5M10 13.5V8M14 13.5V2.5" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="logo-name">
          <b>QueryBoard</b>
          <span>AI 數據分析</span>
        </span>
      </div>

      <span className="side-section">分析</span>
      <NavItem href="/" active={active === "dashboard"} icon={ICONS.dashboard} label="儀表板" />
      <NavItem href="/explore" active={active === "explore"} icon={ICONS.explore} label="探索" />
      <NavItem href="/reports" active={active === "reports"} icon={ICONS.reports} label="報表" />

      <span className="side-section">建模</span>
      {canAuthor && <NavItem href="/models" active={active === "models"} icon={ICONS.models} label="資料模型" />}
      <NavItem href="/knowledge" active={active === "knowledge"} icon={ICONS.knowledge} label="語意層" />

      {isSuper && (
        <>
          <span className="side-section">管理</span>
          <NavItem href="/admin/users" active={active === "users"} icon={ICONS.users} label="使用者" />
          <NavItem href="/admin/settings" active={active === "settings"} icon={ICONS.settings} label="系統設定" />
        </>
      )}

      <div className="side-spacer" />

      <div className="side-user">
        <span className="avatar">{initial}</span>
        <span className="who">
          <b title={session?.user?.email ?? undefined}>{displayName}</b>
          <span>{ROLE_LABEL[role]}</span>
        </span>
        <button
          type="button"
          className="icon-btn"
          title="登出"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path d="M6 14H3.5C2.94772 14 2.5 13.5523 2.5 13V3C2.5 2.44772 2.94772 2 3.5 2H6" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
            <path d="M10.5 11L13.5 8L10.5 5M13.5 8H6" stroke="currentColor" strokeWidth={S} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </nav>
  );
}

/** 內容頁外殼：側欄＋固定 56px 標題列＋可捲動內容。`bleed` 讓內容自行掌控排版（如主從式）。 */
export function AppShell({
  active,
  title,
  subtitle,
  actions,
  bleed = false,
  children,
}: {
  active: NavKey;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  bleed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="shell">
      <Sidebar active={active} />
      <section className="shell-main">
        <header className="shell-header">
          <div className="head-title">
            <h1>{title}</h1>
            {subtitle && <span className="page-hint">{subtitle}</span>}
          </div>
          {actions && <div className="header-actions">{actions}</div>}
        </header>
        <div className={`shell-content ${bleed ? "bleed" : ""}`}>
          {bleed ? children : <div className="page-body">{children}</div>}
        </div>
      </section>
    </main>
  );
}
