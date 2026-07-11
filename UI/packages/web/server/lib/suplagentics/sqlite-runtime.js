// Shared Bun/Node-adaptive SQLite access — this server runs under different runtimes depending
// on how it's launched: the dev script (dev-web-hmr.mjs -> nodemon -> `bun server/index.js`) is
// Bun, but the packaged CLI's own `serve` command (package.json's `start`: `node bin/cli.js
// serve`) runs under plain Node — verified live (a real production restart hit exactly this: "Only
// URLs with a scheme in: file, data, and node are supported" is Node's ESM loader rejecting the
// bun: protocol outright). better-sqlite3 is a real native addon Bun's own runtime doesn't support
// loading (verified live separately — a real "not yet supported in Bun" error, not a style
// choice). This detects which runtime is active and returns whichever engine actually works,
// normalized to the same all/get/run/exec/close shape so callers don't need to know which engine
// is underneath.

export async function openDb(dbPath, { readonly = false } = {}) {
  if (typeof Bun !== 'undefined') {
    const { Database } = await import('bun:sqlite');
    const db = new Database(dbPath, readonly ? { readonly: true } : undefined);
    return {
      all: (sql, ...params) => db.query(sql).all(...params),
      get: (sql, ...params) => db.query(sql).get(...params),
      run: (sql, ...params) => db.query(sql).run(...params),
      exec: (sql) => db.exec(sql),
      close: () => db.close(),
    };
  }
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, readonly ? { readonly: true } : undefined);
  return {
    all: (sql, ...params) => db.prepare(sql).all(...params),
    get: (sql, ...params) => db.prepare(sql).get(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params),
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
  };
}
