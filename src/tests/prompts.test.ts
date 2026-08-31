import assert from "node:assert/strict";
import test from "node:test";

import { buildDebatePrompt, buildPrincipalPrompt, buildReviewPrompt } from "../prompts.js";
import type { AgentConfig, DebateTranscript, FileDiff, PrincipalConfig } from "../types.js";

const agent: AgentConfig = {
  name: "security",
  mandate: "Find security issues.",
};

const diff: FileDiff[] = [
  {
    path: "src/app.ts",
    status: "modified",
    additions: 3,
    deletions: 1,
    changes: 4,
    patch: "@@ -1,1 +1,2 @@",
  },
];

const transcript: DebateTranscript = {
  agents: [agent],
  rounds: [
    [
      {
        id: "review-security-1",
        agent: "security",
        severity: "warning",
        file: "src/app.ts",
        line: 2,
        claim: "Use input validation before processing.",
        confidence: 0.8,
      },
    ],
  ],
};

const principal: PrincipalConfig = {
  mandate: "Make final calls.",
};

test("buildReviewPrompt includes mandate, diff, and strict JSON instructions", () => {
  const prompt = buildReviewPrompt(agent, diff);

  assert.match(prompt, /Agent name: security/);
  assert.match(prompt, /Mandate: Find security issues\./);
  assert.match(prompt, /Full diff:/);
  assert.match(prompt, /Return only valid JSON\./);
});

test("buildDebatePrompt includes round and prior transcript", () => {
  const prompt = buildDebatePrompt(agent, diff, transcript, 2);

  assert.match(prompt, /Debate round: 2/);
  assert.match(prompt, /Prior transcript:/);
  assert.match(prompt, /review-security-1/);
});

test("buildDebatePrompt includes developer feedback if provided", () => {
  const prompt = buildDebatePrompt(agent, diff, transcript, 2, undefined, undefined, [
    "[alice]: Please recheck line 22",
    "[bob]: Yes, agreed",
  ]);

  assert.match(prompt, /Developer feedback and inputs:/);
  assert.match(prompt, /- \[alice\]: Please recheck line 22/);
  assert.match(prompt, /- \[bob\]: Yes, agreed/);
});

test("buildPrincipalPrompt includes transcript and principal contract instruction", () => {
  const prompt = buildPrincipalPrompt(principal, transcript);

  assert.match(prompt, /Principal mandate: Make final calls\./);
  assert.match(prompt, /Full debate transcript:/);
  assert.match(prompt, /principal summary contract/);
});
