// Lightweight same-origin enforcement for SuplAgentics API routes.
// These routes handle sensitive operations (file access, command execution, project registration)
// and should only be accessible from the dashboard itself — not from arbitrary external origins.
// This is a defense-in-depth measure; the dashboard is intended to run on localhost only.

export function enforceSameOrigin(req, res, next) {
  // Allow in development (no Origin header for same-origin requests from the dashboard)
  const origin = req.headers.origin;
  if (!origin) return next(); // Same-origin requests don't send Origin

  // Allow localhost origins (the dashboard is a local-first tool)
  try {
    const url = new URL(origin);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
      return next();
    }
    // Allow the request's own host (same-origin by definition)
    const host = req.headers.host;
    if (host && (url.host === host || url.hostname === host.split(':')[0])) {
      return next();
    }
  } catch { /* malformed origin — let it through, other checks apply */ }

  // For anything else, block with a clear error
  res.status(403).json({ error: 'Cross-origin requests are not allowed. This API is for the local dashboard only.' });
}

// Rate-limiting middleware — prevents brute-force or accidental flood of the setup/import endpoints.
// Uses an in-memory sliding window (no external deps). Resets on server restart, which is fine for
// a localhost-only dashboard.
const windows = new Map();
export function rateLimit({ max = 30, windowMs = 60_000 } = {}) {
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = windows.get(key) || { count: 0, start: now };
    if (now - entry.start > windowMs) {
      entry.count = 0;
      entry.start = now;
    }
    entry.count++;
    windows.set(key, entry);
    if (entry.count > max) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
    next();
  };
}
