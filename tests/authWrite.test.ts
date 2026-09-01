import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

/**
 * `authWrite` is the guard that was missing.
 *
 * `fetch` resolves for 4xx and 5xx exactly as it does for 200, so every
 * `.catch()` on a bare `authFetch` was dead code for anything short of a
 * dropped connection: a 403 or a 422 travelled the success path, the optimistic
 * update stayed on screen, and the localStorage cache kept a value the database
 * had refused. These tests hold that door shut.
 */

// The module reads localStorage and fetch at call time, so a stub is enough.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).window = { location: { reload() {} } };

const realFetch = globalThis.fetch;
function respondWith(status: number, body: unknown, ok = status >= 200 && status < 300) {
  (globalThis as any).fetch = async () =>
    ({
      ok,
      status,
      json: async () => {
        if (body === undefined) throw new SyntaxError('not json');
        return body;
      },
    }) as any;
}

beforeEach(() => {
  store.clear();
  store.set('app_jwt_token', 'token');
});
afterEach(() => {
  (globalThis as any).fetch = realFetch;
});

const load = async () => await import('../src/services/authFetch');

test('a successful write returns the parsed body', async () => {
  respondWith(200, { success: true, vendor: { id: 'V1' } });
  const { authWrite } = await load();
  assert.deepEqual(await authWrite('/api/vendors', { method: 'POST' }), {
    success: true,
    vendor: { id: 'V1' },
  });
});

test('a 200 with no body is still a success, not a failure', async () => {
  respondWith(204, undefined, true);
  const { authWrite } = await load();
  assert.equal(await authWrite('/api/vendors/V1', { method: 'DELETE' }), null);
});

test('a refusal throws and carries the reason the server gave', async () => {
  // The exact string the permission guard returns. Showing the server's own
  // words matters: "you may not do this" and "this breaks a rule" are different
  // answers and the operator needs to know which one they got.
  const serverMessage = 'عدم دسترسی: سطح دسترسی شما اجازهٔ انجام این عملیات را نمی‌دهد.';
  respondWith(403, { error: serverMessage });
  const { authWrite, ApiWriteError } = await load();

  await assert.rejects(
    () => authWrite('/api/vendors/V1/profile', { method: 'PATCH' }),
    (err: any) => {
      assert.ok(err instanceof ApiWriteError);
      assert.equal(err.status, 403);
      assert.equal(err.message, serverMessage);
      return true;
    },
  );
});

test('a business-rule refusal (422) is surfaced the same way', async () => {
  respondWith(422, { error: 'کد IRC باید دقیقاً ۱۶ رقم عددی باشد.' });
  const { authWrite } = await load();
  await assert.rejects(
    () => authWrite('/api/vendors', { method: 'POST' }),
    /IRC/,
  );
});

test('a refusal with no usable body still explains itself in Persian', async () => {
  // An HTML error page from a proxy, say. Reporting "[object Object]" or a bare
  // status code to a Persian-speaking operator is not an explanation.
  respondWith(500, undefined);
  const { authWrite } = await load();
  await assert.rejects(
    () => authWrite('/api/materials', { method: 'POST' }),
    (err: any) => {
      assert.equal(err.status, 500);
      assert.match(err.message, /سرور/);
      return true;
    },
  );
});

test('every refusal status the API can return has its own message', async () => {
  const { authWrite } = await load();
  for (const status of [400, 403, 404, 409, 422, 500]) {
    respondWith(status, undefined);
    await assert.rejects(
      () => authWrite('/x', { method: 'POST' }),
      (err: any) => {
        assert.equal(err.status, status);
        assert.ok(err.message.length > 10, `status ${status} needs a real message`);
        return true;
      },
    );
  }
});
