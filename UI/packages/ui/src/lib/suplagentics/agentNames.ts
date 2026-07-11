// The full set of agents SuplAgentics installs (mirrors templates/agents/*.md in the SuplAgentics
// repo). Deliberately a fixed list, not "every custom/non-built-in agent" — a user's own
// hand-written custom agent should never get swept up by the bulk SuplAgentics disable/enable
// toggle just because it also happens to live in the same agents directory.
export const SUPLAGENTICS_AGENT_NAMES = [
  'commander',
  'planner',
  'teacher',
  'coder',
  'guardian',
  'researcher',
  'reviewer',
  'docs',
  'diagram',
  'quick',
  'test-writer',
  'vision',
  'memory-keeper',
  'plan-writer',
  'insights',
  'insights-agents',
  'insights-consolidator',
  'insights-ecosystem',
  'insights-global-synthesizer',
  'insights-skills',
  'insights-workflows',
  'claude-import-summarizer',
] as const;
