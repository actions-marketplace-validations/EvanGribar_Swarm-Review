import { z } from "zod";
import type { RequirementContract } from "@specbridge/core";

import { BudgetExceededError } from "../budget.js";
import { callLLMStructured } from "../llm.js";
import { buildRequirementPrincipalPrompt, buildRequirementReviewPrompt } from "../prompts.js";
import type { DiffConfig, FileDiff, ProviderConfig } from "../types.js";
import type { RequirementDecision } from "../requirements.js";
import type { DebateTranscript } from "../types.js";

const DecisionSchema = z.object({
  requirementId: z.string().min(1),
  criterionId: z.string().min(1),
  status: z.enum(["satisfied", "violated", "not_verifiable", "not_applicable"]),
  explanation: z.string().min(1),
  evidence: z.array(z.object({ path: z.string().min(1), startLine: z.number().int().positive(), endLine: z.number().int().positive().optional(), symbol: z.string().min(1).optional(), explanation: z.string().min(1).optional(), uri: z.string().url().optional() })),
  confidence: z.number().min(0).max(1).optional(),
});
const DecisionArraySchema = z.array(DecisionSchema);

function unverifiable(contract: RequirementContract, reason: string): RequirementDecision[] {
  return contract.requirements.flatMap((requirement) => requirement.criteria.map((criterion) => ({ requirementId: requirement.id, criterionId: criterion.id, status: "not_verifiable" as const, explanation: reason, evidence: [] })));
}

export async function evaluateRequirements(input: { contract: RequirementContract; diff: FileDiff[]; providerConfig: ProviderConfig; diffConfig?: DiffConfig; codeContext?: string; transcript: DebateTranscript }): Promise<RequirementDecision[]> {
  try {
    const candidate = await callLLMStructured(input.providerConfig, "You are a precise requirement reviewer. Return only valid JSON.", buildRequirementReviewPrompt(input.contract, input.diff, input.diffConfig, input.codeContext), DecisionArraySchema);
    return await callLLMStructured(input.providerConfig, "You are a precise principal reviewer. Return only valid JSON.", buildRequirementPrincipalPrompt(input.contract, candidate, input.transcript), DecisionArraySchema);
  } catch (error) {
    if (error instanceof BudgetExceededError) return unverifiable(input.contract, "Not verifiable because the configured model budget was exhausted before coverage evaluation.");
    throw error;
  }
}
