import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const serverBundlePath = path.join(process.cwd(), 'dist', 'server.cjs');

type AppHandler = (req: any, res: any) => unknown | Promise<unknown>;

let cachedHandler: AppHandler | null = null;

function loadAppHandler(): AppHandler {
  if (cachedHandler) {
    return cachedHandler;
  }

  if (!fs.existsSync(serverBundlePath)) {
    throw new Error(
      `Missing Vercel server bundle at ${serverBundlePath}. Run the build so dist/server.cjs is available before invoking the function.`,
    );
  }

  const loadedModule = require(serverBundlePath);
  const handler = loadedModule?.default ?? loadedModule;

  if (typeof handler !== 'function') {
    throw new TypeError(`Expected ${serverBundlePath} to export a default request handler function.`);
  }

  cachedHandler = handler;
  return cachedHandler;
}

export default async function handler(req: any, res: any) {
  return await loadAppHandler()(req, res);
}
