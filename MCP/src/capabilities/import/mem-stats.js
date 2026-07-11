// Read-only stats over opencode-mem's real store (~/.opencode-mem/data) — how many projects have
// memories and how many memories exist in total, across every shard. This is the actual memory
// store (what opencode-mem's own web UI at :4747 reads), NOT the ephemeral import queue
// (suplagentics-claude-import.db) — the Import page's own "N chunks summarized" counters describe
// the queue's throughput; these describe the durable result of everything ever indexed, from any
// source (live capture, import, manual), so the headline total can exceed what this dashboard's
// own import runs produced.

import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../../sqlite-runtime.js';

const MEM_DATA_DIR = path.join(os.homedir(), '.opencode-mem', 'data');

// Returns { available, totalMemories, projectCount }. `available:false` (with zeroed counts) when
// opencode-mem has never run / has no store yet — the caller renders "not set up" rather than "0".
export async function getMemoryStoreStats() {
  const metaPath = path.join(MEM_DATA_DIR, 'metadata.db');
  if (!existsSync(metaPath)) return { available: false, totalMemories: 0, projectCount: 0 };

  const meta = await openDb(metaPath, { readonly: true });
  let totalMemories = 0;
  let projectCount = 0;
  try {
    // Distinct scope_hash, not raw shard rows — a project with enough memories spills into
    // multiple shards (shard_index 0,1,…), and counting rows would overcount projects.
    projectCount = meta.get("SELECT COUNT(DISTINCT scope_hash) c FROM shards WHERE scope = 'project'")?.c || 0;

    const shards = meta.all('SELECT db_path FROM shards');
    for (const s of shards) {
      const shardPath = path.join(MEM_DATA_DIR, s.db_path);
      if (!existsSync(shardPath)) continue;
      const db = await openDb(shardPath, { readonly: true });
      try {
        totalMemories += db.get('SELECT COUNT(*) c FROM memories')?.c || 0;
      } catch {
        // a shard mid-write / unexpected schema — skip it rather than fail the whole count
      } finally {
        db.close();
      }
    }
  } catch {
    // metadata.db unexpected/locked — report unavailable rather than throw
    return { available: false, totalMemories: 0, projectCount: 0 };
  } finally {
    meta.close();
  }

  return { available: true, totalMemories, projectCount };
}
