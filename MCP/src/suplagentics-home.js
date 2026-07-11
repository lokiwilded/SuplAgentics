// A dedicated personal space for "global" (cross-project) SuplAgentics work — the target
// directory for the claude-import-summarizer's own opencode session, and where global-scope
// Improvement suggestions get approved into plans and built. Deliberately NOT tied to any
// specific cloned repo — an earlier version of this hardcoded `~/dev/SuplAgentics` (the original
// author's own dev checkout location), which silently broke this for anyone whose clone lives
// anywhere else. Configurable via SUPLAGENTICS_HOME for anyone who does want to point this at a
// real git repo of their own (e.g. to track global suggestions/plans in version control);
// defaults to a plain dot-directory under the home dir otherwise, auto-created on first use since
// nothing else guarantees it exists.

import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

export const SUPLAGENTICS_HOME = (
  process.env.SUPLAGENTICS_HOME
    ? path.resolve(process.env.SUPLAGENTICS_HOME)
    : path.join(os.homedir(), '.suplagentics')
).replace(/\\/g, '/');

let ensured = false;
export function ensureSuplagenticsHome() {
  if (ensured) return SUPLAGENTICS_HOME;
  mkdirSync(SUPLAGENTICS_HOME, { recursive: true });
  ensured = true;
  return SUPLAGENTICS_HOME;
}
