import express from "express";
import { AuditService } from "../../utils/auditService.js";
import {
  ALL_PERMISSIONS, effectivePermissions, sanitizePermissions, type Permission,
} from "../../utils/permissions.js";
import { requirePrisma } from "../db/prisma.js";
import {
  checkAdminSafety, checkPermissionSafety, requireAuth, requirePermission,
} from "../http/auth.js";
import { sendHandlerError } from "../http/errors.js";
import { getClientIp, getUserAgent } from "../http/requestInfo.js";
import {
  ALLOWED_USER_ROLES, getAllUsers, getUserByUsername, normalizeUserRole,
  type UserRoleValue,
} from "../repositories/userRepository.js";
import { generateSalt, hashPassword } from "../security/passwordService.js";

/**
 * Account administration.
 *
 * Guarded by the `users.manage` permission, read from the database rather than
 * from the token — a seven-day token would otherwise keep a demoted
 * administrator in charge for a week.
 *
 * It used to be `requireRole("admin")`, which made the permission decorative:
 * granting `users.manage` to a department head did nothing, and removing it
 * from an administrator did not shut the door. Meanwhile the sidebar showed the
 * module to anyone holding the permission, so the screen offered a page the
 * server refused — the exact divergence the shared policy table exists to
 * prevent (rule 14).
 *
 * `checkAdminSafety` and `checkPermissionSafety` are the reason an
 * organisation cannot lock itself out: nobody can delete, deactivate or demote
 * the last administrator, or take `users.manage` from its last holder.
 *
 * One power stays with the role: only an account whose own role is `admin` may
 * hand out the `admin` role (see `refuseAdminGrant`). Delegating account
 * administration should not be a way to mint administrators.
 */

/**
 * Only an administrator may make another administrator.
 *
 * `users.manage` can now be delegated, and a delegate can already grant
 * individual permissions — but the `admin` role is more than the sum of them:
 * a handful of checks still read the role itself, and `checkAdminSafety`
 * counts admins to decide whether the organisation still has one. Handing that
 * out is a decision for someone who already holds it.
 *
 * Returns the refusal message, or null when the change is allowed.
 */
function refuseAdminGrant(actor: any, nextRole: string | undefined): string | null {
  if (nextRole !== "admin") return null;
  if (actor?.role === "admin") return null;
  return "تعیین نقش «مدیر سیستم» فقط از حساب مدیر سیستم امکان‌پذیر است.";
}

export function userRoutes(): express.Router {
  const router = express.Router();

  router.get("/api/users", requireAuth, requirePermission("users.manage"), async (req: any, res) => {
    try {
      const usersList = (await getAllUsers()).map(u => ({
        username: u.username,
        name: u.name,
        role: u.role,
        permissions: sanitizePermissions(u.permissions),
        effectivePermissions: effectivePermissions(u),
        mustChangePassword: u.mustChangePassword !== false,
        isActive: u.isActive !== false,
        lastLoginAt: u.lastLoginAt || null
      }));
      res.json(usersList);
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  router.post("/api/users", requireAuth, requirePermission("users.manage"), async (req: any, res) => {
    try {
      const { username, name, role, password, permissions, reasonForChange } = req.body;
      if (!username || !name || !role) {
        return res.status(400).json({ error: "فیلدهای username، name و role الزامی هستند." });
      }

      // These rules used to live only in the React form, so the endpoint itself
      // accepted a username with spaces, a one-character password, an unknown
      // role (silently coerced to `commercial` while the response echoed back
      // the invalid one) and permission names that exist nowhere. Rule 14: the
      // server is where access rules are enforced, the form is only UX.
      const cleanName = String(name).trim();
      if (!cleanName) {
        return res.status(400).json({ error: "نام و نام خانوادگی الزامی است." });
      }
      const key = String(username).trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,}$/.test(key)) {
        return res.status(400).json({
          error: "نام کاربری باید حداقل ۳ کاراکتر و فقط شامل حروف لاتین، عدد، نقطه، خط تیره یا زیرخط باشد.",
        });
      }
      if (!ALLOWED_USER_ROLES.includes(role)) {
        return res.status(400).json({
          error: `سمت سازمانی نامعتبر است. مقادیر مجاز: ${ALLOWED_USER_ROLES.join("، ")}`,
        });
      }
      // An omitted password falls back to the shared default, which the account
      // must change on first sign-in; a supplied one has to be a real password.
      if (password !== undefined && String(password).length < 6) {
        return res.status(400).json({ error: "کلمه عبور اولیه باید حداقل ۶ کاراکتر باشد." });
      }
      if (permissions !== undefined && !Array.isArray(permissions)) {
        return res.status(400).json({ error: "فیلد permissions باید یک آرایه باشد." });
      }

      const refusedOnCreate = refuseAdminGrant(req.account, role);
      if (refusedOnCreate) return res.status(403).json({ error: refusedOnCreate });

      if (await getUserByUsername(key)) {
        return res.status(400).json({ error: "کاربری با این نام کاربری قبلاً تعریف شده است." });
      }

      const uSalt = generateSalt();
      const uPassword = password || "123456";
      const newUser = {
        username: key,
        name: cleanName,
        role: role as UserRoleValue,
        // Unknown names are dropped rather than stored, exactly as in PATCH and
        // PUT /permissions — this was the one write path that skipped it.
        permissions: sanitizePermissions(permissions),
        mustChangePassword: true
      };

      await requirePrisma().user.create({
        data: {
          username: key,
          name: cleanName,
          role: newUser.role as any,
          passwordHash: hashPassword(uPassword, uSalt),
          passwordSalt: uSalt,
          permissions: newUser.permissions,
          mustChangePassword: true,
        },
      });

      // Log creation to Audit Trail
      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت کاربران",
        action: "CREATE_USER",
        severity: "Information",
        description: `کاربر جدید با نام کاربری ${key} و سمت ${newUser.role} توسط ${req.user.name} ایجاد شد.`,
        entityType: "User",
        entityId: key,
        entityName: cleanName,
        eventType: "Authorization",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        reasonForChange: reasonForChange || "تعریف دسترسی پرسنل جدید فرآیندی",
        beforeData: null,
        afterData: { username: key, name: cleanName, role: newUser.role, permissions: newUser.permissions }
      });

      // The stored record, not the submitted one: the response used to echo the
      // request back, so an invalid role reached the client as if it had been
      // accepted and the table showed it until the next reload.
      res.json({
        success: true,
        user: {
          username: key,
          name: cleanName,
          role: newUser.role,
          permissions: newUser.permissions,
          effectivePermissions: effectivePermissions({ role: newUser.role, permissions: newUser.permissions } as any),
        },
      });
    } catch (err: any) {
      console.error("Failed to create user:", err);
      res.status(500).json({ error: err.message });
    }
  });

  router.patch("/api/users/:username", requireAuth, requirePermission("users.manage"), async (req: any, res) => {
    try {
      const targetUsername = req.params.username.toLowerCase();
      const current = await getUserByUsername(targetUsername);
      if (!current) {
        return res.status(404).json({ error: "کاربر یافت نشد" });
      }

      const { name, role, permissions, isActive, reasonForChange } = req.body;
      const originalData = {
        name: current.name,
        role: current.role,
        permissions: current.permissions || [],
        isActive: current.isActive !== false,
      };

      const refusedOnPatch = refuseAdminGrant(req.account, role);
      if (refusedOnPatch) return res.status(403).json({ error: refusedOnPatch });

      const unsafe = await checkAdminSafety(req.user, targetUsername, { role, isActive });
      if (unsafe) return res.status(400).json({ error: unsafe });

      if (name) current.name = name;
      if (typeof isActive === "boolean") current.isActive = isActive;

      const roleChanged = !!role && role !== current.role;
      if (role) current.role = role;

      if (permissions) {
        current.permissions = sanitizePermissions(permissions);
      } else if (roleChanged) {
        // Moving someone to a new role clears their old exceptions. Carrying
        // them across would silently follow a person into a different job —
        // the new role's template is the honest starting point.
        current.permissions = [];
      }

      await requirePrisma().user.update({
        where: { username: targetUsername },
        data: {
          name: current.name,
          role: normalizeUserRole(current.role) as any,
          permissions: current.permissions ?? [],
          isActive: current.isActive !== false,
        },
      });

      // Log update to Audit Trail
      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت کاربران",
        action: "UPDATE_USER",
        severity: "Warning",
        description: `مشخصات حساب کاربری ${targetUsername} توسط ${req.user.name} ویرایش گردید.`,
        entityType: "User",
        entityId: targetUsername,
        entityName: current.name,
        eventType: "Authorization",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        reasonForChange: reasonForChange || "بروزرسانی سمت سازمانی / دسترسی‌های سیستمی",
        beforeData: originalData,
        afterData: { name: current.name, role: current.role, permissions: current.permissions || [], isActive: current.isActive !== false }
      });

      res.json({
        success: true,
        permissionsReset: roleChanged && !permissions,
        user: {
          username: current.username, name: current.name, role: current.role,
          permissions: sanitizePermissions(current.permissions),
          effectivePermissions: effectivePermissions(current),
          isActive: current.isActive !== false,
        },
      });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  router.delete("/api/users/:username", requireAuth, requirePermission("users.manage"), async (req: any, res) => {
    try {
      const targetUsername = req.params.username.toLowerCase();
      const current = await getUserByUsername(targetUsername);
      if (!current) {
        return res.status(404).json({ error: "کاربر یافت نشد" });
      }

      const unsafeDelete = await checkAdminSafety(req.user, targetUsername, { deleting: true });
      if (unsafeDelete) return res.status(400).json({ error: unsafeDelete });

      const reasonForChange = req.query.reasonForChange as string || "حذف دسترسی پرسنل تسویه شده";
      const beforeData = { username: current.username, name: current.name, role: current.role, permissions: current.permissions || [] };

      await requirePrisma().user.delete({ where: { username: targetUsername } });

      // Log deletion to Audit Trail
      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت کاربران",
        action: "DELETE_USER",
        severity: "Critical",
        description: `حساب کاربری پرسنل با نام کاربری ${targetUsername} توسط ${req.user.name} به طور کامل از سامانه حذف گردید.`,
        entityType: "User",
        entityId: targetUsername,
        entityName: current.name,
        eventType: "Authorization",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        reasonForChange: reasonForChange,
        beforeData,
        afterData: null
      });

      res.json({ success: true });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  router.put("/api/users/:username/role", requireAuth, requirePermission("users.manage"), async (req: any, res) => {
    try {
      const targetUsername = req.params.username.toLowerCase();
      const current = await getUserByUsername(targetUsername);
      if (!current) {
        return res.status(404).json({ error: "کاربر یافت نشد" });
      }

      const { role, reasonForChange } = req.body;
      if (!role) {
        return res.status(400).json({ error: "فیلد role الزامی است" });
      }
      if (!ALLOWED_USER_ROLES.includes(role)) {
        return res.status(400).json({
          error: `سمت سازمانی نامعتبر است. مقادیر مجاز: ${ALLOWED_USER_ROLES.join("، ")}`,
        });
      }

      const refusedOnRole = refuseAdminGrant(req.account, role);
      if (refusedOnRole) return res.status(403).json({ error: refusedOnRole });

      const unsafeRole = await checkAdminSafety(req.user, targetUsername, { role });
      if (unsafeRole) return res.status(400).json({ error: unsafeRole });

      const oldRole = current.role;
      const oldPermissions = sanitizePermissions(current.permissions);
      const roleChanged = role !== oldRole;
      current.role = role;
      // The same rule PATCH follows: a new role starts from its own template,
      // so the previous job's exceptions do not follow the person. This route
      // used to keep them, which meant the two ways of changing a role left the
      // account in different states.
      if (roleChanged) current.permissions = [];
      await requirePrisma().user.update({
        where: { username: targetUsername },
        data: {
          role: role as any,
          ...(roleChanged ? { permissions: [] } : {}),
        },
      });

      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت کاربران",
        action: "ROLE_CHANGE",
        severity: "Critical",
        description: `تغییر سمت سازمانی کاربر ${targetUsername} از ${oldRole} به ${role} توسط ${req.user.name}`,
        entityType: "User",
        entityId: targetUsername,
        entityName: current.name,
        eventType: "Authorization",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        reasonForChange: reasonForChange || "ارتقای سطح دسترسی سازمانی",
        beforeData: { role: oldRole, permissions: oldPermissions },
        afterData: { role, permissions: current.permissions ?? [] }
      });

      res.json({ success: true, role, permissionsReset: roleChanged && oldPermissions.length > 0 });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // An admin sets a temporary password for someone who is locked out. The
  // account is flagged to change it on the next sign-in, so the admin never
  // ends up knowing a password the user keeps using.
  router.post("/api/users/:username/reset-password", requireAuth, requirePermission("users.manage"), async (req: any, res) => {
    try {
      const targetUsername = req.params.username.toLowerCase();
      const current = await getUserByUsername(targetUsername);
      if (!current) {
        return res.status(404).json({ error: "کاربر یافت نشد" });
      }

      const { newPassword, reasonForChange } = req.body;
      if (!newPassword || String(newPassword).length < 6) {
        return res.status(400).json({ error: "کلمه عبور موقت باید حداقل ۶ کاراکتر باشد." });
      }
      if (newPassword === "123" || newPassword === "123456") {
        return res.status(400).json({ error: "کلمه عبور موقت نمی‌تواند رمز پیش‌فرض باشد." });
      }

      const newSalt = generateSalt();
      await requirePrisma().user.update({
        where: { username: targetUsername },
        data: {
          passwordHash: hashPassword(newPassword, newSalt),
          passwordSalt: newSalt,
          mustChangePassword: true,
        },
      });

      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت کاربران",
        action: "RESET_PASSWORD",
        severity: "Critical",
        description: `کلمه عبور حساب کاربری ${targetUsername} توسط ${req.user.name} بازنشانی شد و تغییر آن در ورود بعدی الزامی گردید.`,
        entityType: "User",
        entityId: targetUsername,
        entityName: current.name,
        eventType: "Authorization",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        reasonForChange: reasonForChange || "بازنشانی کلمه عبور به درخواست کاربر",
        // The password itself is never recorded — only the fact of the reset.
        beforeData: { mustChangePassword: current.mustChangePassword !== false },
        afterData: { mustChangePassword: true, passwordReset: true }
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("Failed to reset password:", err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/api/users/:username/permissions", requireAuth, requirePermission("users.manage"), async (req: any, res) => {
    try {
      const targetUsername = req.params.username.toLowerCase();
      const current = await getUserByUsername(targetUsername);
      if (!current) {
        return res.status(404).json({ error: "کاربر یافت نشد" });
      }

      const { permissions, reasonForChange } = req.body;
      if (!Array.isArray(permissions)) {
        return res.status(400).json({ error: "فیلد permissions باید یک آرایه باشد." });
      }

      // Unknown names are dropped rather than stored, so a typo cannot end up
      // as a permission nobody can see in the dialog but that sits in the row.
      const cleaned = sanitizePermissions(permissions);

      // Same lockout class as role changes: nobody may strip the last account
      // that can still administer users, and nobody may strip their own.
      const unsafe = await checkPermissionSafety(req.user, targetUsername, cleaned);
      if (unsafe) return res.status(400).json({ error: unsafe });

      const oldPermissions = sanitizePermissions(current.permissions);
      current.permissions = cleaned;
      await requirePrisma().user.update({
        where: { username: targetUsername },
        data: { permissions: cleaned },
      });

      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت کاربران",
        action: "PERMISSION_CHANGE",
        severity: "Critical",
        description: `بروزرسانی مجوزهای دسترسی کاربر ${targetUsername} توسط مدیر سیستم`,
        entityType: "User",
        entityId: targetUsername,
        entityName: current.name,
        eventType: "Authorization",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        reasonForChange: reasonForChange || "تغییر اختیارات فرآیندی در ماژول‌های سامانه",
        beforeData: { permissions: oldPermissions },
        afterData: { permissions: cleaned }
      });

      res.json({ success: true, permissions: cleaned });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // ==========================================
  // --- Material Master Endpoints ---
  // ==========================================

  return router;
}
