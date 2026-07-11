# envsitter-guard

**Type:** npm OpenCode plugin  
**Package:** `envsitter-guard`  
**Installed at:** `~/.config/opencode/node_modules/envsitter-guard/`

## What it does

Blocks reading/editing `.env*` files directly (a `tool.execute.before` guard on read-style tools) and provides a full toolkit of value-safe alternatives — none of these ever print actual secret values back into agent context.

## Tools exposed

| Tool | Signature | Description |
|------|-----------|--------------|
| `envsitter_keys` | `(path)` | List keys in a .env file (never returns values). |
| `envsitter_fingerprint` | `(path, key)` | Compute a deterministic fingerprint for a single key (never returns the value) — check if a value changed without ever seeing it. |
| `envsitter_match` | `(path, key, candidate)` | Match key values without printing them. Supports existence/shape checks and outside-in candidate matching. |
| `envsitter_match_by_key` | `(path, candidates)` | Bulk match candidates-by-key without printing values (returns booleans only). |
| `envsitter_scan` | `(path)` | Scan value shapes (jwt/url/base64) without printing values — good first step before touching a file. |
| `envsitter_validate` | `(path)` | Validate dotenv syntax (never returns values). |
| `envsitter_copy` | `(from, to, write?)` | Copy keys between dotenv files safely (no values in output). Dry-run unless `write: true`. |
| `envsitter_format` | `(path, write?)` | Format/reorder a dotenv file (no values in output). Dry-run unless `write: true`. |
| `envsitter_reorder` | `(path, write?)` | Alias for `envsitter_format`. |
| `envsitter_annotate` | `(path, key, comment, write?)` | Annotate a dotenv key with a comment (no values in output). Dry-run unless `write: true`. |
| `envsitter_add` | `(path, key, value, write?)` | Add a new key (fails if it already exists). Dry-run unless `write: true`. |
| `envsitter_set` | `(path, key, value, write?)` | Set a key's value (creates if missing, updates if exists). Dry-run unless `write: true`. |
| `envsitter_unset` | `(path, key, write?)` | Unset a key's value (sets to empty string, keeps the key). Dry-run unless `write: true`. |
| `envsitter_delete` | `(path, key, write?)` | Delete key(s) entirely (removes the line). Dry-run unless `write: true`. |
| `envsitter_help` | `()` | Comprehensive help on all envsitter tools — call first if a `.env` read gets blocked and you're unsure which tool replaces it. |

## Notes

- Every write-style tool defaults to a dry run — `write: true` must be passed explicitly to apply changes
- No config file — the guard applies to any `.env*` file path unconditionally
