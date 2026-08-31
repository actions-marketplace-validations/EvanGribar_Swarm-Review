import assert from "node:assert/strict";
import test from "node:test";

import { runDebateRounds } from "../agents/debate.js";
import type { AgentConfig, FileDiff, Finding } from "../types.js";

test("runDebateRounds appends each debate round to transcript", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const responses = [
    [
      {
        agent: "security",
        severity: "warning",
        file: "src/app.ts",
        line: 6,
        claim: "Input validation should be centralized.",
        confidence: 0.88,
        rebuttal_to: "review-security-1",
      },
    ],
    [],
  ];

  globalThis.fetch = (async () => {
    const payload = responses.shift() ?? [];
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: JSON.stringify(payload) }] }),
      { status: 200 }
    );
  }) as typeof fetch;

  const agents: AgentConfig[] = [{ name: "security", mandate: "Focus on security." }];
  const diff: FileDiff[] = [
    {
      path: "src/app.ts",
      status: "modified",
      additions: 8,
      deletions: 3,
      changes: 11,
      patch: "@@ -1,1 +1,2 @@",
    },
  ];
  const initialFindings: Finding[] = [
    {
      id: "review-security-1",
      agent: "security",
      severity: "blocking",
      file: "src/app.ts",
      line: 4,
      claim: "User input reaches SQL layer unsafely.",
      confidence: 0.93,
    },
  ];

  const transcript = await runDebateRounds({
    agents,
    diff,
    initialFindings,
    rounds: 2,
    providerConfig: { type: "anthropic", config: { apiKey: "test-key", model: "global-model" } },
    minConfidence: 0.6,
  });

  assert.equal(transcript.rounds.length, 3);
  assert.equal(transcript.rounds[0]?.length, 1);
  assert.equal(transcript.rounds[1]?.length, 1);
  assert.equal(transcript.rounds[2]?.length, 0);
  assert.equal(transcript.rounds[1]?.[0]?.id, "debate-1-security-1");
});

test("runDebateRounds uses custom system prompt and agent-specific confidence threshold", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const requestBodies: Array<{ system?: string; messages?: Array<{ content?: string }> }> = [];
  const responses = [
    [
      {
        agent: "security",
        severity: "warning",
        file: "src/app.ts",
        line: 6,
        claim: "Debate round 1 security finding.",
        confidence: 0.85,
        rebuttal_to: "review-security-1",
      },
    ],
    [],
  ];

  globalThis.fetch = (async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as { system?: string; messages?: Array<{ content?: string }> });
    const payload = responses.shift() ?? [];
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: JSON.stringify(payload) }] }),
      { status: 200 }
    );
  }) as typeof fetch;

  const agents: AgentConfig[] = [
    {
      name: "security",
      mandate: "Focus on security.",
      system_prompt: "Security debater prompt.",
      min_confidence: 0.7,
    },
  ];
  const diff: FileDiff[] = [
    {
      path: "src/app.ts",
      status: "modified",
      additions: 8,
      deletions: 3,
      changes: 11,
      patch: "@@ -1,1 +1,2 @@",
    },
  ];
  const initialFindings: Finding[] = [
    {
      id: "review-security-1",
      agent: "security",
      severity: "blocking",
      file: "src/app.ts",
      line: 4,
      claim: "User input reaches SQL layer unsafely.",
      confidence: 0.93,
    },
  ];

  const transcript = await runDebateRounds({
    agents,
    diff,
    initialFindings,
    rounds: 1,
    providerConfig: { type: "anthropic", config: { apiKey: "test-key", model: "global-model" } },
    minConfidence: 0.6,
    developerFeedback: ["[alice]: Please recheck line 22"],
  });

  assert.equal(transcript.rounds.length, 2);
  assert.equal(transcript.rounds[0]?.length, 1);
  assert.equal(transcript.rounds[1]?.length, 1);
  assert.equal(requestBodies.length, 1);
  assert.match(requestBodies[0]?.system ?? "", /Return only JSON/);
  assert.match(requestBodies[0]?.system ?? "", /Additional agent instructions:\nSecurity debater prompt\./);
  assert.match(requestBodies[0]?.messages?.[0]?.content ?? "", /Developer feedback and inputs:/);
  assert.match(requestBodies[0]?.messages?.[0]?.content ?? "", /- \[alice\]: Please recheck line 22/);
});
