import { buildReviewPrompt } from "../prompts.js";
import { filterDiffForAgent } from "../diff.js";
import type { AgentConfig, FileDiff, Finding, ProviderConfig, DiffConfig, ContextEnrichmentConfig } from "../types.js";
import { buildAgentSystemPrompt, runAgentFindingRound, resolveAgentProviderConfig } from "./shared.js";
import { gatherContextForDiff, type IndexedSymbol } from "../context.js";

export type ReviewRoundInput = {
  agents: AgentConfig[];
  diff: FileDiff[];
  providerConfig: ProviderConfig;
  minConfidence: number;
  diffConfig?: DiffConfig;
  contextEnrichment?: ContextEnrichmentConfig;
  workspaceRoot?: string;
  codebaseIndex?: Map<string, IndexedSymbol>;
};

export async function runReviewRound(input: ReviewRoundInput): Promise<Finding[]> {
  const system =
    "You are an independent reviewer in the first round of a pull request review swarm. Return only JSON and focus on real, reviewable issues.";

  const contextEnrichment = input.contextEnrichment ?? { enabled: false, max_depth: 1, file_size_limit_kb: 100 };
  const workspaceRoot = input.workspaceRoot ?? process.cwd();

  const findings = await Promise.all(
    input.agents.map(async (agent) => {
      const providerConfig = resolveAgentProviderConfig(agent, input.providerConfig);
      const filteredDiff = filterDiffForAgent(input.diff, agent);
      if (filteredDiff.length === 0) {
        console.log(`Skipping agent "${agent.name}" in review round: no matching files in diff.`);
        return [];
      }

      const codeContext = await gatherContextForDiff(
        filteredDiff,
        workspaceRoot,
        contextEnrichment,
        input.codebaseIndex
      );

      return runAgentFindingRound({
        providerConfig,
        system: buildAgentSystemPrompt(system, agent.system_prompt),
        prompt: buildReviewPrompt(agent, filteredDiff, input.diffConfig, codeContext),
        agentName: agent.name,
        idPrefix: `review-${agent.name}`,
        minConfidence: agent.min_confidence ?? input.minConfidence,
      });
    })
  );

  return findings.flat();
}
