import { PrismaClient } from "@prisma/client";

/**
 * Access to the one datastore.
 *
 * PostgreSQL is the only source of truth in this system and there is no file
 * fallback — a system that silently serves stale data from somewhere else
 * cannot be an auditable record. `requirePrisma()` therefore throws rather than
 * degrading, so a misconfiguration surfaces on the first request instead of
 * producing a register nobody can trust.
 *
 * Moved out of server.ts unchanged; it was the lowest layer buried in the
 * middle of a 4,500-line file.
 */

export function isValidPostgresUrl(url?: string | null): boolean {
  if (!url || typeof url !== "string" || !url.trim()) return false;
  const trimmed = url.trim();
  if (
    trimmed.includes("username:password") ||
    trimmed.includes(":port") ||
    trimmed.includes("host:port") ||
    trimmed.includes("database_name") ||
    trimmed.includes("user:password@host")
  ) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      return false;
    }
    if (!parsed.hostname || parsed.hostname === "host" || parsed.hostname === "localhost.invalid") {
      return false;
    }
    if (parsed.port && (isNaN(Number(parsed.port)) || Number(parsed.port) <= 0 || Number(parsed.port) > 65535)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

let _prismaInstance: PrismaClient | null = null;
export function getPrismaClient(): PrismaClient | null {
  if (!isValidPostgresUrl(process.env.DATABASE_URL)) {
    return null;
  }
  if (!_prismaInstance) {
    try {
      _prismaInstance = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL,
          },
        },
      });
      console.log("[Prisma] Lazily initialized PrismaClient for PostgreSQL.");
    } catch (err: any) {
      console.error("[Prisma] Failed to instantiate PrismaClient:", err.message);
      _prismaInstance = null;
    }
  }
  return _prismaInstance;
}

// PostgreSQL is the single source of truth. Fail fast (rather than silently
// falling back to file storage) so misconfiguration surfaces immediately.
export function requirePrisma(): PrismaClient {
  const prisma = getPrismaClient();
  if (!prisma) {
    throw new Error(
      "DATABASE_URL is missing or invalid. A valid PostgreSQL connection is required.",
    );
  }
  return prisma;
}

