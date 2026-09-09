import express from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { AuditService } from "../../utils/auditService.js";
import { recordEvent } from "../../utils/auditEvents.js";
import { effectivePermissions, hasCustomPermissions } from "../../utils/permissions.js";
import { requirePrisma } from "../db/prisma.js";
import { requireAuth } from "../http/auth.js";
import { setCurrentSession } from "../http/requestContext.js";
import { sendHandlerError } from "../http/errors.js";
import { getClientIp } from "../http/requestInfo.js";
import { getUserByUsername } from "../repositories/userRepository.js";
import { JWT_SECRET } from "../security/jwtSecret.js";
import {
  generateSalt, hashPassword, needsRehash, verifyPassword,
} from "../security/passwordService.js";

/**
 * Throttle repeated failed sign-ins.
 *
 * Measured before this existed: 30 wrong passwords went through in 343ms, about
 * 87 guesses a second, with nothing slowing the next one down. Raising the hash
 * cost helps, but a limiter is what turns "guess until it works" into something
 * that cannot finish.
 *
 * Counted per username *and* per IP, because the two attacks look different: one
 * machine working through passwords for one account, and a spread of attempts
 * trying one common password against every account.
 *
 * The two thresholds are deliberately far apart. Everyone in this company
 * reaches the server through the same internal network, so a strict per-IP
 * count would let one colleague mistyping their password lock out the whole
 * building — a self-inflicted outage worse than the attack it prevents. The
 * per-username count is what stops guessing at one account; the per-IP count is
 * loose enough that only a machine grinding through many accounts trips it.
 *
 * A successful sign-in clears both counters for that person, so someone who
 * mistypes twice and then gets it right is never held back. Entries expire on
 * their own, so the maps cannot grow without bound.
 */
const LOGIN_MAX_ATTEMPTS_PER_USER = 8;
const LOGIN_MAX_ATTEMPTS_PER_IP = 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

/** The attempt ceiling for a key, by its kind. */
function attemptCeiling(key: string): number {
return key.startsWith("ip:") ? LOGIN_MAX_ATTEMPTS_PER_IP : LOGIN_MAX_ATTEMPTS_PER_USER;
}

interface AttemptRecord { count: number; firstAt: number; blockedUntil: number }
const loginAttempts = new Map<string, AttemptRecord>();

function loginBlockRemainingMs(keys: string[], now = Date.now()): number {
let longest = 0;
for (const key of keys) {
  const rec = loginAttempts.get(key);
  if (!rec) continue;
  if (rec.blockedUntil > now) longest = Math.max(longest, rec.blockedUntil - now);
  else if (now - rec.firstAt > LOGIN_WINDOW_MS) loginAttempts.delete(key);
}
return longest;
}

function recordFailedLogin(keys: string[], now = Date.now()): void {
for (const key of keys) {
  const rec = loginAttempts.get(key);
  if (!rec || now - rec.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
    continue;
  }
  rec.count += 1;
  if (rec.count >= attemptCeiling(key)) {
    rec.blockedUntil = now + LOGIN_BLOCK_MS;
    rec.count = 0;
    rec.firstAt = now;
  }
}
}

function clearLoginAttempts(keys: string[]): void {
for (const key of keys) loginAttempts.delete(key);
}

/**
 * Who to name on a refused sign-in, when nobody is signed in.
 *
 * `recordEvent` takes the actor from `req.user`, which a login attempt does not
 * have yet. The attempted username is the only thing known about whoever is at
 * the keyboard, and it is exactly what a reviewer looking at a run of refusals
 * needs to see — so it stands in as the actor rather than leaving the row
 * anonymous.
 */
function attemptedActor(username: unknown) {
  const name = typeof username === "string" && username.trim() ? username.trim() : null;
  return { username: name || "unknown", name: name || "ناشناس", role: "guest" };
}

/**
 * Sweep expired entries so a long-running process does not accumulate them.
 *
 * The limiter is an in-memory Map, which is correct for the way this is
 * deployed (one container, or PM2 in fork mode) and worth knowing about if it
 * ever runs as more than one process — see the deployment guide.
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of loginAttempts) {
    if (rec.blockedUntil <= now && now - rec.firstAt > LOGIN_WINDOW_MS) loginAttempts.delete(key);
  }
}, 10 * 60 * 1000).unref();

/**
 * Signing in, signing out, and asking who you are.
 *
 * The rate limiter lives here because it guards exactly one endpoint. Its two
 * ceilings are deliberately different: eight attempts per account stops someone
 * guessing at one person's password, while sixty per address is loose enough
 * that a whole office behind one IP is never locked out by a colleague's typo.
 *
 * `/api/auth/me` reads the role and the account state from the database rather
 * than echoing the token, so a closed account is signed out on the next load
 * instead of lasting the token's seven days.
 */

export function authRoutes(): express.Router {
  const router = express.Router();

  router.post("/api/auth/login", async (req, res) => {
    try {
    const { username, password } = req.body;
    const ipAddress = getClientIp(req);
    const throttleKeys = [`ip:${ipAddress}`, `user:${String(username || "").toLowerCase()}`];

    const blockedFor = loginBlockRemainingMs(throttleKeys);
    if (blockedFor > 0) {
      const minutes = Math.max(1, Math.ceil(blockedFor / 60000));
      recordEvent(req, {
        event: "auth.login_failed",
        actor: attemptedActor(username),
        entity: { id: username || "unknown", name: username || "ناشناس" },
        facts: { blockedMinutes: minutes },
        reason: "مسدودشده به‌دلیل تلاش‌های ناموفق پیاپی",
      });

      res.setHeader("Retry-After", String(Math.ceil(blockedFor / 1000)));
      return res.status(429).json({
        error: `به‌دلیل تلاش‌های ناموفق پیاپی، ورود موقتاً مسدود شده است. لطفاً ${minutes} دقیقهٔ دیگر دوباره تلاش کنید.`,
      });
    }

    if (!username || !password) {
      recordEvent(req, {
        event: "auth.login_failed",
        actor: attemptedActor(username),
        entity: { id: username || "unknown", name: username || "ناشناس" },
        reason: "نام کاربری یا کلمهٔ عبور ارسال نشد",
      });

      return res.status(400).json({ error: "نام کاربری و کلمهٔ عبور را وارد کنید." });
    }

    const matchedUser = await getUserByUsername(username);
    if (!matchedUser) {
      recordEvent(req, {
        event: "auth.login_failed",
        actor: attemptedActor(username),
        entity: { id: username, name: username },
        reason: "نام کاربری ناشناس",
      });

      recordFailedLogin(throttleKeys);
      return res.status(401).json({ error: "نام کاربری یا کلمهٔ عبور نادرست است." });
    }

    const isPasswordCorrect = verifyPassword(password, matchedUser.password);

    if (!isPasswordCorrect) {
      recordEvent(req, {
        event: "auth.login_failed",
        actor: { username: matchedUser.username, name: matchedUser.name, role: matchedUser.role },
        entity: { id: matchedUser.username, name: matchedUser.name },
        reason: "کلمهٔ عبور نادرست",
      });

      recordFailedLogin(throttleKeys);
      return res.status(401).json({ error: "نام کاربری یا کلمهٔ عبور نادرست است." });
    }

    // A deactivated account is refused here, after the password check, so the
    // response cannot be used to tell a closed account from a wrong password.
    if (matchedUser.isActive === false) {
      recordEvent(req, {
        event: "auth.login_failed",
        actor: { username: matchedUser.username, name: matchedUser.name, role: matchedUser.role },
        entity: { id: matchedUser.username, name: matchedUser.name },
        reason: "حساب کاربری غیرفعال است",
      });

      return res.status(403).json({ error: "این حساب کاربری غیرفعال است. با مدیر سیستم تماس بگیرید." });
    }

    // The password was right and the account is open: this address and this
    // account are evidently not an attack, so their failure counters go.
    clearLoginAttempts(throttleKeys);

    // Upgrade a hash written at the old work factor, now that the correct
    // password is in hand to re-derive it from. Accounts migrate as people sign
    // in, so nobody is locked out and no reset is needed. A failure here must
    // not block the sign-in — the stored hash is still valid, just slower.
    if (needsRehash(matchedUser.password)) {
      const upgradedSalt = generateSalt();
      requirePrisma().user
        .update({
          where: { username: matchedUser.username.toLowerCase() },
          data: { passwordHash: hashPassword(password, upgradedSalt), passwordSalt: upgradedSalt },
        })
        .then(() => console.log(`[auth] password hash upgraded for ${matchedUser.username}`))
        .catch(err => console.error("Password hash upgrade failed:", err?.message || err));
    }

    // Sign the JWT securely
    // `sid` names this sign-in. It is what lets the trail say that a run of
    // changes came from one session rather than only from one account, and it
    // is minted here because that is the only moment a session begins.
    const sessionId = crypto.randomUUID();
    const token = jwt.sign(
      { username: matchedUser.username, role: matchedUser.role, name: matchedUser.name, sid: sessionId },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    // The sign-in record belongs to the session it starts. Without this the one
    // record that says when a session began would be the only record of that
    // session with no way to tie it to the changes that followed.
    setCurrentSession(sessionId);

    // Read the previous sign-in before overwriting it: what a person wants to
    // see when they log in is when they were *last* here, not the moment they
    // just arrived. It is returned once at login and then left alone, since
    // /api/auth/me deliberately does not send it back.
    const previousLoginAt = matchedUser.lastLoginAt ? new Date(matchedUser.lastLoginAt).toISOString() : null;

    requirePrisma().user
      .update({ where: { username: matchedUser.username.toLowerCase() }, data: { lastLoginAt: new Date() } })
      .catch(err => console.error("Failed to record last login:", err));

    const mustChangePassword = matchedUser.mustChangePassword !== false;

    // Log the login activity
    recordEvent(req, {
      event: "auth.login",
      actor: { username: matchedUser.username, name: matchedUser.name, role: matchedUser.role },
      entity: { id: matchedUser.username, name: matchedUser.name },
    });

    res.json({
      success: true,
      token,
      user: {
        username: matchedUser.username,
        role: matchedUser.role,
        name: matchedUser.name,
        // The effective list, so the UI gates on exactly what the server will.
        permissions: effectivePermissions(matchedUser),
        // The client only ever receives the effective list, so it cannot work
        // out on its own whether that came from the role or from an override.
        permissionsCustom: hasCustomPermissions(matchedUser),
        previousLoginAt,
        mustChangePassword
      }
    });
    } catch (err: any) {
      // Always answer with JSON so the client never has to parse an HTML error
      // page (e.g. when the database is unreachable or not yet migrated).
      console.error("[Login] Unexpected failure:", err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({
          error: "خطای سرور در ورود — اتصال یا مهاجرت پایگاه‌داده را بررسی کنید (DATABASE_URL / migrate).",
        });
      }
    }
  });

  // User Logout endpoint
  router.post("/api/auth/logout", requireAuth, async (req: any, res) => {
    try {
      await recordEvent(req, {
        event: "auth.logout",
        entity: { id: req.user.username, name: req.user.name },
      });

      res.json({ success: true, message: "با موفقیت از سیستم خارج شدید" });
    } catch (err: any) {
      console.error("Logout audit log failed:", err);
      res.json({ success: true });
    }
  });

  // Change Password endpoint for security compliance
  router.post("/api/auth/change-password", requireAuth, async (req: any, res) => {
    const { currentPassword, newPassword } = req.body;
    const username = req.user.username;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "وارد کردن کلمه عبور فعلی و جدید الزامی است" });
    }

    if (newPassword === "123" || newPassword === "123456") {
      return res.status(400).json({ error: "کلمه عبور جدید نمی‌تواند رمز پیش‌فرض باشد" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "کلمه عبور جدید باید حداقل ۶ کاراکتر باشد" });
    }

    const matchedUser = await getUserByUsername(username);
    if (!matchedUser) {
      return res.status(404).json({ error: "کاربر یافت نشد" });
    }

    const isCurrentPasswordCorrect = verifyPassword(currentPassword, matchedUser.password);

    if (!isCurrentPasswordCorrect) {
      return res.status(400).json({ error: "کلمه عبور فعلی وارد شده نادرست است" });
    }

    // Change the password, hash and salt it, and persist
    const newSalt = generateSalt();
    await requirePrisma().user.update({
      where: { username: username.toLowerCase() },
      data: {
        passwordHash: hashPassword(newPassword, newSalt),
        passwordSalt: newSalt,
        mustChangePassword: false,
      },
    });

    // Log the password change activity
    recordEvent(req, {
      event: "auth.password_changed",
      entity: { id: req.user.username, name: req.user.name },
    });

    console.log(`[Security] Password successfully updated and hashed for user: ${username}`);
    res.json({ 
      success: true, 
      message: "کلمه عبور با موفقیت تغییر یافت",
      user: {
        username: matchedUser.username,
        role: matchedUser.role,
        name: matchedUser.name,
        permissions: effectivePermissions(matchedUser),
        mustChangePassword: false
      }
    });
  });

  // Fetch / verify logged in user's profile state
  // The client calls this on boot to re-check the account it restored from
  // localStorage. Role and name therefore come from the database rather than
  // from the token: the token is valid for seven days, so reading the role back
  // out of it would just echo whatever was true when the user signed in and
  // could never report a role change or a closed account.
  router.get("/api/auth/me", requireAuth, async (req: any, res) => {
    const username = req.user.username;
    const matchedUser = await getUserByUsername(username);

    // 401 here so authFetch ends the session: an account that was closed or
    // deactivated mid-session should be signed out on the next load rather than
    // keeping its access until the seven-day token runs out.
    if (!matchedUser || matchedUser.isActive === false) {
      return res.status(401).json({ error: "این حساب کاربری دیگر معتبر نیست." });
    }

    res.json({
      success: true,
      user: {
        username: matchedUser.username,
        role: matchedUser.role,
        name: matchedUser.name,
        permissions: effectivePermissions(matchedUser),
        // The client only ever receives the effective list, so it cannot work
        // out on its own whether that came from the role or from an override.
        permissionsCustom: hasCustomPermissions(matchedUser),
        mustChangePassword: matchedUser.mustChangePassword !== false
      }
    });
  });

  /**
   * The signed-in user's own recent activity.
   *
   * The audit trail itself is admin-only, but reading back what *you* did is
   * not a privileged act, and it is the fastest way for someone to notice
   * activity on their account that was not theirs. The filter is taken from the
   * token, never from the query string, so this cannot be pointed at anyone
   * else's history.
   */
  router.get("/api/auth/my-activity", requireAuth, async (req: any, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 8, 25);
      const result = await AuditService.getAuditLogs({ userId: req.user.username }, 1, limit);
      res.json({ success: true, data: result?.data ?? [], total: result?.total ?? 0 });
    } catch (err: any) {
      console.error("Failed to fetch own activity:", err);
      res.status(500).json({ error: "دریافت فعالیت اخیر با خطا مواجه شد." });
    }
  });

  // ==========================================
  // Source selection — the recorded purchasing decision per material
  // ==========================================

  return router;
}
