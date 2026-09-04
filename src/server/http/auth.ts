import jwt from "jsonwebtoken";
import { can, type Permission } from "../../utils/permissions.js";
import { JWT_SECRET } from "../security/jwtSecret.js";
import { getAllUsers, getUserByUsername } from "../repositories/userRepository.js";
import { requirePrisma } from "../db/prisma.js";
import { setCurrentSession } from "./requestContext.js";

/**
 * Who may do what, enforced.
 *
 * The gates in the UI are a courtesy — `currentUser` is read from localStorage
 * and can be edited in devtools — so these are the controls. Two rules are
 * easy to get wrong and both were, once:
 *
 *   - 401 and 403 mean different things. 401 says "I do not know who you are"
 *     and the client ends the session on it; 403 says "I know, and no" and the
 *     client stays signed in. Returning 403 for an expired token logged people
 *     out of pages they were allowed to use.
 *   - The account is read from the DATABASE, never from the token. The token
 *     lives seven days, so trusting its `role` meant a demoted or deactivated
 *     administrator kept full access for up to a week.
 *
 * Moved out of server.ts unchanged.
 */

export function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Access Denied: Security token is missing or not provided" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    // Which sign-in this request belongs to, for the audit records it writes.
    // Tokens issued before sessions were identified carry no `sid`, and those
    // requests stay unattributed rather than being given an invented one.
    setCurrentSession(decoded?.sid);
    next();
  } catch (err) {
    // 401, not 403: the token is missing or no longer verifies, which is a
    // failure to authenticate. 403 is reserved for a known user who is not
    // allowed to do this, so the client can tell the two apart.
    return res.status(401).json({ error: "Access Denied: Session integrity verification failed" });
  }
}

/**
 * Restrict a route to specific roles. Chain it after requireAuth, which is what
 * populates req.user from the token.
 *
 * The role checks the UI performs are for usability only: currentUser is read
 * from localStorage and can be edited in devtools, so the server has to be the
 * one that decides. Without this every signed-in user could reach the user
 * endpoints and grant themselves admin — which would undermine the audit trail,
 * since its value rests on access control being trustworthy.
 */
/**
 * Refuse changes that would leave nobody able to administer the system.
 *
 * Without these an admin can lock the whole organisation out of user
 * management with one click — demote or close the only admin account and there
 * is no longer any route back in short of editing the database by hand.
 * Returns a message when the change must be refused, or null when it is safe.
 */
export async function checkAdminSafety(
  actor: { username: string },
  targetUsername: string,
  change: { role?: string; isActive?: boolean; deleting?: boolean },
): Promise<string | null> {
  const target = targetUsername.toLowerCase();
  const isSelf = actor.username.toLowerCase() === target;

  if (isSelf) {
    if (change.deleting) return "حذف حساب کاربری خودتان امکان‌پذیر نیست.";
    if (change.isActive === false) return "غیرفعال‌کردن حساب کاربری خودتان امکان‌پذیر نیست.";
    if (change.role && change.role !== "admin") return "تغییر نقش خودتان از مدیر سیستم امکان‌پذیر نیست.";
  }

  const losesAdmin =
    change.deleting || change.isActive === false || (change.role && change.role !== "admin");
  if (!losesAdmin) return null;

  const current = await getUserByUsername(target);
  if (!current || current.role !== "admin" || current.isActive === false) return null;

  const activeAdmins = await requirePrisma().user.count({
    where: { role: "admin" as any, isActive: true },
  });
  if (activeAdmins <= 1) {
    return "این تنها مدیر فعال سامانه است؛ ابتدا یک مدیر دیگر تعریف یا فعال کنید.";
  }
  return null;
}

/**
 * Restrict a route to the roles holding a permission, read from the shared
 * policy table that the UI reads too. The UI hides what a role cannot do; this
 * is what actually prevents it — a hidden button is still a reachable endpoint.
 */
/**
 * Refuse a permission change that would leave nobody able to administer users.
 *
 * `users.manage` is the way back in: strip it from the last account that holds
 * it and the only remaining route to user management is the database.
 */
export async function checkPermissionSafety(
  actor: { username: string },
  targetUsername: string,
  nextPermissions: Permission[],
): Promise<string | null> {
  const target = targetUsername.toLowerCase();
  const keepsAdmin = nextPermissions.includes("users.manage");
  if (keepsAdmin) return null;

  if (actor.username.toLowerCase() === target) {
    return "برداشتن دسترسی «مدیریت کاربران» از حساب خودتان امکان‌پذیر نیست.";
  }

  const current = await getUserByUsername(target);
  if (!current || current.isActive === false) return null;
  if (!can(current, "users.manage")) return null;

  const others = (await getAllUsers()).filter(
    u => u.username.toLowerCase() !== target && u.isActive !== false && can(u, "users.manage"),
  );
  if (others.length === 0) {
    return "این تنها حساب دارای دسترسی «مدیریت کاربران» است؛ ابتدا این دسترسی را به کاربر دیگری بدهید.";
  }
  return null;
}

export function requirePermission(permission: Permission) {
  return async function (req: any, res: any, next: any) {
    // The account is loaded rather than read off the token. The token lives for
    // seven days and carries only the role, so an admin's change to someone's
    // permissions would not take effect until it expired — which would defeat
    // the point of being able to change them. This is one primary-key lookup on
    // write requests; reads do not go through here.
    try {
      const account = await getUserByUsername(req.user?.username || "");
      if (!account || account.isActive === false) {
        return res.status(401).json({ error: "این حساب کاربری دیگر معتبر نیست." });
      }
      if (!can(account, permission)) {
        return res.status(403).json({
          error: "عدم دسترسی: سطح دسترسی شما اجازهٔ انجام این عملیات را نمی‌دهد.",
        });
      }
      req.account = account;
      next();
    } catch (err: any) {
      console.error("Permission check failed:", err);
      return res.status(500).json({ error: "بررسی سطح دسترسی با خطا مواجه شد." });
    }
  };
}

/**
 * Restrict a route to specific roles, reading the role from the DATABASE.
 *
 * It used to read `req.user.role` straight off the token. The token lives for
 * seven days and carries the role it was issued with, so an admin who was
 * demoted — or deactivated entirely — kept full access to every user-management
 * endpoint for up to a week, with no way to cut them off short of rotating
 * JWT_SECRET and signing everyone out. `requirePermission` already loads the
 * account for exactly this reason; the two guards disagreeing was the bug.
 *
 * The cost is one primary-key lookup on the seven admin routes.
 */
export function requireRole(...roles: string[]) {
  return async function (req: any, res: any, next: any) {
    try {
      const account = await getUserByUsername(req.user?.username || "");
      if (!account || account.isActive === false) {
        // 401, not 403: the identity itself is no longer valid, so the client
        // should end the session rather than keep a signed-in user around.
        return res.status(401).json({ error: "این حساب کاربری دیگر معتبر نیست." });
      }
      if (!roles.includes(account.role)) {
        return res.status(403).json({
          error: "عدم دسترسی: این عملیات فقط برای مدیران سیستم مجاز است.",
        });
      }
      req.account = account;
      next();
    } catch (err: any) {
      console.error("Role check failed:", err);
      return res.status(500).json({ error: "بررسی سطح دسترسی با خطا مواجه شد." });
    }
  };
}

/**
 * The answer for an error that escaped a route handler.
 *
 * A lost-update conflict is not a server fault — it means someone else saved
 * first — so it gets 409 and says so in words the operator can act on. The
 * client treats any non-ok answer as a refusal now, so this reaches the screen
 * instead of vanishing. Everything else keeps the behaviour it had.
 */
