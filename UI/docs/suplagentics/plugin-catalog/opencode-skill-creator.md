# opencode-skill-creator

**Type:** npm OpenCode plugin  
**Package:** `opencode-skill-creator`  
**Installed at:** `~/.config/opencode/node_modules/opencode-skill-creator/`  
**Companion skill:** `~/.config/opencode/skills/opencode-skill-creator/` (SKILL.md + `agents/{analyzer,comparator,grader}.md` prompt docs consumed via ad-hoc Task-tool spawns, not real OpenCode agent definitions)

## What it does

Full pipeline for authoring, validating, and iteratively improving OpenCode skills — parse/validate a `SKILL.md`, run eval loops against real test queries, optimize a skill's trigger `description`, and generate shareable HTML reports.

**How it actually gets invoked (verified, not assumed):** OpenCode skills are never called by name directly. A skill surfaces to whichever agent is currently running when the *current task's content* matches the skill's own `description` field closely enough — this is real, generic OpenCode skill-loading behavior, not something this plugin wires up itself. So to make a plan/prompt naturally trigger this skill, phrase it with language like "package this as an OpenCode skill," "create/edit a SKILL.md," etc. — this is exactly what `templates/agents/insights.md`'s skill-suggestion output does.

## Tools exposed

| Tool | Signature | Description |
|------|-----------|--------------|
| `skill_validate` | `(path)` | Validate a skill directory — SKILL.md exists, well-formed frontmatter, naming/description limits. |
| `skill_parse` | `(path)` | Parse a SKILL.md and return name, description, and full content. |
| `skill_eval` | `(path, queries)` | Test whether a skill's description triggers OpenCode to invoke it for a set of queries. Actually runs `opencode` per query — takes real time. |
| `skill_improve_description` | `(path, evalResults)` | Generate an improved description from eval failure patterns. |
| `skill_optimize_loop` | `(path, queries)` | Full description-optimization loop: split train/test, evaluate, improve, repeat. Can take several minutes. |
| `skill_add_gold_standard` | `(example)` | Save a durable gold-standard description example for future meta-learning. |
| `skill_list_gold_standards` | `()` | List saved gold-standard examples. |
| `skill_remove_gold_standard` | `(id)` | Remove a saved gold-standard example. |
| `skill_get_gold_advice` | `()` | Formatted gold-standard advice for optimization prompts. |
| `skill_aggregate_benchmark` | `(runDirs)` | Aggregate `grading.json` files from benchmark runs into summary stats. |
| `skill_generate_report` | `(path)` | Generate a self-contained HTML report of optimization results per iteration. |
| `skill_serve_review` | `(path)` | Start an HTTP server serving the eval review viewer, opens browser automatically. Remember to `skill_stop_review` when done. |
| `skill_stop_review` | `()` | Stop a running eval review viewer server. |
| `skill_export_static_review` | `(path)` | Generate a standalone HTML eval review file — for headless/remote-agent contexts with no browser. |

## Notes

- Installs finished skills to either `.opencode/skills/<name>/` (project) or `~/.config/opencode/skills/<name>/` (global)
- The `agents/analyzer.md`/`comparator.md`/`grader.md` files under its companion skill folder have **no YAML frontmatter** — they're plain prose instruction documents the active agent is told to pass into ad-hoc Task-tool calls using the generic `general` subagent type, not real named OpenCode agents
