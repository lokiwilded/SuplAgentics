// Shared Bun/Node-adaptive SQLite access — moved verbatim from the OpenChamber fork's own
// packages/web/server/lib/suplagentics/sqlite-runtime.js (see plans/openchamber-fork-port.md).
// This server can run under different runtimes depending on how it's launched — registered with
// opencode as a plain `node` command (see this package's README for why: portability to arbitrary
// MCP clients matters more here than matching any one fork's own dev-time runtime), but nothing
// stops someone running it under Bun directly too. better-sqlite3 is a real native addon Bun's own
// runtime doesn't support loading (verified live — a real "not yet supported in Bun" error, not a
// style choice); bun:sqlite only exists under Bun. This detects which runtime is active and
// returns whichever engine actually works, normalized to the same all/get/run/exec/close shape so
// callers don't need to know which engine is underneath.

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
