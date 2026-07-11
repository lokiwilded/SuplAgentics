import { z } from 'zod';

// Inline secret redaction — replaces the @guardian agent round-trip on the commander's sanitize
// step with an instant, deterministic tool. Same intent (never let a secret reach an Ollama Cloud
// model), no extra model call. Patterns mirror @reviewer's / @guardian's known-secret list and
// PI-Builder's redact(); deterministic so it can't "decide" to leak.

const PATTERNS = [
  // Private key / certificate blocks (multi-line)
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, '‹redacted-private-key›'],
  [/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '‹redacted-certificate›'],
  // Provider tokens with distinctive prefixes
  [/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, '‹redacted-stripe-key›'],
  [/\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}\b/g, '‹redacted-github-token›'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '‹redacted-github-pat›'],
  [/\bglpat-[A-Za-z0-9_-]{10,}\b/g, '‹redacted-gitlab-token›'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '‹redacted-slack-token›'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '‹redacted-aws-key›'],
  // JWTs (three base64url segments)
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '‹redacted-jwt›'],
  // Ollama-style API key: <32hex>.<20+ alnum>
  [/\b[A-Za-z0-9]{20,}\.[A-Za-z0-9]{20,}\b/g, '‹redacted-key›'],
  // Connection strings with embedded credentials
  [/\b(postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/]+:[^@\s]+@/gi, '$1://‹redacted-credentials›@'],
  // Inline credential assignments: api_key = "...", token: ..., password=...
  [/\b(api[_-]?key|apikey|secret|token|password|passwd|authorization|auth[_-]?token|bearer|client[_-]?secret)\b(\s*[:=]\s*)("?)[^\s"',}]+\3/gi, '$1$2‹redacted›'],
];

export function redactSecrets(input) {
  if (typeof input !== 'string' || !input) return { text: input ?? '', count: 0 };
  let count = 0;
  let text = input;
  for (const [re, repl] of PATTERNS) {
    text = text.replace(re, (...args) => {
      count += 1;
      // support $1/$2 backrefs in the replacement string
      return typeof repl === 'string'
        ? repl.replace(/\$(\d)/g, (_, n) => args[Number(n)] ?? '')
        : repl;
    });
  }
  return { text, count };
}

const asText = (t) => ({ content: [{ type: 'text', text: t }] });

export function registerGuardTools(server) {
  server.registerTool(
    'suplagentics_redact',
    {
      title: 'Redact secrets from text',
      description:
        'Strip credentials/secrets (API keys, tokens, private keys, JWTs, connection strings, ' +
        'inline key=value secrets) from a brief BEFORE it is sent to a cloud model. Deterministic and ' +
        'instant — use this instead of delegating to @guardian. Returns the redacted text.',
      inputSchema: { text: z.string().describe('The brief/text to sanitize') },
    },
    async ({ text }) => {
      const { text: out, count } = redactSecrets(text);
      return asText(count > 0 ? `${out}\n\n[suplagentics_redact: ${count} secret(s) removed]` : out);
    },
  );
}
