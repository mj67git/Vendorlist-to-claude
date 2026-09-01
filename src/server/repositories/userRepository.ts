import { requirePrisma } from "../db/prisma.js";
import { generateSalt, hashPassword } from "../security/passwordService.js";

/**
 * The user accounts, and the shapes the rest of the server expects them in.
 *
 * `permissions` is the per-user override: empty means "follow the role", which
 * is the state every account was in before overrides existed — which is why
 * adding them needed no migration.
 *
 * Moved out of server.ts unchanged.
 */

export const DEFAULT_USERS: Array<{ username: string; password: string; role: string; name: string }> = [
  { username: "admin", password: "123456", role: "admin", name: "مدیر سیستم" },
  { username: "commercial", password: "123", role: "commercial", name: "واحد بازرگانی" },
  { username: "qa", password: "123", role: "qa", name: "واحد کیفیت" },
  { username: "planning", password: "123", role: "planning", name: "واحد برنامه‌ریزی و انبار" },
  { username: "finance", password: "123", role: "finance", name: "واحد مالی" },
];

export const ALLOWED_USER_ROLES = ["admin", "lab", "commercial", "qa", "planning", "finance"] as const;
export type UserRoleValue = (typeof ALLOWED_USER_ROLES)[number];

export function normalizeUserRole(role: any): UserRoleValue {
  return ALLOWED_USER_ROLES.includes(role) ? role : "commercial";
}

// Shape returned to endpoints; mirrors the legacy in-memory user record so the
// route handlers (and verifyPassword) keep working against a { hash, salt } pair.
export interface AppUser {
  username: string;
  name: string;
  role: string;
  password: { hash: string; salt: string };
  permissions: any;
  mustChangePassword: boolean;
  isActive: boolean;
  lastLoginAt: Date | null;
}

export function mapUserRow(row: any): AppUser {
  return {
    username: row.username,
    name: row.name,
    role: row.role,
    password: { hash: row.passwordHash, salt: row.passwordSalt },
    permissions: row.permissions ?? [],
    mustChangePassword: row.mustChangePassword !== false,
    // Both of these columns existed but were dropped here, which is why nothing
    // in the app could see them: an account could be marked inactive and still
    // sign in, and "last login" was never available to show.
    isActive: row.isActive !== false,
    lastLoginAt: row.lastLoginAt ?? null,
  };
}

export async function getUserByUsername(username: string): Promise<AppUser | null> {
  const prisma = requirePrisma();
  const row = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
  return row ? mapUserRow(row) : null;
}

export async function getAllUsers(): Promise<AppUser[]> {
  const prisma = requirePrisma();
  const rows = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(mapUserRow);
}

export async function seedDefaultUsers() {
  const prisma = requirePrisma();
  const count = await prisma.user.count();
  if (count > 0) return;
  console.log("[UsersDB] Seeding default users into PostgreSQL (first startup)...");
  for (const u of DEFAULT_USERS) {
    const salt = generateSalt();
    await prisma.user.create({
      data: {
        username: u.username.toLowerCase(),
        name: u.name,
        role: normalizeUserRole(u.role) as any,
        passwordHash: hashPassword(u.password, salt),
        passwordSalt: salt,
        mustChangePassword: true,
      },
    });
  }
}

