import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { runStateMigrations } from "@/lib/state/migrate";
import { statePool } from "@/lib/db";
import { createUser, getUserByEmail } from "@/lib/state/users";

export async function POST(request: Request) {
  let email = "";
  let password = "";
  let name: string | null = null;
  try {
    const body = await request.json();
    email = String(body?.email ?? "").trim().toLowerCase();
    password = String(body?.password ?? "");
    name = body?.name ? String(body.name).trim() : null;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "請輸入有效的 email" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "密碼至少 8 個字元" }, { status: 400 });
  }

  const pool = statePool();
  if (!pool) {
    return NextResponse.json(
      { error: "狀態資料庫未設定（STATE_DB_* 環境變數）" },
      { status: 503 },
    );
  }

  try {
    // Idempotent: ensures the users table exists before the first registration.
    await runStateMigrations(pool);

    if (await getUserByEmail(email)) {
      return NextResponse.json({ error: "此 email 已被註冊" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await createUser(email, passwordHash, name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: `註冊失敗：${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
