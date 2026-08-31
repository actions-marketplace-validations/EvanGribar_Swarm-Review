import { buildDebatePrompt } from "../prompts.js";
import { filterDiffForAgent } from "../diff.js";
import type { AgentConfig, DebateTranscript, FileDiff, Finding, ProviderConfig, DiffConfig, ContextEnrichmentConfig } from "../types.js";
import { buildAgentSystemPrompt, runAgentFindingRound, resolveAgentProviderConfig } from "./shared.js";
import { gatherContextForDiff, type IndexedSymbol } from "../context.js";

export type DebateRoundInput = {
  agents: AgentConfig[];
  diff: FileDiff[];
  initialFindings: Finding[];
  rounds: number;
  providerConfig: ProviderConfig;
  minConfidence: number;
  diffConfig?: DiffConfig;
  contextEnrichment?: ContextEnrichmentConfig;
  workspaceRoot?: string;
  codebaseIndex?: Map<string, IndexedSymbol>;
  developerFeedback?: string[];
};

export async function runDebateRounds(input: DebateRoundInput): Promise<DebateTranscript> {
  const transcript: DebateTranscript = {
    rounds: [input.initialFindings],
    agents: input.agents,
  };

  const system =
    "You are a reviewer in the debate phase of a pull request review swarm. Respond to the transcript, challenge weak claims, and add new findings only when justified. Return only JSON.";

  const contextEnrichment = input.contextEnrichment ?? { enabled: false, max_depth: 1, file_size_limit_kb: 100 };
  const workspaceRoot = input.workspaceRoot ?? process.cwd();

  for (let debateRound = 1; debateRound <= input.rounds; debateRound += 1) {
    const currentTranscript: DebateTranscript = {
      rounds: transcript.rounds,
      agents: transcript.agents,
    };

    const roundFindings = await Promise.all(
      input.agents.map(async (agent) => {
        const providerConfig = resolveAgentProviderConfig(agent, input.providerConfig);
        const filteredDiff = filterDiffForAgent(input.diff, agent);
        if (filteredDiff.length === 0) {
          console.log(`Skipping agent "${agent.name}" in debate round ${debateRound}: no matching files in diff.`);
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
          prompt: buildDebatePrompt(agent, filteredDiff, currentTranscript, debateRound, input.diffConfig, codeContext, input.developerFeedback),
          agentName: agent.name,
          idPrefix: `debate-${debateRound}-${agent.name}`,
          minConfidence: agent.min_confidence ?? input.minConfidence,
        });
      })
    );

    transcript.rounds.push(roundFindings.flat());
  }

  return transcript;
}
