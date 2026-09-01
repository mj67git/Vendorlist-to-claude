/**
 * The two facts about a request that every audit record carries.
 *
 * Behind a reverse proxy — which is how this is deployed — `req.ip` is the
 * proxy, so the forwarded header is what identifies the person. An audit trail
 * that records the load balancer's address for every change answers no
 * question anyone would ask of it.
 */
export function getClientIp(req: any): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = typeof forwarded === 'string' ? forwarded.split(',') : forwarded;
    return ips[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || '127.0.0.1';
}

export function getUserAgent(req: any): string {
  return req.headers['user-agent'] || 'Unknown Browser/Device';
}
