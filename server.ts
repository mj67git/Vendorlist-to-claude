import path from "path";
import express from "express";
import { createServer as createViteServer } from "vite";

import { isValidPostgresUrl } from "./src/server/db/prisma.js";
import { requestContext } from "./src/server/http/requestContext.js";
import { securityHeaders } from "./src/server/http/securityHeaders.js";
import { seedDefaultUsers } from "./src/server/repositories/userRepository.js";
import { seedDefaultBusinessPartners } from "./src/server/repositories/partnerRepository.js";

import { auditRoutes } from "./src/server/routes/audit.js";
import { authRoutes } from "./src/server/routes/auth.js";
import { configRoutes } from "./src/server/routes/config.js";
import { healthRoutes } from "./src/server/routes/health.js";
import { materialRoutes } from "./src/server/routes/materials.js";
import { partnerRoutes } from "./src/server/routes/partners.js";
import { sourceSelectionRoutes } from "./src/server/routes/sourceSelections.js";
import { userRoutes } from "./src/server/routes/users.js";
import { vendorRoutes } from "./src/server/routes/vendors.js";

/**
 * The bootstrap.
 *
 * This file used to be the whole backend — 4,551 lines holding routing, auth,
 * ORM access, business rules and persistence in one scope, with no automated
 * test on any of it. It is now just the assembly: what order the middleware
 * runs in, which routers exist, and how the frontend is served.
 *
 * The parts live under `src/server/`:
 *   db/            the one datastore, and coercion into it
 *   domain/        rules that are true about the business, not about HTTP
 *   http/          auth guards, security headers, error shape, request facts
 *   repositories/  how each aggregate is read from and written to the database
 *   routes/        one router per module, mounted below
 *   security/      password hashing and the token signing key
 */
async function startServer() {
  const app = express();

  securityHeaders(app);

  // Before anything that could write an audit record: every record produced
  // while handling one request shares that request's identifier.
  app.use(requestContext);

  app.use(express.json({ limit: "10mb" }));

  // A request with a JSON content-type but no body leaves `req.body` undefined,
  // and every handler that reads a field off it then threw — served as a 500
  // carrying the TypeError's text. Defaulting it to an empty object turns that
  // into the handler's own validation message, which is what the client needs.
  app.use((req, _res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  });

  // PostgreSQL is the single source of truth. Verify connectivity and provision
  // the default accounts on first startup before serving any request.
  if (!isValidPostgresUrl(process.env.DATABASE_URL)) {
    console.error(
      "[FATAL] DATABASE_URL is missing or invalid. A valid PostgreSQL connection is required to start the server.",
    );
  } else {
    try {
      await seedDefaultUsers();
    } catch (err: any) {
      console.error("[Startup] Failed to provision default users:", err.message);
    }
    try {
      await seedDefaultBusinessPartners();
    } catch (err: any) {
      console.error("[Startup] Failed to provision default business partners:", err.message);
    }
  }

  // --- API ------------------------------------------------------------------
  // Each router registers its own full paths, so mounting order carries no
  // meaning and any route can be found by grepping for its own URL.
  app.use(healthRoutes());
  app.use(configRoutes());
  app.use(authRoutes());
  app.use(vendorRoutes());
  app.use(sourceSelectionRoutes());
  app.use(materialRoutes());
  app.use(partnerRoutes());
  app.use(auditRoutes());
  app.use(userRoutes());

  app.use("/api", (err: any, req: any, res: any, _next: any) => {
    console.error(`[api] unhandled error on ${req.method} ${req.originalUrl}:`, err);
    if (res.headersSent) return;
    // A body express-json could not parse is the client's mistake, not ours.
    const status = err?.type === "entity.parse.failed" ? 400 : err?.status || 500;
    res.status(status).json({
      error: status === 400
        ? "بدنهٔ درخواست معتبر نیست."
        : "خطای داخلی سرور. جزئیات در لاگ سرور ثبت شد.",
    });
  });

  /**
   * An API path that matches no route is a 404, not the application shell.
   *
   * Both the static handler below and the Vite middleware answer anything they
   * do not recognise with index.html, so a typo'd or retired endpoint returned
   * 200 and a page of HTML. A client parsing that gets a JSON error at best, and
   * a monitor watching for failures sees success. Registered after every router
   * so it only ever sees paths no API route claimed.
   */
  app.use("/api", (req, res) => {
    res.status(404).json({
      error: `مسیر مورد نظر وجود ندارد: ${req.method} /api${req.path}`,
    });
  });

  // --- Frontend -------------------------------------------------------------
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return app;
}

const appPromise = startServer();

if (!process.env.VERCEL) {
  appPromise.then(app => {
    // PORT was hardcoded, so the value set in the Dockerfile, compose file and
    // ecosystem config did nothing and a second instance could not be started
    // on another port. An unusable value falls back to 3000 rather than letting
    // Node fail on a NaN port.
    const parsed = Number.parseInt(process.env.PORT || "", 10);
    const PORT = Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 3000;
    if (process.env.PORT && PORT !== Number(process.env.PORT)) {
      console.warn(`[startup] PORT="${process.env.PORT}" معتبر نیست؛ از ${PORT} استفاده شد.`);
    }
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  });
}

export default async function handler(req: express.Request, res: express.Response) {
  const app = await appPromise;
  return app(req, res);
}
