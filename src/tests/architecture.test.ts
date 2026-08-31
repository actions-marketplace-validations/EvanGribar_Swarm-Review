import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadSwarmConfig, applyPresetDefaults } from "../config.js";
import { DEFAULT_DEBATE_CONFIG, DEFAULT_AGENTS, SwarmConfigSchema } from "../types.js";
import { runDebateRounds } from "../agents/debate.js";
import { loadRequirementContract } from "../requirements.js";

test("architecture defaults: non-debate swarm is the default", async () => {
  assert.equal(DEFAULT_DEBATE_CONFIG.rounds, 0);
  
  const parsed = SwarmConfigSchema.parse({});
  assert.equal(parsed.debate.rounds, 0);
  assert.equal(parsed.agents.length, 3);
});

test("architecture config: explicit debate configuration works", async () => {
  const parsedExplicitRounds = SwarmConfigSchema.parse({ debate: { rounds: 2 } });
  assert.equal(parsedExplicitRounds.debate.rounds, 2);

  const parsedExplicitEnabled = SwarmConfigSchema.parse({ debate: { enabled: true } });
  assert.equal(parsedExplicitEnabled.debate.rounds, 1);

  const parsedExplicitDisabled = SwarmConfigSchema.parse({ debate: { enabled: false, rounds: 2 } });
  assert.equal(parsedExplicitDisabled.debate.rounds, 0);
});

test("architecture presets: fast, balanced, thorough, requirements map correctly", () => {
  const fast = applyPresetDefaults({ preset: "fast" });
  assert.equal(fast.agents.length, 1);
  assert.equal(fast.debate.rounds, 0);
  assert.equal(fast.context_enrichment.enabled, false);

  const balanced = applyPresetDefaults({ preset: "balanced" });
  assert.equal(balanced.agents.length, 3);
  assert.equal(balanced.debate.rounds, 0);

  const thorough = applyPresetDefaults({ preset: "thorough" });
  assert.equal(thorough.agents.length, 4);
  assert.equal(thorough.debate.rounds, 0);
  assert.equal(thorough.static_analysis.enabled, true);

  const requirements = applyPresetDefaults({ preset: "requirements" });
  assert.equal(requirements.agents.length, 3);
  assert.equal(requirements.debate.rounds, 0);
  assert.equal(requirements.requirements.enabled, true);
});

test("architecture debate stage: debate-disabled runs (rounds=0) issue zero debate calls", async () => {
  const agents = [{ name: "security", mandate: "Check security." }];
  const initialFindings = [
    {
      id: "f-1",
      agent: "security",
      severity: "blocking" as const,
      file: "src/index.ts",
      line: 10,
      claim: "Security vulnerability",
      confidence: 0.9,
    },
  ];

  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify([]) }] }), { status: 200 });
  }) as typeof fetch;

  try {
    const transcript = await runDebateRounds({
      agents,
      diff: [{ path: "src/index.ts", status: "modified", additions: 1, deletions: 0, changes: 1 }],
      initialFindings,
      rounds: 0,
      providerConfig: { type: "anthropic", config: { apiKey: "test-key", model: "claude-3-5-haiku-latest" } },
      minConfidence: 0.5,
    });

    assert.equal(calls, 0, "runDebateRounds must make 0 LLM calls when rounds is 0");
    assert.equal(transcript.rounds.length, 1);
    assert.deepEqual(transcript.rounds[0], initialFindings);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("architecture requirements: malformed SpecBridge contract fails safely", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "swarm-malformed-spec-"));
  await mkdir(path.join(root, ".specbridge"), { recursive: true });
  await writeFile(path.join(root, ".specbridge", "requirements.json"), "invalid json content");

  await assert.rejects(
    async () => {
      await loadRequirementContract(root, {
        enabled: true,
        contract_path: ".specbridge/requirements.json",
        fail_on_violation: false,
        upload_sarif: false,
        max_file_size_kb: 256,
      });
    },
    /Unable to parse requirement contract JSON/i
  );
});
