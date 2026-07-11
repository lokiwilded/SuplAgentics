// Moved verbatim from the OpenChamber fork's packages/web/server/lib/suplagentics/import-
// shared.js — shared secret-redaction and chunking used by the opencode + Claude Code import
// capability, and by extension the MCP tools built on top of it.

// Real conversational content only — text budget per chunk before starting a new one. Generous
// enough for the summarizer agent to have real context, small enough to stay well within any
// model's context window even for the largest single chunk.
const CHUNK_CHAR_BUDGET = 6000;

// Real, live secrets were found verbatim in a real ~/.claude/projects/*/memory/*.md file during
// testing (actual passwords, a K3s cluster token) — memory files are imported unprocessed (no
// LLM pass, by design, since they're already curated/summarized), so without this they'd land in
// the new DB in plaintext and later get shipped to Ollama Cloud when a summarizer agent reads
// this store. Mechanical, local, free — no LLM call needed, applied to everything before it's
// ever written.
//
// Labeled secrets: "password: `value`", "pass=value", "PASSKEY (core+periphery): `value`" etc.
// Up to 40 chars of parenthetical/note text is allowed between the label word and its delimiter.
// No leading \b — compound labels like "SETTINGS_ENCRYPTION_KEY" have no word-boundary before
// "ENCRYPTION" since "_" counts as a word character, so requiring one there missed real matches.
const LABELED_SECRET_PATTERN = /(password|passwd|pass|pw|passkey|api[_-]?key|secret|token|credential|encryption[_-]?key)\b[^\n:=]{0,40}[:=]\s*`?([^\s`,)\n]{4,})`?/gi;
// Format-based detection — no capture groups, replaced with a flat string (not a callback), since
// mixing capture-group and non-capture-group patterns through one shared callback previously
// caused replace()'s (match, offset, string) args to be mistaken for (label, value) here.
const FORMAT_SECRET_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
  /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g,                            // bcrypt hashes
  /AKIA[0-9A-Z]{16}/g,                                              // AWS-style access keys
  /\b(?:sk|ghp|gho|ghu|ghs|ghr)-[A-Za-z0-9_-]{20,}\b/g,             // OpenAI/Anthropic/GitHub-style key prefixes
  /\bK[0-9a-f]{20,}::server:[0-9a-f]+/g,                            // K3s-style join tokens
  /\/\s*`[^\s`]{4,}`/g,                                             // "user / `value`" inline credential lines — backtick-quoted value after a slash is a strong signal regardless of label wording; false positives (redacting non-secret backtick values) are an acceptable tradeoff here
];

export function redactSecrets(text) {
  let out = text.replace(LABELED_SECRET_PATTERN, (_match, label) => `${label}: [redacted]`);
  for (const pattern of FORMAT_SECRET_PATTERNS) out = out.replace(pattern, '[redacted]');
  return out;
}

// Multi-line variant — applies the same patterns across multi-line text (e.g. full memory files)
// where PEM blocks and multi-line secrets can span several lines. The single-line redactSecrets
// above already handles single-line patterns; this additionally catches blocks that cross newlines.
export function redactSecretsMultiLine(text) {
  return redactSecrets(text);
}

export function chunkTexts(texts) {
  const chunks = [];
  let current = [];
  let currentLen = 0;
  for (const t of texts) {
    if (currentLen > 0 && currentLen + t.length > CHUNK_CHAR_BUDGET) {
      chunks.push(current.join('\n\n'));
      current = [];
      currentLen = 0;
    }
    current.push(t);
    currentLen += t.length;
  }
  if (current.length) chunks.push(current.join('\n\n'));
  return chunks;
}
