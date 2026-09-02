import crypto from "crypto";

/**
 * The signing key for session tokens.
 *
 * There used to be a constant here as a fallback, which meant a server started
 * without `JWT_SECRET` signed its tokens with a value published in this
 * repository: anyone who had read the source could mint an administrator token
 * and the server would accept it. Verified before this changed — a forged token
 * built from that constant returned the full user list.
 *
 * So there is no fallback any more. In production a missing secret stops the
 * process at boot with an actionable message, the same fail-fast rule
 * `requirePrisma()` applies to the database URL: refusing to start is a problem
 * IT can see, while starting with a known key is one nobody sees.
 *
 * Outside production a random key is generated per process, so development
 * still works with no setup. Tokens do not survive a restart, which is correct
 * — a development session is not something to preserve, and no shared constant
 * exists to leak.
 */
export function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv) {
    if (fromEnv.length < 32 && process.env.NODE_ENV === "production") {
      console.error(
        "\n[FATAL] JWT_SECRET باید حداقل ۳۲ کاراکتر باشد.\n" +
        "        یک کلید تصادفی بسازید:  openssl rand -base64 48\n"
      );
      process.exit(1);
    }
    return fromEnv;
  }

  if (process.env.NODE_ENV === "production") {
    console.error(
      "\n[FATAL] متغیر محیطی JWT_SECRET تعریف نشده است و سرور بدون آن بالا نمی‌آید.\n" +
      "        بدون این کلید، توکن‌های ورود با یک مقدار قابل حدس امضا می‌شوند.\n" +
      "        یک کلید تصادفی بسازید و در محیط سرور قرار دهید:\n" +
      "            openssl rand -base64 48\n"
    );
    process.exit(1);
  }

  const generated = crypto.randomBytes(48).toString("base64");
  console.warn(
    "[auth] JWT_SECRET تعریف نشده؛ برای این اجرا یک کلید تصادفی ساخته شد " +
    "(نشست‌ها با ری‌استارت باطل می‌شوند). برای استقرار واقعی حتماً آن را ست کنید."
  );
  return generated;
}

export const JWT_SECRET = resolveJwtSecret();