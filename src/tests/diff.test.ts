import assert from "node:assert/strict";
import test from "node:test";

import { formatFileDiffs, globToRegex, getDiffLineNumbers, filterDiffForAgent } from "../diff.js";
import type { FileDiff } from "../types.js";

test("formatFileDiffs renders multiple files and large patches", () => {
  const files: FileDiff[] = [
    {
      path: "src/large.ts",
      status: "modified",
      additions: 10,
      deletions: 1,
      changes: 11,
      patch: "x".repeat(80),
    },
    {
      path: "src/extra.ts",
      status: "added",
      additions: 5,
      deletions: 0,
      changes: 5,
      patch: "+const a = 1;",
    },
  ];

  const rendered = formatFileDiffs(files);

  assert.match(rendered, /### src\/large\.ts/);
  assert.match(rendered, /### src\/extra\.ts/);
  assert.match(rendered, /```diff\nx{80}\n```/);
  assert.match(rendered, /```diff\n\+const a = 1;\n```/);
});

test("formatFileDiffs keeps metadata and separators within the total character budget", () => {
  const files: FileDiff[] = Array.from({ length: 1_001 }, (_, index) => ({
    path: `src/file-${index}.ts`,
    status: "modified",
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: "+x",
  }));

  const rendered = formatFileDiffs(files, {
    max_files: 5,
    max_patch_chars_per_file: 100,
    max_total_chars: 500,
    exclude_patterns: ["src/file-0.ts"],
  });

  assert.ok(rendered.length <= 500);
  assert.match(rendered, /total_files: 1001/);
  assert.match(rendered, /excluded_by_patterns: 1/);
});

test("globToRegex converts glob patterns correctly", () => {
  const r1 = globToRegex("*.spec.ts");
  assert.ok(r1.test("foo.spec.ts"));
  assert.ok(r1.test("src/foo.spec.ts"));
  assert.ok(!r1.test("foo.spec.ts.bak"));

  const r2 = globToRegex("dist/**");
  assert.ok(r2.test("dist/index.js"));
  assert.ok(r2.test("dist/sub/index.js"));
  assert.ok(!r2.test("src/dist/index.js"));

  const r3 = globToRegex("**/node_modules/**");
  assert.ok(r3.test("node_modules/foo/index.js"));
  assert.ok(r3.test("src/node_modules/foo/index.js"));
  assert.ok(!r3.test("src/node_modules_fake/index.js"));
});

test("formatFileDiffs respects glob patterns in exclude_patterns", () => {
  const files: FileDiff[] = [
    {
      path: "src/foo.spec.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      changes: 2,
      patch: "test",
    },
    {
      path: "dist/index.js",
      status: "added",
      additions: 10,
      deletions: 0,
      changes: 10,
      patch: "build",
    },
    {
      path: "src/index.ts",
      status: "modified",
      additions: 2,
      deletions: 2,
      changes: 4,
      patch: "code",
    },
  ];

  const rendered = formatFileDiffs(files, {
    exclude_patterns: ["*.spec.ts", "dist/**"],
  });

  assert.ok(!rendered.includes("src/foo.spec.ts"));
  assert.ok(!rendered.includes("dist/index.js"));
  assert.ok(rendered.includes("src/index.ts"));
});

test("getDiffLineNumbers parses unified diff hunk correctly", () => {
  const patch = [
    "@@ -1,4 +1,5 @@",
    "-old line",
    "+new line 1",
    "+new line 2",
    " context line",
    "@@ -10,2 +11,3 @@",
    " unchanged",
    "+added line",
  ].join("\n");

  const lineNumbers = getDiffLineNumbers(patch);

  assert.ok(lineNumbers.has(1));
  assert.ok(lineNumbers.has(2));
  assert.ok(lineNumbers.has(3));
  assert.ok(!lineNumbers.has(4));
  assert.ok(lineNumbers.has(11));
  assert.ok(lineNumbers.has(12));
  assert.ok(!lineNumbers.has(13));
});

test("filterDiffForAgent filters files by glob include/exclude patterns", () => {
  const files: FileDiff[] = [
    { path: "src/foo.ts", status: "modified", additions: 1, deletions: 1, changes: 2, patch: "" },
    { path: "src/foo.spec.ts", status: "modified", additions: 1, deletions: 1, changes: 2, patch: "" },
    { path: "dist/index.js", status: "added", additions: 1, deletions: 0, changes: 1, patch: "" },
  ];

  const agent1 = {
    name: "test-agent",
    mandate: "test",
    include_patterns: ["src/**"],
    exclude_patterns: ["*.spec.ts"],
  };

  const filtered = filterDiffForAgent(files, agent1);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].path, "src/foo.ts");
});

test("formatFileDiffs respects glob patterns in include_patterns", () => {
  const files: FileDiff[] = [
    { path: "src/foo.spec.ts", status: "modified", additions: 1, deletions: 1, changes: 2, patch: "test" },
    { path: "dist/index.js", status: "added", additions: 10, deletions: 0, changes: 10, patch: "build" },
    { path: "src/index.ts", status: "modified", additions: 2, deletions: 2, changes: 4, patch: "code" },
  ];

  const rendered = formatFileDiffs(files, {
    include_patterns: ["src/**"],
    exclude_patterns: ["*.spec.ts"],
  });

  assert.ok(!rendered.includes("src/foo.spec.ts"));
  assert.ok(!rendered.includes("dist/index.js"));
  assert.ok(rendered.includes("src/index.ts"));
});
