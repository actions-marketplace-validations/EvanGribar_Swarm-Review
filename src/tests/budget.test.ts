import assert from "node:assert/strict";
import test from "node:test";

import {
  BudgetExceededError,
  configureBudget,
  getBudgetStatus,
  reserveBudgetedCall,
  settleSuccessfulBudgetedCall,
} from "../budget.js";
import type { ProviderConfig } from "../types.js";
import { runAgentFindingRound } from "../agents/shared.js";
import { synthesizePrincipalSummary } from "../agents/principal.js";

const primary: ProviderConfig = {
  type: "openai",
  config: { apiKey: "test", model: "gpt-4o" },
};

test("budget guard reserves a conservative upper bound and clamps output tokens", (t) => {
  t.after(() => configureBudget(undefined));
  configureBudget({ max_cost_usd: 1, max_output_tokens: 1_000 });

  const reservation = reserveBudgetedCall(primary, "system", "prompt", 4_096);

  assert.equal(reservation.providerConfig.config.model, "gpt-4o");
  assert.equal(reservation.maxTokens, 1_000);
  assert.ok(reservation.reservedUsd > 0);
  assert.equal(getBudgetStatus().committedUpperBoundUsd, reservation.reservedUsd);
});

test("budget guard switches to a configured cheaper fallback", (t) => {
  t.after(() => configureBudget(undefined));
  configureBudget({
    max_cost_usd: 0.01,
    fallback_model: "gpt-4o-mini",
    max_output_tokens: 4_096,
  });

  const reservation = reserveBudgetedCall(primary, "system", "prompt", 4_096);

  assert.equal(reservation.providerConfig.config.model, "gpt-4o-mini");
  assert.equal(getBudgetStatus().fallbackCalls, 1);
});

test("successful calls release unused output reservation conservatively", (t) => {
  t.after(() => configureBudget(undefined));
  configureBudget({ max_cost_usd: 1, max_output_tokens: 1_000 });

  const reservation = reserveBudgetedCall(primary, "system", "prompt", 1_000);
  const before = getBudgetStatus().committedUpperBoundUsd;
  settleSuccessfulBudgetedCall(reservation, "short response");

  assert.ok(getBudgetStatus().committedUpperBoundUsd < before);
  assert.ok(getBudgetStatus().committedUpperBoundUsd > 0);
});

test("unsettled failed calls retain their worst-case reservation", (t) => {
  t.after(() => configureBudget(undefined));
  configureBudget({ max_cost_usd: 1, max_output_tokens: 1_000 });

  const reservation = reserveBudgetedCall(primary, "system", "prompt", 1_000);

  assert.equal(getBudgetStatus().committedUpperBoundUsd, reservation.reservedUsd);
});

test("budget guard refuses calls that would exceed the shared run cap", (t) => {
  t.after(() => configureBudget(undefined));
  configureBudget({ max_cost_usd: 0.001, max_output_tokens: 1_000 });

  assert.throws(
    () => reserveBudgetedCall(primary, "system", "prompt", 4_096),
    BudgetExceededError
  );
  assert.equal(getBudgetStatus().skippedCalls, 1);
  assert.equal(getBudgetStatus().exhausted, true);
});

test("budget guard rejects unknown pricing unless a known fallback fits", (t) => {
  t.after(() => configureBudget(undefined));
  configureBudget({ max_cost_usd: 1, max_output_tokens: 1_000 });
  const unknown: ProviderConfig = {
    type: "custom",
    config: { apiKey: "test", model: "private-model", baseURL: "https://example.com/v1" },
  };

  assert.throws(
    () => reserveBudgetedCall(unknown, "system", "prompt", 1_000),
    /pricing is unknown.*strict cost cap/i
  );
});

test("reviewer calls degrade to an empty result without issuing an unaffordable request", async (t) => {
  t.after(() => configureBudget(undefined));
  configureBudget({ max_cost_usd: 0.000001, max_output_tokens: 1_000 });
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const findings = await runAgentFindingRound({
    providerConfig: primary,
    system: "system",
    prompt: "prompt",
    agentName: "security",
    idPrefix: "review-security",
    minConfidence: 0.5,
  });

  assert.deepEqual(findings, []);
  assert.equal(fetchCalled, false);
});

test("principal synthesis defers findings when its call cannot fit", async (t) => {
  t.after(() => configureBudget(undefined));
  configureBudget({ max_cost_usd: 0.000001, max_output_tokens: 1_000 });
  const finding = {
    id: "review-security-1",
    agent: "security",
    severity: "blocking" as const,
    file: "src/app.ts",
    line: 10,
    claim: "Unsafe behavior.",
    confidence: 0.9,
  };

  const summary = await synthesizePrincipalSummary({
    principal: { mandate: "Synthesize." },
    transcript: { rounds: [[finding]], agents: [{ name: "security", mandate: "Review." }] },
    providerConfig: primary,
  });

  assert.equal(summary.final_calls[0]?.status, "deferred");
  assert.match(summary.summary, /budget was exhausted/i);
});
