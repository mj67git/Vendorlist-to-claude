import { VendorConflictError } from "../repositories/vendorRepository.js";

/**
 * The answer for an error that escaped a route handler.
 *
 * A lost-update conflict is not a server fault — it means someone else saved
 * first — so it gets 409 and says so in words the operator can act on. The
 * client treats any non-ok answer as a refusal, so this reaches the screen
 * instead of vanishing. Everything else keeps the behaviour it had.
 */
export function sendHandlerError(res: any, err: any) {
  if (err instanceof VendorConflictError) {
    return res.status(409).json({ error: err.message });
  }
  return res.status(500).json({ error: err?.message });
}
