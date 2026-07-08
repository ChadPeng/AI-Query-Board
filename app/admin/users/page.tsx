"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ROLES, type Role } from "@/lib/auth/permissions";

interface UserSummary {
  id: number;
  email: string;
  name: string | null;
  role: Role;
}

const ROLE_LABEL: Record<Role, string> = {
  viewer: "Viewer（營運）",
  editor: "Editor（RD）",
  super_admin: "Super Admin（超管）",
};

export default function AdminUsersPage() {
  const { data: session } = useSession();
  const myId = session?.user?.id ? Number(session.user.id) : null;
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "載入失敗");
        return;
      }
      const d = await res.json();
      setUsers(d.users ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function changeRole(id: number, role: Role) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "更新失敗");
        await load(); // revert optimistic UI to server truth
        return;
      }
      setUsers((prev) => prev?.map((u) => (u.id === id ? { ...u, role } : u)) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className="knowledge">
      <div className="kn-top">
        <h1 className="cyber-glitch" data-text="使用者">
          使用者
        </h1>
        <span className="header-actions">
          <Link href="/" className="link-btn">
            ← 回儀表板
          </Link>
        </span>
      </div>
      <p className="kn-sub">
        指派角色決定誰能做什麼：Viewer 只能跑報表、Editor（RD）可建立與編輯報表並寫 SQL、
        Super Admin 另可管理使用者與系統設定。上位角色涵蓋下位的所有權限。
      </p>

      {error && <div className="unreviewed-banner">{error}</div>}

      {!users && !error && <div className="kn-empty">載入中…</div>}

      {users && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>名稱</th>
                <th>角色</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = myId === u.id;
                return (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.name ?? "—"}</td>
                    <td>
                      <select
                        className="kn-select"
                        value={u.role}
                        disabled={isSelf || savingId === u.id}
                        title={isSelf ? "無法變更自己的角色" : undefined}
                        onChange={(e) => changeRole(u.id, e.target.value as Role)}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                      {isSelf && " （你自己）"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
