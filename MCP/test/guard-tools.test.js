import { test } from 'node:test';
import assert from 'node:assert';
import { redactSecrets } from '../src/tools/guard-tools.js';

test('redacts known secret formats', () => {
  const cases = [
    ['api key sk_live_abcdefghij1234567890', 'sk_live_abcdefghij'],
    ['token ghp_abcdefghijklmnopqrst1234', 'ghp_abcdefghij'],
    ['aws AKIAABCDEFGHIJKLMNOP here', 'AKIAABCDEFGHIJKLMNOP'],
    ['jwt eyJhbGciOiJIUzI1NiIsInR5cCI6.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fwpM', 'SflKxwRJSMeKKF2Q'],
    ['db postgres://user:s3cretpassword@host:5432/db', 's3cretpassword'],
    ['password = "hunter2secretval"', 'hunter2secretval'],
    ['ollama 0123456789abcdef0123456789abcdef.EXAMPLEexample01234567', 'EXAMPLEexample'],
  ];
  for (const [input, secretFragment] of cases) {
    const { text, count } = redactSecrets(input);
    assert.ok(count >= 1, `should redact: ${input}`);
    assert.ok(!text.includes(secretFragment), `secret leaked: ${input} -> ${text}`);
  }
});

test('leaves benign text untouched (no false positives)', () => {
  for (const s of [
    'just some normal text about the project',
    'function foo() { return 42; }',
    'the api key is stored in auth.json — do not read it',
    'update the reviewer model to deepseek-v4-pro',
  ]) {
    const { text, count } = redactSecrets(s);
    assert.equal(count, 0, `false positive on: ${s}`);
    assert.equal(text, s);
  }
});
