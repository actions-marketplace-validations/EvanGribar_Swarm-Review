import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";

import { loadSwarmConfig, DEFAULT_SWARM_CONFIG } from "../config.js";

test("loadSwarmConfig returns the default config when the file is missing", async () => {
  const config = await loadSwarmConfig(await mkdtemp(path.join(os.tmpdir(), "swarm-review-")), ".swarm.yml");

  assert.deepEqual(config, DEFAULT_SWARM_CONFIG);
});

test("loadSwarmConfig reads a local config file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "swarm-review-"));
  const configPath = path.join(tempDir, ".swarm.yml");

  await writeFile(
    configPath,
    [
      "agents:",
      "  - name: custom",
      "    mandate: Review the change carefully.",
      "    system_prompt: You are a custom system prompt.",
      "    min_confidence: 0.85",
      "debate:",
      "  rounds: 1",
      "  min_confidence: 0.7",
      "budget:",
      "  max_cost_usd: 1.5",
      "  fallback_model: gpt-4o-mini",
      "  max_output_tokens: 2048",
      "principal:",
      "  mandate: Make the final call.",
      "output:",
      "  mode: full",
    ].join("\n"),
    "utf8"
  );

  const config = await loadSwarmConfig(tempDir);

  assert.equal(config.agents[0]?.name, "custom");
  assert.equal(config.agents[0]?.system_prompt, "You are a custom system prompt.");
  assert.equal(config.agents[0]?.min_confidence, 0.85);
  assert.equal(config.debate.rounds, 1);
  assert.equal(config.debate.min_confidence, 0.7);
  assert.equal(config.budget?.max_cost_usd, 1.5);
  assert.equal(config.budget?.fallback_model, "gpt-4o-mini");
  assert.equal(config.budget?.max_output_tokens, 2048);
  assert.equal(config.principal.mandate, "Make the final call.");
  assert.equal(config.output.mode, "full");
});
