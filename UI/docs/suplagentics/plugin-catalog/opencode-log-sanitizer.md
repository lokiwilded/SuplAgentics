# opencode-log-sanitizer

**Type:** npm OpenCode plugin  
**Package:** `opencode-log-sanitizer`  
**Installed at:** `~/.config/opencode/node_modules/opencode-log-sanitizer/`

## What it does

A `chat.message` hook that redacts long quoted strings, JWT tokens, bcrypt hashes, and base64 blobs from text parts of every chat message before they're stored/sent — meant to strip secrets and noise out of pasted logs.

## Tools exposed

None — pure hook, registers no agent-callable tools.

## Config (in `opencode.json`'s `plugin` array)

```json
["opencode-log-sanitizer", { "maxStringLength": 4000 }]
```

| Option | Type | Default | Description |
|--------|------|---------|--------------|
| `maxStringLength` | `number` | `300` | Quoted strings or base64 blobs longer than this are redacted to `"redacted"` / `[redacted:base64:Nchars]` |
| `enableJwtDetection` | `boolean` | `true` | Redact JWT tokens (`eyJ...`) |
| `enableBcryptDetection` | `boolean` | `true` | Redact bcrypt hashes (`$2a$`/`$2b$`/`$2y$`) |
| `enableBase64Detection` | `boolean` | `true` | Redact base64 blobs longer than `maxStringLength` |

## ⚠️ Known bug — why `maxStringLength` is raised to 4000 here

The default `300` is dangerously low for normal prose. The plugin's long-string redactor (`redactLongStrings`) treats **any** `'` or `"` character as a generic string delimiter — it has no concept of English contractions. A sentence containing two apostrophes (e.g. two contractions like "doesn't" ... "can't") more than 300 characters apart gets its entire span between them silently replaced with the literal string `"redacted"`, destructively corrupting real agent output. This was found live in this project: two `insights`-agent suggestion files had large chunks of real prose replaced with `"redacted"` mid-sentence.

`maxStringLength: 4000` in both `~/.config/opencode/opencode.json` and `templates/opencode.json` makes this effectively never trigger on normal prose while leaving JWT/bcrypt detection (separate, unaffected checks) fully intact. If you ever see `"redacted"` appear unexpectedly in agent output or suggestion files, check this setting first before assuming it's a different bug.

## Notes

- No settings UI on the dashboard yet — edited directly in `opencode.json` for now (see CLAUDE.md's Settings section for the general pattern this should eventually follow)
