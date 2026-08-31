import { formatFileDiffs } from "./diff.js";
import type { AgentConfig, DebateTranscript, FileDiff, PrincipalConfig, DiffConfig } from "./types.js";
import type { RequirementContract } from "@specbridge/core";

function baseInstructions(): string {
  return [
    "Return only valid JSON.",
    "Do not include markdown fences, preamble, or commentary.",
    "Treat omitted or truncated diffs as unknown context, not evidence of correctness.",
    "Use plain English claims.",
  ].join(" ");
}

export function buildReviewPrompt(
  agent: AgentConfig,
  diff: FileDiff[],
  diffConfig?: DiffConfig,
  codeContext?: string
): string {
  const parts = [
    `Agent name: ${agent.name}`,
    `Mandate: ${agent.mandate}`,
  ];

  if (codeContext && codeContext.trim()) {
    parts.push(codeContext.trim());
  }

  parts.push(
    `Full diff:\n${formatFileDiffs(diff, diffConfig)}`,
    `Instructions: ${baseInstructions()} Return a JSON array of findings that match the swarm contract. Include id, agent, severity, file, line, claim, confidence, and optional rebuttal_to.`
  );

  return parts.join("\n\n");
}

export function buildDebatePrompt(
  agent: AgentConfig,
  diff: FileDiff[],
  transcript: DebateTranscript,
  debateRound: number,
  diffConfig?: DiffConfig,
  codeContext?: string,
  developerFeedback?: string[]
): string {
  const parts = [
    `Agent name: ${agent.name}`,
    `Mandate: ${agent.mandate}`,
    `Debate round: ${debateRound}`,
  ];

  if (codeContext && codeContext.trim()) {
    parts.push(codeContext.trim());
  }

  if (developerFeedback && developerFeedback.length > 0) {
    parts.push(
      `Developer feedback and inputs:\n${developerFeedback.map((f) => `- ${f}`).join("\n")}`
    );
  }

  parts.push(
    `Full diff:\n${formatFileDiffs(diff, diffConfig)}`,
    `Prior transcript:\n${JSON.stringify(transcript, null, 2)}`,
    `Instructions: ${baseInstructions()} Return a JSON array of new findings or rebuttals for this round. Each finding should target the existing transcript when relevant via rebuttal_to.`
  );

  return parts.join("\n\n");
}

export function buildPrincipalPrompt(
  principal: PrincipalConfig,
  transcript: DebateTranscript
): string {
  return [
    `Principal mandate: ${principal.mandate}`,
    `Full debate transcript:\n${JSON.stringify(transcript, null, 2)}`,
    `Instructions: ${baseInstructions()} Return a JSON object matching the principal summary contract with agreements, disputes, final_calls, and summary. The summary field must be the markdown block that should be posted to GitHub.`,
  ].join("\n\n");
}

export function buildRequirementReviewPrompt(contract: RequirementContract, diff: FileDiff[], diffConfig?: DiffConfig, codeContext?: string): string {
  return [
    "You are the requirement-review specialist in a pull-request review swarm.",
    `Requirement contract:\n${JSON.stringify(contract, null, 2)}`,
    ...(codeContext?.trim() ? [codeContext.trim()] : []),
    `Full diff:\n${formatFileDiffs(diff, diffConfig)}`,
    "Instructions: Return only a JSON array. Produce exactly one result for every supplied criterion and no other IDs. Each result has requirementId, criterionId, status (satisfied|violated|not_verifiable|not_applicable), explanation, evidence, and optional confidence. Evaluate only these acceptance criteria. Use violated only for missing or incorrect required behavior with concrete repository-relative source evidence; do not map unrelated code-quality concerns to violations. Use not_verifiable when diff/context are insufficient; use not_applicable only when this change genuinely does not concern the criterion. Never invent IDs or evidence. Evidence items require path and startLine and may include endLine, symbol, explanation, and uri.",
  ].join("\n\n");
}

export function buildRequirementPrincipalPrompt(contract: RequirementContract, decisions: unknown, transcript: DebateTranscript): string {
  return [
    "You are the principal engineer making canonical requirement coverage decisions.",
    `Requirement contract:\n${JSON.stringify(contract, null, 2)}`,
    `Candidate requirement decisions:\n${JSON.stringify(decisions, null, 2)}`,
    `Existing review debate transcript (may challenge evidence but does not create criterion IDs):\n${JSON.stringify(transcript, null, 2)}`,
    "Instructions: Return only a JSON array. Produce exactly one final result for every supplied criterion and no other IDs. Use the required result shape: requirementId, criterionId, status, explanation, evidence, optional confidence. Preserve valid source evidence, reject duplicate or unknown IDs, keep confidence in [0,1], and use not_verifiable when the evidence is insufficient. A violated result must contain valid repository-relative source evidence. Do not include private reasoning.",
  ].join("\n\n");
}
