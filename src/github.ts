import type { Octokit } from "@octokit/rest";
import { stripRereviewCommands } from "./events.js";
import type { Finding } from "./types.js";

const MANAGED_COMMENT_MARKER = "<!-- swarm-review:managed-comment -->";
const MAX_FEEDBACK_COMMENTS = 20;
const MAX_FEEDBACK_COMMENT_CHARS = 4_000;
const MAX_FEEDBACK_TOTAL_CHARS = 20_000;

export type UpsertPullRequestCommentResult = {
  action: "created" | "updated";
  commentId: number;
  commentUrl?: string;
};

export function parsePositiveInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveReviewEvent(
  requested: "COMMENT" | "APPROVE" | "REQUEST_CHANGES" | "AUTO",
  acceptedFindings: Array<{ finding: Finding }>,
  budgetExhausted: boolean
): "COMMENT" | "APPROVE" | "REQUEST_CHANGES" {
  if (budgetExhausted) {
    return "COMMENT";
  }
  if (requested === "APPROVE" || requested === "REQUEST_CHANGES") {
    return requested;
  }
  if (requested !== "AUTO") {
    return "COMMENT";
  }
  if (acceptedFindings.some((item) => item.finding.severity === "blocking")) {
    return "REQUEST_CHANGES";
  }
  return acceptedFindings.length === 0 ? "APPROVE" : "COMMENT";
}

function withManagedCommentMarker(body: string): string {
  if (body.includes(MANAGED_COMMENT_MARKER)) {
    return body;
  }

  return `${body}\n\n${MANAGED_COMMENT_MARKER}`;
}

function isSwarmBotComment(
  comment: { body?: string | null; user?: { type?: string; login?: string } | null },
  botLogin: string | undefined
): boolean {
  const isAuthenticatedActor = botLogin
    ? comment.user?.login === botLogin
    : comment.user?.type?.toLowerCase() === "bot";

  return Boolean(
    isAuthenticatedActor &&
      (comment.body?.includes(MANAGED_COMMENT_MARKER) || comment.body?.startsWith("## swarm-review"))
  );
}

export async function upsertPullRequestComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string
): Promise<UpsertPullRequestCommentResult> {
  const managedBody = withManagedCommentMarker(body);

  const [comments, authenticatedUser] = await Promise.all([
    octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 100,
    }),
    octokit.rest.users.getAuthenticated()
      .then((res) => res.data)
      .catch(() => null),
  ]);

  const existingComment = [...comments]
    .reverse()
    .find((comment) => isSwarmBotComment(comment, authenticatedUser?.login));

  if (existingComment) {
    const response = await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body: managedBody,
    });

    return {
      action: "updated",
      commentId: response.data.id,
      commentUrl: response.data.html_url,
    };
  }

  const response = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body: managedBody,
  });

  return {
    action: "created",
    commentId: response.data.id,
    commentUrl: response.data.html_url,
  };
}

export async function updateCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  checkRunId: string | undefined,
  summary: string
): Promise<boolean> {
  if (!checkRunId) {
    return false;
  }

  const numericCheckRunId = parsePositiveInteger(checkRunId);
  if (numericCheckRunId === undefined) {
    return false;
  }

  await octokit.rest.checks.update({
    owner,
    repo,
    check_run_id: numericCheckRunId,
    status: "completed",
    conclusion: "neutral",
    output: {
      title: "swarm-review",
      summary: summary.length > 65535 ? summary.slice(0, 65530) + "..." : summary,
    },
  });

  return true;
}

export async function createPullRequestReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES",
  body: string,
  comments: Array<{ path: string; line: number; body: string }>
): Promise<void> {
  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    event,
    body: body.length > 65535 ? body.slice(0, 65530) + "..." : body,
    comments: comments.map((c) => ({
      path: c.path,
      line: c.line,
      body: c.body,
      side: "RIGHT",
    })),
  });
}

export async function getDeveloperFeedback(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<string[]> {
  const [comments, authenticatedUser] = await Promise.all([
    octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 100,
    }),
    octokit.rest.users.getAuthenticated()
      .then((res) => res.data)
      .catch(() => null),
  ]);

  const botLogin = authenticatedUser?.login;

  const latestBotCommentIndex = comments.reduce((latestIdx, comment, idx) => {
    return isSwarmBotComment(comment, botLogin) ? idx : latestIdx;
  }, -1);

  if (latestBotCommentIndex === -1) {
    return [];
  }

  const feedbackComments = comments
    .slice(latestBotCommentIndex + 1)
    .slice(-MAX_FEEDBACK_COMMENTS);
  const developerFeedback: string[] = [];
  let totalChars = 0;

  for (const comment of feedbackComments) {
    if (
      comment.user?.type?.toLowerCase() === "bot" ||
      Boolean(botLogin && comment.user?.login === botLogin)
    ) {
      continue;
    }

    const login = comment.user?.login ?? "developer";
    const body = comment.body ?? "";
    const cleanedBody = stripRereviewCommands(body).slice(0, MAX_FEEDBACK_COMMENT_CHARS);

    if (cleanedBody.length > 0) {
      const remainingChars = MAX_FEEDBACK_TOTAL_CHARS - totalChars;
      if (remainingChars <= 0) {
        break;
      }

      const entry = `[${login}]: ${cleanedBody}`.slice(0, remainingChars);
      developerFeedback.push(entry);
      totalChars += entry.length;
    }
  }

  return developerFeedback;
}
