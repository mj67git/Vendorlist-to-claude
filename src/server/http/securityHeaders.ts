import type express from "express";

/**
 * The response headers that make this a same-origin application and keep it
 * that way.
 *
 * Written out rather than pulled from helmet: this is the whole of what an
 * internal same-origin application needs, every value sits next to the reason
 * for it, and the deployment gains no dependency to track.
 *
 * Moved out of startServer() unchanged.
 */
export function securityHeaders(app: express.Express): void {
  /**
   * Security response headers.
   *
   * Written out rather than pulled from helmet: this is the whole of what a
   * same-origin internal application needs, every value is visible here next to
   * the reason for it, and the deployment gains no new dependency to track.
   *
   * The CSP is the load-bearing one. Vite emits hashed script and style files
   * and the app fetches nothing off-site, so everything can be pinned to 'self';
   * `style-src` allows inline because Tailwind and the chart library set style
   * attributes, and `img-src data:` because attachments are previewed as data
   * URLs. `frame-ancestors 'none'` is what actually stops click-jacking in a
   * modern browser — X-Frame-Options is kept beside it for older ones.
   */
  app.disable("x-powered-by");   // stop announcing the framework
  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    // HSTS is only meaningful over TLS, and asserting it on a plain-HTTP
    // internal host would pin browsers to a scheme the server does not serve.
    // It is set when the request already arrived over HTTPS (directly or
    // through a reverse proxy that says so).
    const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
    if (isHttps) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
}
