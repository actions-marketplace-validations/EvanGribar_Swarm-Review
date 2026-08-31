import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadRequirementContract, normalizeCoverage, writeRequirementArtifacts } from "../requirements.js";
import { renderRequirementCoverageMarkdown } from "../format.js";

const config = { enabled: true, contract_path: ".specbridge/requirements.json", fail_on_violation: false, upload_sarif: false, max_file_size_kb: 256 };
const contract = { schemaVersion: "1.0", id: "limits", title: "Limits", source: { type: "json", path: ".specbridge/requirements.json" }, requirements: [{ id: "REQ-1", title: "Limit", description: "A limit", severity: "blocking", source: { type: "json", path: ".specbridge/requirements.json" }, criteria: [{ id: "reject-fourth", description: "Reject fourth" }] }] };

test("loads a validated contract and rejects traversal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "swarm-requirements-"));
  await mkdir(path.join(root, ".specbridge"));
  await writeFile(path.join(root, ".specbridge", "requirements.json"), JSON.stringify(contract));
  assert.equal((await loadRequirementContract(root, config)).contract.id, "limits");
  await assert.rejects(loadRequirementContract(root, { ...config, contract_path: "../requirements.json" }), /escapes/);
});

test("generates validated coverage, SARIF, and escaped coverage markdown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "swarm-requirements-"));
  const report = normalizeCoverage(contract as never, [{ requirementId: "REQ-1", criterionId: "reject-fourth", status: "violated", explanation: "Missing <check>", evidence: [{ path: "src/projects.ts", startLine: 12 }], confidence: 0.9 }], { reviewer: { name: "swarm-review" }, target: { repository: "example/repo" } });
  const artifacts = await writeRequirementArtifacts(root, report);
  assert.equal(JSON.parse(await readFile(artifacts.sarifPath, "utf8")).runs[0].results.length, 1);
  assert.match(renderRequirementCoverageMarkdown(report), /Requirement coverage/);
  assert.throws(() => normalizeCoverage(contract as never, [{ requirementId: "unknown", criterionId: "nope", status: "satisfied", explanation: "x", evidence: [] }], { reviewer: { name: "x" }, target: {} }), /Unknown/);
});
