import http from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * A real HTTP server, a real database, real middleware.
 *
 * `server.ts` is 4,400 lines and had no automated coverage at all: the routing,
 * the auth guards, the permission checks and the read-modify-write persistence
 * were verified by hand or not at all. The unit tests cover the pure rules
 * (`permissions.ts`, `sopEvaluation.ts`, `vendorState.ts`) but a rule is only
 * a control once an endpoint enforces it, and that is what these exercise.
 *
 * It drives the app the way a browser does — over HTTP, through every
 * middleware — rather than calling handlers directly, because the guards ARE
 * middleware and a test that skips them proves nothing.
 *
 * Without a DATABASE_URL the whole API suite skips rather than fails, so
 * `npm test` still works on a machine with no PostgreSQL. CI provides one.
 */

export const DATABASE_AVAILABLE = Boolean(
  process.env.DATABASE_URL && /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL),
);

export const SKIP = DATABASE_AVAILABLE
  ? undefined
  : { skip: 'no DATABASE_URL — start PostgreSQL to run the API tests' };

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

let server: http.Server | null = null;
let baseUrl = '';
let prisma: any = null;

/** Boot the application once for the whole file. */
export async function startTestServer(): Promise<string> {
  if (server) return baseUrl;

  // VERCEL stops server.ts binding its own port; production mode skips the Vite
  // dev middleware, which would otherwise compile the frontend for an API test.
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET ||= 'test-secret-at-least-32-characters-long!!';

  const mod = await import('../../server');
  const handler = (mod as any).default;

  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient();

  // `startServer()` seeds the default users and partners on first boot, and the
  // import resolves before that promise settles. One request forces the wait —
  // otherwise the fixture races the seeding and loses on a unique constraint.
  await fetch(`${baseUrl}/api/health`).catch(() => {});
  return baseUrl;
}

export async function stopTestServer(): Promise<void> {
  await prisma?.$disconnect();
  prisma = null;
  await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve());
  server = null;
}

export function db() {
  if (!prisma) throw new Error('startTestServer() first');
  return prisma;
}

/** One request, with the token attached the way the client attaches it. */
export async function api<T = any>(
  path: string,
  options: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

export async function login(username: string, password = '123'): Promise<string> {
  const res = await api<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  if (!res.body?.token) {
    throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

/**
 * A known starting point for each test.
 *
 * Truncating rather than deleting per-table keeps the order-of-foreign-keys
 * problem out of the tests; CASCADE is safe here because the fixture rebuilds
 * everything the tests rely on.
 */
export async function resetDatabase(): Promise<void> {
  const p = db();
  await p.$executeRawUnsafe(`
    TRUNCATE TABLE
      source_selections, activity_logs, analysis_records, risk_assessments,
      evaluations, vendor_materials, sop_documents, supplier_evaluations,
      vendors, business_partners, materials, audit_log
    RESTART IDENTITY CASCADE
  `);
}

export const FIXTURE = {
  materialId: 'M-TEST',
  vendorId: 'V-TEST',
  supplierA: 'BP-A',
  supplierB: 'BP-B',
};

/**
 * One material, two Grade-A sellers, one source linked to the first.
 *
 * Grade A because `sopSupplierViolation` refuses to attach anything less, so a
 * lower grade would make every write test fail for the wrong reason.
 */
export async function seedFixture(): Promise<void> {
  const p = db();
  await p.material.create({
    data: { id: FIXTURE.materialId, name: 'پاراستامول', nameEn: 'Paracetamol', cas: '103-90-2', irc: 'N/A' },
  });
  for (const [id, name, nameEn] of [
    [FIXTURE.supplierA, 'فروشندهٔ الف', 'Seller A'],
    [FIXTURE.supplierB, 'فروشندهٔ ب', 'Seller B'],
  ]) {
    await p.businessPartner.create({
      data: { id, name, nameEn, type: 'Supplier', country: 'Turkey', status: 'Active' },
    });
    await p.supplierEvaluation.create({
      data: { id: `SE-${id}`, partnerId: id, totalScore: 100, grade: 'A', status: 'Approved' },
    });
  }
  await p.vendor.create({
    data: {
      id: FIXTURE.vendorId, name: 'فروشندهٔ الف', nameEn: 'Seller A', country: 'Turkey',
      status: 'new', grade: 'B', supplierId: FIXTURE.supplierA, contactInfo: 'آدرس تماس',
    },
  });
  await p.vendorMaterial.create({
    data: {
      id: `VM-${FIXTURE.vendorId}`, vendorId: FIXTURE.vendorId,
      materialId: FIXTURE.materialId, isSample: false, category: 'foreign',
    },
  });
}

/**
 * The password hash, computed once for the whole run.
 *
 * PBKDF2 at 210,000 iterations is deliberately slow — that is the point of it —
 * so hashing five accounts before every test cost more than the tests. The
 * value being hashed is the same every time, so it is computed once. Never do
 * this outside a test: a shared salt is exactly what per-user salts prevent.
 */
let sharedCredential: { hash: string; salt: string } | null = null;
async function testCredential() {
  if (!sharedCredential) {
    const { generateSalt, hashPassword } = await import('../../src/server/security/passwordService');
    const salt = generateSalt();
    sharedCredential = { salt, hash: hashPassword('123', salt) };
  }
  return sharedCredential;
}

/** The default accounts `seedDefaultUsers()` creates, with a known password. */
export async function seedUsers(): Promise<void> {
  const p = db();
  const { hash, salt } = await testCredential();
  await p.user.deleteMany({});
  await p.user.createMany({
    data: (
      [
        ['admin', 'admin'], ['qa', 'qa'], ['commercial', 'commercial'],
        ['planning', 'planning'], ['finance', 'finance'],
      ] as const
    ).map(([username, role]) => ({
      username, name: username, role,
      passwordHash: hash, passwordSalt: salt,
      mustChangePassword: false, isActive: true,
    })),
  });
}

/** The whole starting state: clean tables, known users, known records. */
export async function resetAll(): Promise<void> {
  await resetDatabase();
  await seedUsers();
  await seedFixture();
}

/** The body every vendor profile PATCH sends, so a test only states its change. */
export function profileBody(overrides: Record<string, unknown> = {}) {
  return {
    material: 'پاراستامول', materialEn: 'Paracetamol', cas: '103-90-2', irc: '',
    name: 'فروشندهٔ الف', nameEn: 'Seller A', country: 'Turkey',
    grade: 'B', status: 'new', isSample: false,
    manufacturerId: null, supplierId: FIXTURE.supplierA,
    ...overrides,
  };
}
