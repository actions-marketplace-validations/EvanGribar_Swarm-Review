import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";

import { createOctokit, fetchPullRequestDiff, formatFileDiffs, getDiffLineNumbers } from "./diff.js";
import { loadSwarmConfig, readInput, resolveProviderConfig } from "./config.js";
import { runDebateRounds } from "./agents/debate.js";
import { runReviewRound } from "./agents/review.js";
import { synthesizePrincipalSummary } from "./agents/principal.js";
import { upsertPullRequestComment, updateCheckRun, parsePositiveInteger, createPullRequestReview, getDeveloperFeedback, resolveReviewEvent } from "./github.js";
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_API_ENDPOINT } from "./llm.js";
import { renderDebateTranscriptMarkdown, formatInlineCommentBody } from "./format.js";
import { renderRequirementCoverageMarkdown } from "./format.js";
import { runStaticAnalysis } from "./static_analysis.js";
import { DEFAULT_PROVIDER_CONFIG, type ProviderConfig, type SwarmConfig, type Finding } from "./types.js";
import { tokenTracker, resetTokenTracker, calculateEstimatedCost } from "./providers.js";
import { buildCodebaseIndex } from "./context.js";
import { isTrustedRereviewActor, parseRereviewCommand } from "./events.js";
import { configureBudget, getBudgetStatus } from "./budget.js";
import { loadRequirementContract, normalizeCoverage, shouldRequestChangesForRequirements, writeRequirementArtifacts, coverageStats } from "./requirements.js";
import { evaluateRequirements } from "./agents/requirements.js";

type IssueCommentEventPayload = {
  issue?: { pull_request?: unknown };
  comment?: {
    body?: unknown;
    author_association?: unknown;
    user?: { type?: unknown };
  };
};



function resolveRepository(): { owner: string; repo: string } {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is required.");
  }

  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid GITHUB_REPOSITORY value: ${repository}`);
  }

  return { owner, repo };
}

async function writeActionOutput(name: string, value: string): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  await appendFile(outputPath, `${name}=${value.replace(/\r?\n/g, "%0A")}\n`, "utf8");
}

async function resolvePullRequestNumber(): Promise<number> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && existsSync(eventPath)) {
    try {
      const eventPayload = JSON.parse(await readFile(eventPath, "utf8")) as {
        pull_request?: { number?: number };
        issue?: { number?: number };
      };

      const pullNumber = eventPayload.pull_request?.number ?? eventPayload.issue?.number;
      if (typeof pullNumber === "number" && Number.isSafeInteger(pullNumber) && pullNumber > 0) {
        return pullNumber;
      }
    } catch {
      // Ignore malformed event payloads and fall back to explicit inputs.
    }
  }

  const fallback = readInput("pull-number");
  if (fallback) {
    const parsed = parsePositiveInteger(fallback);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  throw new Error("Unable to resolve the pull request number from the GitHub event payload.");
}



function buildStatsBlock(): string {
  const { cost, hasUnknown } = calculateEstimatedCost();
  let totalInput = 0;
  let totalOutput = 0;
  const breakdown: string[] = [];

  for (const [model, usage] of Object.entries(tokenTracker.models)) {
    totalInput += usage.inputTokens;
    totalOutput += usage.outputTokens;
    breakdown.push(`>   - \`${model}\`: ${usage.calls} calls, ${usage.inputTokens.toLocaleString()} input, ${usage.outputTokens.toLocaleString()} output`);
  }

  const costStr = hasUnknown
    ? `$${cost.toFixed(4)}+ USD (contains unknown model pricing)`
    : `$${cost.toFixed(4)} USD`;
  const budget = getBudgetStatus();
  const budgetLines = budget.config
    ? [
        `> - **Budget upper bound committed**: $${budget.committedUpperBoundUsd.toFixed(4)} / $${budget.config.max_cost_usd.toFixed(4)} USD`,
        `> - **Fallback / skipped calls**: ${budget.fallbackCalls} / ${budget.skippedCalls}`,
      ]
    : [];

  return [
    `> [!NOTE]`,
    `> ### 📊 Swarm-Review Statistics`,
    `> - **Total LLM Calls**: ${tokenTracker.totalCalls}`,
    `> - **Total Tokens**: ${totalInput.toLocaleString()} input / ${totalOutput.toLocaleString()} output`,
    `> - **Estimated Cost**: ${costStr}`,
    ...budgetLines,
    `> - **Usage Breakdown**:`,
    ...breakdown,
  ].join("\n");
}
async function main(): Promise<void> {
  const runStartedAt = new Date();
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const eventName = process.env.GITHUB_EVENT_NAME;
  let eventPayload: IssueCommentEventPayload | null = null;
  if (eventPath && existsSync(eventPath)) {
    try {
      eventPayload = JSON.parse(await readFile(eventPath, "utf8")) as IssueCommentEventPayload;
    } catch {
      // Ignore
    }
  }

  if (eventName === "issue_comment") {
    const isPR = eventPayload?.issue?.pull_request !== undefined;
    if (!isPR) {
      console.log("Triggered by issue_comment but not on a pull request. Skipping swarm-review.");
      return;
    }

    const comment = eventPayload?.comment;
    const command =
      typeof comment?.body === "string"
        ? parseRereviewCommand(comment.body)
        : undefined;
    if (!command) {
      console.log("Comment does not contain an exact '/swarm-review' command. Skipping swarm-review.");
      return;
    }

    if (
      !isTrustedRereviewActor(
        comment?.author_association,
        comment?.user?.type
      )
    ) {
      console.log("The re-review command author is not a repository owner, member, or collaborator. Skipping swarm-review.");
      return;
    }

    console.log(`Triggered by trusted conversational re-review command (${command}).`);
  }

  const githubToken = readInput("github-token") ?? process.env.GITHUB_TOKEN;
  const anthropicApiKey = readInput("anthropic-api-key") ?? process.env.ANTHROPIC_API_KEY;
  const anthropicModel = readInput("anthropic-model") ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  const apiEndpoint = readInput("api-endpoint") ?? process.env.API_ENDPOINT ?? DEFAULT_API_ENDPOINT;
  const configPath = readInput("config-path") ?? process.env.CONFIG_PATH ?? ".swarm.yml";
  const checkRunId = readInput("check-run-id") ?? process.env.CHECK_RUN_ID;

  if (!githubToken) {
    throw new Error("GitHub token is required.");
  }

  const workspaceRoot = process.cwd();
  const swarmConfig = await loadSwarmConfig(workspaceRoot, configPath);
  const requirementInput = swarmConfig.requirements.enabled
    ? await loadRequirementContract(workspaceRoot, swarmConfig.requirements)
    : undefined;
  const octokit = createOctokit(githubToken);
  const { owner, repo } = resolveRepository();
  const pullNumber = await resolvePullRequestNumber();

  const providerConfig = resolveProviderConfig(swarmConfig, anthropicApiKey, anthropicModel, apiEndpoint);

  console.log(`Running swarm-review for ${owner}/${repo}#${pullNumber}`);
  console.log(`Using provider: ${providerConfig.type}`);

  resetTokenTracker();
  configureBudget(swarmConfig.budget);

  const diff = await fetchPullRequestDiff(octokit, owner, repo, pullNumber);
  const linterFindings = await runStaticAnalysis(swarmConfig.static_analysis, workspaceRoot);

  console.log("Building codebase index for AST navigation...");
  const codebaseIndex = buildCodebaseIndex(workspaceRoot, swarmConfig.context_enrichment);
  console.log(`Indexed ${codebaseIndex.size} symbols.`);

  const reviewFindings = await runReviewRound({
    agents: swarmConfig.agents,
    diff,
    providerConfig,
    minConfidence: swarmConfig.debate.min_confidence,
    diffConfig: swarmConfig.diff,
    contextEnrichment: swarmConfig.context_enrichment,
    workspaceRoot,
    codebaseIndex,
  });

  const combinedFindings = [...reviewFindings, ...linterFindings];

  let developerFeedback: string[] = [];
  try {
    developerFeedback = await getDeveloperFeedback(octokit, owner, repo, pullNumber);
    if (developerFeedback.length > 0) {
      console.log(`Gathered ${developerFeedback.length} developer comment(s) from thread.`);
    }
  } catch (error) {
    console.log(`Warning: Failed to fetch developer feedback: ${error instanceof Error ? error.message : String(error)}`);
  }

  const transcript = await runDebateRounds({
    agents: swarmConfig.agents,
    diff,
    initialFindings: combinedFindings,
    rounds: swarmConfig.debate.rounds,
    providerConfig,
    minConfidence: swarmConfig.debate.min_confidence,
    diffConfig: swarmConfig.diff,
    contextEnrichment: swarmConfig.context_enrichment,
    workspaceRoot,
    codebaseIndex,
    developerFeedback,
  });

  const summary = await synthesizePrincipalSummary({
    principal: swarmConfig.principal,
    transcript,
    providerConfig,
  });

  let requirementCoverage: Awaited<ReturnType<typeof normalizeCoverage>> | undefined;
  let requirementArtifacts: Awaited<ReturnType<typeof writeRequirementArtifacts>> | undefined;
  if (requirementInput) {
    const decisions = await evaluateRequirements({
      contract: requirementInput.contract,
      diff,
      providerConfig,
      diffConfig: swarmConfig.diff,
      transcript,
    });
    requirementCoverage = normalizeCoverage(requirementInput.contract, decisions, {
      reviewer: { name: "swarm-review", version: "1.1.0" },
      target: { repository: `${owner}/${repo}`, commitSha: process.env.GITHUB_SHA, ref: process.env.GITHUB_REF },
      execution: { startedAt: runStartedAt.toISOString(), completedAt: new Date().toISOString(), runId: process.env.GITHUB_RUN_ID, metadata: { modelCallCount: tokenTracker.totalCalls, tokenUsage: tokenTracker.models, estimatedCostUsd: calculateEstimatedCost().cost, durationMs: Date.now() - runStartedAt.getTime() } },
      metadata: { requirementContractSource: swarmConfig.requirements.contract_path, pullNumber, baseSha: process.env.GITHUB_BASE_SHA, headSha: process.env.GITHUB_SHA },
    });
    requirementArtifacts = await writeRequirementArtifacts(workspaceRoot, requirementCoverage);
  }

  const statsBlock = buildStatsBlock();

  const headlineSummary = summary.summary.startsWith("## swarm-review")
    ? summary.summary
    : `## swarm-review\n\n${summary.summary}`;

  const baseCommentBody =
    swarmConfig.output.mode === "full"
      ? `${headlineSummary}${renderDebateTranscriptMarkdown(transcript)}`
      : headlineSummary;

  const requirementSection = requirementCoverage ? `\n\n${renderRequirementCoverageMarkdown(requirementCoverage)}` : "";
  const commentBody = `${baseCommentBody}${requirementSection}\n\n${statsBlock}`;

  const commentResult = await upsertPullRequestComment(octokit, owner, repo, pullNumber, commentBody);
  const checkRunUpdated = await updateCheckRun(octokit, owner, repo, checkRunId, commentBody);

  const isInline = readInput("inline") === "true" || swarmConfig.output.inline;
  const rawReviewEvent = readInput("review-event") || swarmConfig.output.review_event;
  let reviewEvent: "COMMENT" | "APPROVE" | "REQUEST_CHANGES" | "AUTO" = "COMMENT";
  if (rawReviewEvent === "APPROVE" || rawReviewEvent === "REQUEST_CHANGES" || rawReviewEvent === "AUTO") {
    reviewEvent = rawReviewEvent;
  }

  const acceptedFindings: { finding: Finding; decision?: string }[] = [];
  for (const finding of summary.agreements) {
    acceptedFindings.push({ finding });
  }
  for (const item of summary.final_calls) {
    const status = item.status;
    if (status === "accepted" || status === undefined) {
      acceptedFindings.push({ finding: item.finding, decision: item.decision });
    }
  }

  let actualEvent = resolveReviewEvent(
    reviewEvent,
    acceptedFindings,
    getBudgetStatus().exhausted
  );
  if (shouldRequestChangesForRequirements(swarmConfig.requirements, requirementCoverage, getBudgetStatus().exhausted)) {
    actualEvent = "REQUEST_CHANGES";
  }

  if (isInline || reviewEvent !== "COMMENT") {
    const validLinesMap = new Map<string, Set<number>>();
    for (const file of diff) {
      if (file.patch) {
        validLinesMap.set(file.path, getDiffLineNumbers(file.patch));
      }
    }

    const reviewComments: Array<{ path: string; line: number; body: string }> = [];
    if (isInline) {
      for (const item of acceptedFindings) {
        const { finding, decision } = item;
        const validLines = validLinesMap.get(finding.file);
        if (!validLines || !validLines.has(finding.line)) {
          console.log(`::warning::Skipping inline comment for ${finding.file}:${finding.line} because it is not within the diff hunk.`);
          continue;
        }

        const body = formatInlineCommentBody(finding, decision);
        reviewComments.push({
          path: finding.file,
          line: finding.line,
          body,
        });
      }
    }

    const reviewBody = `### Swarm-Review Complete\n\nStatus: **${actualEvent}**\n\nSee the main PR comment for the full debate transcript and detailed reasoning.`;
    await createPullRequestReview(
      octokit,
      owner,
      repo,
      pullNumber,
      actualEvent,
      reviewBody,
      reviewComments
    );
  }

  await writeActionOutput("pull-number", String(pullNumber));
  await writeActionOutput("output-mode", swarmConfig.output.mode);
  await writeActionOutput("comment-id", String(commentResult.commentId));
  await writeActionOutput("comment-action", commentResult.action);
  await writeActionOutput("check-run-updated", String(checkRunUpdated));

  let totalInput = 0;
  let totalOutput = 0;
  for (const usage of Object.values(tokenTracker.models)) {
    totalInput += usage.inputTokens;
    totalOutput += usage.outputTokens;
  }
  const { cost } = calculateEstimatedCost();

  await writeActionOutput("total-input-tokens", String(totalInput));
  await writeActionOutput("total-output-tokens", String(totalOutput));
  await writeActionOutput("total-cost", cost.toFixed(4));
  await writeActionOutput("total-calls", String(tokenTracker.totalCalls));

  if (requirementCoverage && requirementArtifacts) {
    const stats = coverageStats(requirementCoverage);
    await writeActionOutput("coverage-path", requirementArtifacts.coveragePath);
    await writeActionOutput("sarif-path", requirementArtifacts.sarifPath);
    await writeActionOutput("requirement-count", String(stats.requirementCount));
    await writeActionOutput("violated-count", String(stats.violatedCount));
    await writeActionOutput("not-verifiable-count", String(stats.notVerifiableCount));
  }

  if (commentResult.commentUrl) {
    await writeActionOutput("comment-url", commentResult.commentUrl);
  }

  console.log("swarm-review completed successfully.");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
