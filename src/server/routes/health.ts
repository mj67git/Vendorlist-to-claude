import express from "express";
import { requirePrisma } from "../db/prisma.js";

/**
 * Liveness *and* readiness.
 *
 * This used to answer `{"status":"ok"}` without touching anything, so with
 * PostgreSQL stopped it still reported healthy while every data route
 * returned 500 — a monitor wired to it would have called a total outage fine.
 * It now runs the cheapest possible query and reports 503 when that fails, so
 * Zabbix/PRTG can watch this one URL and be told the truth.
 *
 * The result is cached for a couple of seconds: a monitor polling every second
 * must not turn into a query per second per monitor, and a database that just
 * went down does not need to be asked again immediately.
 */
let healthCache: { at: number; ok: boolean; detail: string } | null = null;
const HEALTH_CACHE_MS = 2000;

/**
 * The only endpoint a monitor needs.
 *
 * It runs a real query rather than reporting that the process is alive: with a
 * broken DATABASE_URL every data route returns 500 while the process sits there
 * answering happily, so "up" and "working" are different questions. A failure
 * answers 503, which is what a monitor watches for.
 *
 * The result is cached for two seconds so frequent polling cannot itself become
 * load on the database.
 */

export function healthRoutes(): express.Router {
  const router = express.Router();

  router.get("/api/health", async (req, res) => {
    const now = Date.now();
    if (!healthCache || now - healthCache.at > HEALTH_CACHE_MS) {
      try {
        await requirePrisma().$queryRaw`SELECT 1`;
        healthCache = { at: now, ok: true, detail: "connected" };
      } catch (err: any) {
        healthCache = { at: now, ok: false, detail: err?.message?.slice(0, 200) || "unreachable" };
      }
    }

    res.status(healthCache.ok ? 200 : 503).json({
      status: healthCache.ok ? "ok" : "degraded",
      database: healthCache.ok ? "up" : "down",
      detail: healthCache.ok ? undefined : healthCache.detail,
      timestamp: new Date(),
    });
  });



  return router;
}
