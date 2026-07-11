// Server-side "describe this sketch" for the plan annotator's UI-sketch annotations. The planner
// that revises a plan is text-only (glm-5.2) and cannot delegate (task: deny), so a drawn PNG is
// invisible to it — this turns the drawing into text it can act on.
//
// We call the vision *model* directly over Ollama Cloud's OpenAI-compatible chat API rather than
// routing through the `vision` opencode agent/session (runSubagentDelegation). That helper is built
// for background batch turns: it waits 30s–10min for a session to settle, which would hang the
// interactive "Send for Review" request. A direct multimodal completion returns in a few seconds.
// The chat-screenshot path still uses the @vision agent (commander delegates); both hit the same
// model. Verified live against gemma4:31b via the same endpoint.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const OLLAMA_CHAT_URL = 'https://ollama.com/v1/chat/completions';
const VISION_AGENT_PATH = path.join(os.homedir(), '.config', 'opencode', 'agents', 'vision.md');
const FALLBACK_MODEL = 'gemma4:31b';

const SYSTEM_PROMPT = `You are a vision specialist. Describe the hand-drawn UI sketch precisely so a planning agent can implement it. Cover: the overall layout and structure, each UI component (buttons, inputs, lists, nav bars, headers, icons), their arrangement, hierarchy and grouping, any text or labels drawn, and the apparent intent. Be concrete and terse — a few lines. If part of the drawing is ambiguous or unreadable, say so rather than guessing.`;

// Single source of truth for which model does vision: read it from the vision agent's own
// frontmatter so changing the model in the Indexing/Agents settings UI also moves this path. The
// value is an opencode "provider/model" id (e.g. ollama-cloud/gemma4:31b); strip the provider
// prefix to the raw Ollama model id the chat API expects.
async function resolveVisionModel() {
  try {
    const raw = await readFile(VISION_AGENT_PATH, 'utf8');
    const m = raw.match(/^model:\s*(\S+)/m);
    if (m) return m[1].replace(/^[^/]+\//, '');
  } catch { /* fall back below */ }
  return FALLBACK_MODEL;
}

// Returns a text description of an image/png data URL, or null on any failure (missing API key,
// network error, a non-vision model) so the caller can degrade gracefully to "a sketch is attached
// but couldn't be described" rather than dropping the feedback.
export async function describeSketch(dataUrl) {
  const apiKey = process.env.OLLAMA_API_KEY;
  if (!apiKey || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  try {
    const model = await resolveVisionModel();
    const res = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this UI sketch.' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}
