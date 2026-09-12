import { randomBytes } from "node:crypto";
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

/**
 * The one account a fresh installation needs, and nothing more.
 *
 * Four departmental accounts used to be provisioned beside the administrator,
 * all of them with the password `123`, on any database whose `users` table was
 * empty — which is every new production installation. The deployment guide
 * announced the administrator's password and said nothing about the other
 * four, so a site could go live with four working sign-ins nobody had been
 * told existed.
 *
 * The remaining account's password is generated per installation and printed
 * once to the server log rather than written here, so it is not a value anyone
 * can look up in the source. The real accounts are created by the
 * administrator, in the user-management screen, with the units the site
 * actually has.
 */
export const DEFAULT_USERS: Array<{ username: string; role: string; name: string }> = [
  { username: "admin", role: "admin", name: "مدیر سیستم" },
];

/**
 * A first password that is not a secret anyone else already knows.
 *
 * Readable rather than maximally dense on purpose: somebody has to copy it out
 * of a server log once and type it in. It is single-use — the account is
 * created with `mustChangePassword`, and the server now enforces that rather
 * than merely asking (see `requireAuth`).
 */
function generateInitialPassword(): string {
  // Ambiguous characters left out: no O/0, no I/l/1.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(20);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}

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
  console.log("[UsersDB] Seeding the administrator account into PostgreSQL (first startup)...");
  for (const u of DEFAULT_USERS) {
    const salt = generateSalt();
    const password = process.env.VLSE_INITIAL_ADMIN_PASSWORD || generateInitialPassword();
    await prisma.user.create({
      data: {
        username: u.username.toLowerCase(),
        name: u.name,
        role: normalizeUserRole(u.role) as any,
        passwordHash: hashPassword(password, salt),
        passwordSalt: salt,
        mustChangePassword: true,
      },
    });
    // The only time this value is ever readable. It is not stored anywhere in
    // plain form and cannot be recovered — if it is missed, the account is
    // reset by deleting the row and restarting, not by looking it up.
    console.log(
      "\n" +
      "  ┌────────────────────────────────────────────────────────────┐\n" +
      "  │  VLSE — حساب مدیر سیستم ساخته شد                            │\n" +
      "  ├────────────────────────────────────────────────────────────┤\n" +
      `  │  نام کاربری: ${u.username.padEnd(46)}│\n` +
      `  │  رمز اولیه:  ${password.padEnd(46)}│\n` +
      "  │                                                            │\n" +
      "  │  این رمز فقط همین یک‌بار چاپ می‌شود و در اولین ورود        │\n" +
      "  │  تغییرش اجباری است. در ایمیل یا تیکت نفرستید.              │\n" +
      "  └────────────────────────────────────────────────────────────┘\n",
    );
  }
}

