---
description: Start a PI-Fixer work session — general, or review a past SuplAgentics conversation.
argument-hint: "[project]"
---
Begin a PI-Fixer working session.

First ask me: **general** or **conversation-based**?

**General** — continue as the CLI. Remember I can reference `@<project>` at any time; when I do,
call `supl_project` to pull that project's notes and recent sessions before answering.

**Conversation-based:**
1. Call `supl_projects` and show me the list; ask which project.${1:+ (I already said: **$1** — use it and skip the ask.)}
2. Call `supl_sessions` for the chosen project; show the recent sessions as a compact numbered list (time — title).
3. When I pick one, call `supl_session` on it and **review it for clear issues** — tool errors, failed or looping attempts, unresolved bugs, or points I got frustrated. Give me 3–5 bullets on what went wrong, cross-reference `supl_scan`, and propose the single highest-value improvement to SuplAgentics.
4. Wait for my go before building. When building, follow the **improve-suplagentics** skill and never skip the propagation step: edit the repo → `supl_sync push` → `supl_diff` must show *already in sync* → `supl_refresh`.
