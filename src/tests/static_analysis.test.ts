import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { runStaticAnalysis } from "../static_analysis.js";
import { type StaticAnalysisConfig, StaticAnalysisCommandSchema } from "../types.js";

test("runStaticAnalysis returns empty array when disabled", async () => {
  const config: StaticAnalysisConfig = {
    enabled: false,
    commands: [
      {
        name: "test-eslint",
        run: "node -e \"console.log('should not run')\"",
        parser: "eslint-json",
      },
    ],
  };

  const findings = await runStaticAnalysis(config);
  assert.deepEqual(findings, []);
});

test("runStaticAnalysis parses ESLint JSON format correctly from stdout", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "swarm-test-"));
  const mockReport = [
    {
      filePath: "src/index.ts",
      messages: [
        {
          line: 10,
          severity: 2,
          message: "Const reassignment error",
          ruleId: "no-const-assign",
        },
        {
          line: 20,
          severity: 1,
          message: "Unused variable warning",
          ruleId: "no-unused-vars",
        },
      ],
    },
  ];

  // We write a node command that prints the JSON to stdout
  const escapedJson = JSON.stringify(mockReport).replace(/"/g, '\\"');
  const config: StaticAnalysisConfig = {
    enabled: true,
    commands: [
      {
        name: "mock-eslint",
        run: `node -e "console.log('${escapedJson}')"`,
        parser: "eslint-json",
      },
    ],
  };

  const findings = await runStaticAnalysis(config, tempDir);

  assert.equal(findings.length, 2);
  
  assert.equal(findings[0]?.agent, "mock-eslint");
  assert.equal(findings[0]?.severity, "blocking");
  assert.equal(findings[0]?.file, "src/index.ts");
  assert.equal(findings[0]?.line, 10);
  assert.equal(findings[0]?.claim, "[no-const-assign] Const reassignment error");
  assert.equal(findings[0]?.confidence, 1.0);

  assert.equal(findings[1]?.agent, "mock-eslint");
  assert.equal(findings[1]?.severity, "warning");
  assert.equal(findings[1]?.file, "src/index.ts");
  assert.equal(findings[1]?.line, 20);
  assert.equal(findings[1]?.claim, "[no-unused-vars] Unused variable warning");
  assert.equal(findings[1]?.confidence, 1.0);

  await rm(tempDir, { recursive: true, force: true });
});

test("runStaticAnalysis parses ESLint JSON from output file when -o is present", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "swarm-test-"));
  const reportPath = path.join(tempDir, "eslint-output.json");

  const mockReport = [
    {
      filePath: path.join(tempDir, "src/utils.ts"),
      messages: [
        {
          line: 5,
          severity: 2,
          message: "Missing semicolon",
          ruleId: "semi",
        },
      ],
    },
  ];

  // We write the report to the file directly to simulate a linter writing it
  await writeFile(reportPath, JSON.stringify(mockReport), "utf8");

  // Run a command that does nothing but has -o eslint-output.json in its run script
  const config: StaticAnalysisConfig = {
    enabled: true,
    commands: [
      {
        name: "file-eslint",
        run: `node -e "console.log('done')" -o eslint-output.json`,
        parser: "eslint-json",
      },
    ],
  };

  const findings = await runStaticAnalysis(config, tempDir);

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.agent, "file-eslint");
  assert.equal(findings[0]?.severity, "blocking");
  assert.equal(findings[0]?.file, "src/utils.ts");
  assert.equal(findings[0]?.line, 5);
  assert.equal(findings[0]?.claim, "[semi] Missing semicolon");

  await rm(tempDir, { recursive: true, force: true });
});

test("runStaticAnalysis parses custom regex formats correctly", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "swarm-test-"));

  const config: StaticAnalysisConfig = {
    enabled: true,
    commands: [
      {
        name: "mock-compiler",
        run: `node -e "console.log('src/math.ts:15:5 - error TS2322: Type \\'string\\' is not assignable to type \\'number\\'.'); console.log('src/auth.ts:42:1 - warning TS6133: \\'secretKey\\' is declared but never used.'); console.log('some unrelated noise log line')"`,
        parser: "regex",
        regex: "(?<file>[^:]+):(?<line>\\d+):(?<column>\\d+) - (?<severity>error|warning) (?<claim>.+)",
      },
    ],
  };

  const findings = await runStaticAnalysis(config, tempDir);

  assert.equal(findings.length, 2);

  assert.equal(findings[0]?.agent, "mock-compiler");
  assert.equal(findings[0]?.severity, "blocking"); // "error" maps to blocking
  assert.equal(findings[0]?.file, "src/math.ts");
  assert.equal(findings[0]?.line, 15);
  assert.equal(findings[0]?.claim, "TS2322: Type 'string' is not assignable to type 'number'.");

  assert.equal(findings[1]?.agent, "mock-compiler");
  assert.equal(findings[1]?.severity, "warning"); // "warning" maps to warning
  assert.equal(findings[1]?.file, "src/auth.ts");
  assert.equal(findings[1]?.line, 42);
  assert.equal(findings[1]?.claim, "TS6133: 'secretKey' is declared but never used.");

  await rm(tempDir, { recursive: true, force: true });
});

test("StaticAnalysisCommandSchema enforces regex parameter when parser is regex", () => {

  // Should succeed for eslint-json without regex
  const res1 = StaticAnalysisCommandSchema.safeParse({
    parser: "eslint-json",
    name: "eslint",
    run: "eslint .",
  });
  assert.equal(res1.success, true);

  // Should succeed for regex with regex
  const res2 = StaticAnalysisCommandSchema.safeParse({
    parser: "regex",
    name: "tsc",
    run: "tsc --noEmit",
    regex: "(?<file>.*)",
  });
  assert.equal(res2.success, true);

  // Should fail for regex without regex
  const res3 = StaticAnalysisCommandSchema.safeParse({
    parser: "regex",
    name: "tsc",
    run: "tsc --noEmit",
  });
  assert.equal(res3.success, false);
});

test("runStaticAnalysis parses ESLint JSON from output file when explicit outputFile is configured", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "swarm-test-"));
  const reportPath = path.join(tempDir, "eslint-explicit.json");

  const mockReport = [
    {
      filePath: path.join(tempDir, "src/explicit.ts"),
      messages: [
        {
          line: 8,
          severity: 2,
          message: "Explicit file parsing error",
          ruleId: "explicit-rule",
        },
      ],
    },
  ];

  await writeFile(reportPath, JSON.stringify(mockReport), "utf8");

  // Explicitly configure outputFile, but do not use -o flag in run script
  const config: StaticAnalysisConfig = {
    enabled: true,
    commands: [
      {
        name: "explicit-eslint",
        run: `node -e "console.log('done')"`,
        parser: "eslint-json",
        outputFile: "eslint-explicit.json",
      },
    ],
  };

  const findings = await runStaticAnalysis(config, tempDir);

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.agent, "explicit-eslint");
  assert.equal(findings[0]?.severity, "blocking");
  assert.equal(findings[0]?.file, "src/explicit.ts");
  assert.equal(findings[0]?.line, 8);
  assert.equal(findings[0]?.claim, "[explicit-rule] Explicit file parsing error");

  await rm(tempDir, { recursive: true, force: true });
});
