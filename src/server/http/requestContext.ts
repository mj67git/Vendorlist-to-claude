import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

/**
 * One identifier for everything that happens because of one request.
 *
 * A single API call routinely writes several audit records: a risk assessment
 * is saved, the score is recalculated from it, the grade that follows from the
 * score changes. Those are one event with three consequences, and the trail is
 * supposed to be able to show the chain.
 *
 * `correlationId` existed for exactly that, with a column and an index of its
 * own — but the nine handlers that filled it each called `crypto.randomUUID()`
 * at the point of writing, so every record correlated with nothing but itself.
 * A chain of one is not a chain, and it is invisible in the data, so no amount
 * of UI could have shown the sequence.
 *
 * The id is now minted once per request and read out of async context by the
 * audit service, which is why none of the ~47 call sites had to pass it. Async
 * context is the right carrier rather than a parameter threaded through every
 * function: the writes happen deep inside repositories that have no business
 * knowing about HTTP, and several of them are deliberately not awaited.
 *
 * A client may supply its own `X-Request-Id`; it is accepted only if it is a
 * plausible identifier, because this value ends up in a compliance record.
 */
interface RequestContext {
  correlationId: string;
  /** The sign-in behind the request, once a token has been verified. */
  sessionId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Identifier-shaped: letters, digits, dash and underscore, up to 64 chars. */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function requestContext(req: any, res: any, next: () => void): void {
  const supplied = req.headers?.["x-request-id"];
  const correlationId =
    typeof supplied === "string" && SAFE_ID.test(supplied) ? supplied : crypto.randomUUID();

  // Echoed back so a person reporting a problem can name the exact request,
  // and so the browser can link a change it made to the records it produced.
  res.setHeader("X-Request-Id", correlationId);
  req.correlationId = correlationId;

  storage.run({ correlationId }, next);
}

/**
 * The current request's identifier, or `null` outside a request — a startup
 * seed or a script writes audit records too, and those belong to no request.
 */
export function currentCorrelationId(): string | null {
  return storage.getStore()?.correlationId ?? null;
}

/**
 * Record which sign-in this request came from. Called by `requireAuth` once the
 * token verifies, so an unauthenticated request never carries one.
 */
export function setCurrentSession(sessionId: string | null | undefined): void {
  const store = storage.getStore();
  if (store && sessionId) store.sessionId = sessionId;
}

/** The sign-in behind the current request, or `null` if there is none. */
export function currentSessionId(): string | null {
  return storage.getStore()?.sessionId ?? null;
}
