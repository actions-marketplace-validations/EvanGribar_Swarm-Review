import { callLLMStructured } from "../llm.js";
import { buildPrincipalPrompt } from "../prompts.js";
import { PrincipalSummarySchema, type DebateTranscript, type PrincipalConfig, type PrincipalSummary, type ProviderConfig } from "../types.js";
import { BudgetExceededError } from "../budget.js";

export type PrincipalRoundInput = {
  principal: PrincipalConfig;
  transcript: DebateTranscript;
  providerConfig: ProviderConfig;
};

export async function synthesizePrincipalSummary(input: PrincipalRoundInput): Promise<PrincipalSummary> {
  try {
    return await callLLMStructured(
      input.providerConfig,
      input.principal.mandate,
      buildPrincipalPrompt(input.principal, input.transcript),
      PrincipalSummarySchema
    );
  } catch (error) {
    if (!(error instanceof BudgetExceededError)) {
      throw error;
    }

    const findings = input.transcript.rounds.flat();
    return {
      agreements: [],
      disputes: [],
      final_calls: findings.map((finding) => ({
        finding,
        decision: "Deferred for manual review because the configured model budget was exhausted.",
        status: "deferred" as const,
      })),
      summary:
        "## swarm-review\n\nThe configured model budget was exhausted before principal synthesis. " +
        "Automated findings remain unsynthesized and require manual review.",
    };
  }
}
