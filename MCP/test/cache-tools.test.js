// Denylist regression tests (S-4). The original denylist used `\bs` (a typo for `\s`) and blocked
// nothing but `dd`; these tests would have caught that.
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the module's on-import side effects (mkdir/evict the cache dir) to a temp HOME, then
// import dynamically so the env is set first.
const home = mkdtempSync(join(tmpdir(), 'ct-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { isCommandDenied } = await import('../src/tools/cache-tools.js');

test('blocks destructive commands at command position', () => {
  for (const cmd of [
    'rm -rf /tmp/x', 'rm foo', 'rmdir d', 'del f', 'delete x', 'format c:',
    'mkfs /dev/sda', 'dd if=/x of=/y', 'shutdown now', 'reboot', 'halt',
    'echo hi && rm x', 'ls; del y', 'a | rm b',
  ]) {
    assert.equal(isCommandDenied(cmd), true, `should BLOCK: ${cmd}`);
  }
});

test('allows read-only commands and destructive verbs used as arguments', () => {
  for (const cmd of [
    'git status', 'npm test', 'npm run format', 'grep rm file.txt',
    'cat mydel.sh', 'ls -la', 'node --check x.js', 'echo format',
  ]) {
    assert.equal(isCommandDenied(cmd), false, `should ALLOW: ${cmd}`);
  }
});
