import assert from "node:assert/strict";
import test from "node:test";

import { resolveProviderConfig } from "../config.js";
import { tokenTracker, trackTokens, resetTokenTracker, calculateEstimatedCost } from "../providers.js";
import { SwarmConfigSchema, type SwarmConfig } from "../types.js";

function mockSwarmConfig(overrides: Record<string, any> = {}): SwarmConfig {
  return SwarmConfigSchema.parse(overrides);
}

test("resolveProviderConfig falls back to legacy Anthropic config if provider is not defined", () => {
  const swarmConfig = mockSwarmConfig();

  const config = resolveProviderConfig(swarmConfig, "anthropic-key-123", "claude-3-5-sonnet-latest");

  assert.equal(config.type, "anthropic");
  assert.equal(config.config.apiKey, "anthropic-key-123");
  assert.equal(config.config.model, "claude-3-5-sonnet-latest");
});

test("resolveProviderConfig preserves the legacy Anthropic endpoint", () => {
  const config = resolveProviderConfig(
    mockSwarmConfig(),
    "anthropic-key-123",
    "claude-3-5-sonnet-latest",
    "https://gateway.example.com/v1/messages"
  );

  assert.equal(config.type, "anthropic");
  assert.equal(config.config.baseURL, "https://gateway.example.com/v1/messages");
});

test("resolveProviderConfig throws if legacy Anthropic key is missing and no provider config exists", () => {
  const swarmConfig = mockSwarmConfig();

  assert.throws(() => {
    resolveProviderConfig(swarmConfig, undefined, "claude-3-5-sonnet-latest");
  }, /Anthropic API key is required/);
});

test("resolveProviderConfig respects configured apiKey in swarmConfig", () => {
  const swarmConfig = mockSwarmConfig({
    provider: {
      type: "openai",
      config: {
        apiKey: "config-openai-key",
        model: "gpt-4o",
      },
    },
  });

  const config = resolveProviderConfig(swarmConfig, undefined, "claude-3-5-sonnet-latest");

  assert.equal(config.type, "openai");
  assert.equal(config.config.apiKey, "config-openai-key");
});

test("resolveProviderConfig expands configured environment references", () => {
  const swarmConfig = mockSwarmConfig({
    provider: {
      type: "openai",
      config: { apiKey: "$OPENAI_API_KEY", model: "gpt-4o" },
    },
  });
  process.env.INPUT_OPENAI_API_KEY = "input-openai-key";

  try {
    const config = resolveProviderConfig(swarmConfig, undefined, "claude-3-5-sonnet-latest");
    assert.equal(config.config.apiKey, "input-openai-key");
  } finally {
    delete process.env.INPUT_OPENAI_API_KEY;
  }
});

test("resolveProviderConfig rejects an unresolved environment reference", () => {
  const swarmConfig = mockSwarmConfig({
    provider: {
      type: "openai",
      config: { apiKey: "${MISSING_SWARM_TEST_KEY}", model: "gpt-4o" },
    },
  });

  assert.throws(
    () => resolveProviderConfig(swarmConfig, undefined, "claude-3-5-sonnet-latest"),
    /MISSING_SWARM_TEST_KEY is not set/
  );
});

test("resolveProviderConfig resolves missing apiKey from environment variables / inputs", () => {
  const swarmConfig = mockSwarmConfig({
    provider: {
      type: "openai",
      config: {
        apiKey: "",
        model: "gpt-4o",
      },
    },
  });

  // Set environment variable
  process.env.INPUT_OPENAI_API_KEY = "env-openai-key";

  try {
    const config = resolveProviderConfig(swarmConfig, undefined, "claude-3-5-sonnet-latest");
    assert.equal(config.type, "openai");
    assert.equal(config.config.apiKey, "env-openai-key");
  } finally {
    delete process.env.INPUT_OPENAI_API_KEY;
  }
});

test("resolveProviderConfig throws if provider apiKey is missing and not found in environment", () => {
  const swarmConfig = mockSwarmConfig({
    provider: {
      type: "openai",
      config: {
        apiKey: "",
        model: "gpt-4o",
      },
    },
  });

  assert.throws(() => {
    resolveProviderConfig(swarmConfig, undefined, "claude-3-5-sonnet-latest");
  }, /Provider API key is required for openai/);
});
test("tokenTracker accumulates tokens per model correctly", () => {
  resetTokenTracker();

  trackTokens("claude-3-5-sonnet-latest", 1000, 500);
  trackTokens("claude-3-5-sonnet-latest", 2000, 1000);
  trackTokens("gpt-4o", 500, 100);

  assert.equal(tokenTracker.totalCalls, 3);
  assert.equal(tokenTracker.models["claude-3-5-sonnet-latest"].calls, 2);
  assert.equal(tokenTracker.models["claude-3-5-sonnet-latest"].inputTokens, 3000);
  assert.equal(tokenTracker.models["claude-3-5-sonnet-latest"].outputTokens, 1500);
  
  assert.equal(tokenTracker.models["gpt-4o"].calls, 1);
  assert.equal(tokenTracker.models["gpt-4o"].inputTokens, 500);
  assert.equal(tokenTracker.models["gpt-4o"].outputTokens, 100);
});

test("calculateEstimatedCost calculates cost based on model rates", () => {
  resetTokenTracker();

  // claude-3-5-sonnet-latest: input $3.0/M, output $15.0/M
  // 1,000,000 input = $3.0, 1,000,000 output = $15.0. Total = $18.0
  trackTokens("claude-3-5-sonnet-latest", 1_000_000, 1_000_000);

  const { cost, hasUnknown } = calculateEstimatedCost();
  assert.equal(cost, 18.0);
  assert.equal(hasUnknown, false);
});

test("calculateEstimatedCost flags unknown models", () => {
  resetTokenTracker();

  trackTokens("unknown-model", 1000, 1000);

  const { cost, hasUnknown } = calculateEstimatedCost();
  assert.equal(cost, 0);
  assert.equal(hasUnknown, true);
});
