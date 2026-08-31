import assert from "node:assert/strict";
import test from "node:test";

import { parsePositiveInteger, resolveReviewEvent, upsertPullRequestComment, updateCheckRun, getDeveloperFeedback } from "../github.js";

type MockComment = {
  id: number;
  body?: string;
  user?: {
    type?: string;
    login?: string;
  };
};


function createOctokitMock(comments: MockComment[] = []) {
  const state = {
    updated: [] as Array<Record<string, unknown>>,
    created: [] as Array<Record<string, unknown>>,
    checks: [] as Array<Record<string, unknown>>,
  };

  const octokit = {
    paginate: async () => comments,
    rest: {
      users: {
        getAuthenticated: async () => ({ data: { login: "swarm-bot" } }),
      },
      issues: {
        listComments: async () => ({ data: comments }),
        updateComment: async (args: Record<string, unknown>) => {
          state.updated.push(args);
          return { data: {} };
        },
        createComment: async (args: Record<string, unknown>) => {
          state.created.push(args);
          return { data: {} };
        },
      },
      checks: {
        update: async (args: Record<string, unknown>) => {
          state.checks.push(args);
          return { data: {} };
        },
      },
    },
  };

  return { octokit: octokit as unknown, state };
}

test("upsertPullRequestComment updates latest matching swarm comment", async () => {
  const { octokit, state } = createOctokitMock([
    { id: 1, body: "## swarm-review\n\nmanual user note", user: { type: "User" } },
    {
      id: 2,
      body: "## swarm-review\n\nexisting",
      user: { type: "User", login: "swarm-bot" },
    },
  ]);

  await upsertPullRequestComment(octokit as never, "owner", "repo", 12, "## swarm-review\n\nnew body");

  assert.equal(state.updated.length, 1);
  assert.equal(state.created.length, 0);
  assert.equal(state.updated[0]?.comment_id, 2);
  assert.match(String(state.updated[0]?.body), /new body/);
});

test("upsertPullRequestComment creates new comment when no swarm comment exists", async () => {
  const { octokit, state } = createOctokitMock([
    { id: 1, body: "regular discussion", user: { type: "User" } },
  ]);

  await upsertPullRequestComment(octokit as never, "owner", "repo", 12, "## swarm-review\n\nnew body");

  assert.equal(state.updated.length, 0);
  assert.equal(state.created.length, 1);
  assert.match(String(state.created[0]?.body), /new body/);
});

test("upsertPullRequestComment ignores spoofed managed markers from users", async () => {
  const { octokit, state } = createOctokitMock([
    {
      id: 1,
      body: "## swarm-review\n\nspoof\n\n<!-- swarm-review:managed-comment -->",
      user: { type: "User", login: "attacker" },
    },
  ]);

  await upsertPullRequestComment(octokit as never, "owner", "repo", 12, "## swarm-review\n\nnew body");

  assert.equal(state.updated.length, 0);
  assert.equal(state.created.length, 1);
});

test("upsertPullRequestComment ignores managed markers from other bots", async () => {
  const { octokit, state } = createOctokitMock([
    {
      id: 1,
      body: "## swarm-review\n\nspoof\n\n<!-- swarm-review:managed-comment -->",
      user: { type: "Bot", login: "other-bot" },
    },
  ]);

  await upsertPullRequestComment(octokit as never, "owner", "repo", 12, "## swarm-review\n\nnew body");

  assert.equal(state.updated.length, 0);
  assert.equal(state.created.length, 1);
});

test("updateCheckRun ignores non-numeric IDs and updates numeric IDs", async () => {
  const { octokit, state } = createOctokitMock();

  await updateCheckRun(octokit as never, "owner", "repo", "abc", "summary");
  await updateCheckRun(octokit as never, "owner", "repo", "1.2", "summary");
  await updateCheckRun(octokit as never, "owner", "repo", "-3", "summary");

  assert.equal(state.checks.length, 0);

  await updateCheckRun(octokit as never, "owner", "repo", "42", "summary");

  assert.equal(state.checks.length, 1);
  assert.equal(state.checks[0]?.check_run_id, 42);
});

test("parsePositiveInteger accepts only positive integer strings", () => {
  assert.equal(parsePositiveInteger("1"), 1);
  assert.equal(parsePositiveInteger("001"), 1);
  assert.equal(parsePositiveInteger("42"), 42);

  assert.equal(parsePositiveInteger("0"), undefined);
  assert.equal(parsePositiveInteger("-1"), undefined);
  assert.equal(parsePositiveInteger("1.2"), undefined);
  assert.equal(parsePositiveInteger("abc"), undefined);
  assert.equal(parsePositiveInteger(""), undefined);
  assert.equal(parsePositiveInteger(" 42 "), undefined);
  assert.equal(parsePositiveInteger("9007199254740992"), undefined);
});

test("getDeveloperFeedback gathers, filters, and formats comments after the latest bot comment", async () => {
  const { octokit } = createOctokitMock([
    {
      id: 1,
      body: "early developer comment - should be ignored",
      user: { type: "User", login: "alice" },
    },
    {
      id: 2,
      body: "## swarm-review\n\nbot summary comment\n\n<!-- swarm-review:managed-comment -->",
      user: { type: "User", login: "swarm-bot" },
    },
    {
      id: 3,
      body: "another bot reply - should be ignored",
      user: { type: "User", login: "swarm-bot" },
    },
    {
      id: 4,
      body: "/swarm-review debate\nWait, check line 24. Security agent is incorrect.",
      user: { type: "User", login: "bob" },
    },
    {
      id: 5,
      body: "   /swarm-review   ",
      user: { type: "User", login: "charlie" }, // should be cleaned to empty and ignored
    },
    {
      id: 6,
      body: "I agree with Bob.",
      user: { type: "User", login: "alice" },
    },
  ]);

  const feedback = await getDeveloperFeedback(octokit as never, "owner", "repo", 12);

  assert.equal(feedback.length, 2);
  assert.equal(feedback[0], "[bob]: Wait, check line 24. Security agent is incorrect.");
  assert.equal(feedback[1], "[alice]: I agree with Bob.");
});

test("getDeveloperFeedback returns empty if no bot comment is found", async () => {
  const { octokit } = createOctokitMock([
    {
      id: 1,
      body: "early developer comment",
      user: { type: "User", login: "alice" },
    },
  ]);

  const feedback = await getDeveloperFeedback(octokit as never, "owner", "repo", 12);
  assert.equal(feedback.length, 0);
});

test("getDeveloperFeedback bounds comment count and total prompt size", async () => {
  const comments: MockComment[] = [
    {
      id: 1,
      body: "## swarm-review\n\nsummary\n\n<!-- swarm-review:managed-comment -->",
      user: { type: "User", login: "swarm-bot" },
    },
    ...Array.from({ length: 25 }, (_, index) => ({
      id: index + 2,
      body: "x".repeat(5_000),
      user: { type: "User", login: `user-${index}` },
    })),
  ];
  const { octokit } = createOctokitMock(comments);

  const feedback = await getDeveloperFeedback(octokit as never, "owner", "repo", 12);

  assert.ok(feedback.length <= 20);
  assert.ok(feedback.reduce((total, entry) => total + entry.length, 0) <= 20_000);
  assert.match(feedback[0] ?? "", /^\[user-5\]:/);
});

test("resolveReviewEvent never approves after budget exhaustion", () => {
  assert.equal(resolveReviewEvent("APPROVE", [], true), "COMMENT");
  assert.equal(resolveReviewEvent("AUTO", [], true), "COMMENT");
});

test("resolveReviewEvent derives automatic review decisions", () => {
  const finding = {
    id: "finding-1",
    agent: "security",
    severity: "blocking" as const,
    file: "src/app.ts",
    line: 1,
    claim: "Unsafe behavior.",
    confidence: 0.9,
  };

  assert.equal(resolveReviewEvent("AUTO", [], false), "APPROVE");
  assert.equal(resolveReviewEvent("AUTO", [{ finding }], false), "REQUEST_CHANGES");
});
