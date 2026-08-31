import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { evaluateRequirements } from "../agents/requirements.js";
import { renderRequirementCoverageMarkdown } from "../format.js";
import { hasBlockingRequirementViolation, loadRequirementContract, normalizeCoverage, shouldRequestChangesForRequirements, writeRequirementArtifacts } from "../requirements.js";
import type { DebateTranscript } from "../types.js";

const contract = { schemaVersion: "1.0", id: "offline-project-limits", title: "Offline project limits", source: { type: "json", path: ".specbridge/requirements.json" }, requirements: [{ id: "REQ-FREE-3", title: "Free project limit", description: "Free users are limited to three projects.", severity: "blocking", source: { type: "json", path: ".specbridge/requirements.json" }, criteria: [{ id: "api-rejects-fourth", description: "The API rejects a fourth project." }, { id: "ui-upgrade-prompt", description: "The UI displays an upgrade prompt." }, { id: "existing-projects-unchanged", description: "Existing projects remain unchanged." }] }] };
const decisions = [{ requirementId: "REQ-FREE-3", criterionId: "api-rejects-fourth", status: "satisfied", explanation: "The API count guard rejects the fourth project.", evidence: [], confidence: 0.94 }, { requirementId: "REQ-FREE-3", criterionId: "ui-upgrade-prompt", status: "violated", explanation: "The UI limit branch does not render an upgrade prompt.", evidence: [{ path: "src/api/projects.ts", startLine: 12, endLine: 14 }], confidence: 0.96 }, { requirementId: "REQ-FREE-3", criterionId: "existing-projects-unchanged", status: "not_verifiable", explanation: "The changed API path does not expose mutation behavior for existing projects.", evidence: [], confidence: 0.61 }];

export async function runOfflineSpecBridgeValidation(root?: string): Promise<{ root: string; coveragePath: string; sarifPath: string }> {
  root ??= await mkdtemp(path.join(os.tmpdir(), "swarm-specbridge-offline-"));
  await mkdir(path.join(root, ".specbridge"), { recursive: true });
  await mkdir(path.join(root, "src", "api"), { recursive: true });
  await writeFile(path.join(root, ".specbridge", "requirements.json"), JSON.stringify(contract));
  await writeFile(path.join(root, "src", "api", "projects.ts"), "export const projectLimit = 3;\n// UI does not render an upgrade prompt.\n");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(decisions) }], usage: { input_tokens: 0, output_tokens: 0 } }), { status: 200 });
  }) as typeof fetch;
  try {
    const loaded = await loadRequirementContract(root, { enabled: true, contract_path: ".specbridge/requirements.json", fail_on_violation: false, upload_sarif: false, max_file_size_kb: 256 });
    const transcript: DebateTranscript = { agents: [], rounds: [] };
    const evaluated = await evaluateRequirements({ contract: loaded.contract, diff: [{ path: "src/api/projects.ts", status: "modified", additions: 2, deletions: 0, changes: 2, patch: "@@ -0,0 +1,2 @@\n+export const projectLimit = 3;\n+// UI does not render an upgrade prompt." }], providerConfig: { type: "anthropic", config: { apiKey: "offline-test-only", model: "claude-3-5-haiku-latest" } }, transcript });
    assert.equal(calls, 2, "fixture must enter both real structured LLM calls");
    const coverage = normalizeCoverage(loaded.contract, evaluated, { reviewer: { name: "swarm-review", version: "offline-validation" }, target: { repository: "offline/validation" } });
    assert.deepEqual(coverage.requirements[0]?.criteria.map((item) => item.status), ["satisfied", "violated", "not_verifiable"]);
    assert.equal(hasBlockingRequirementViolation(coverage), true);
    assert.equal(shouldRequestChangesForRequirements({ fail_on_violation: false }, coverage, false), false);
    assert.equal(shouldRequestChangesForRequirements({ fail_on_violation: true }, coverage, false), true);
    assert.equal(shouldRequestChangesForRequirements({ fail_on_violation: true }, coverage, true), false);
    const artifacts = await writeRequirementArtifacts(root, coverage);
    const sarif = JSON.parse(await readFile(artifacts.sarifPath, "utf8"));
    assert.equal(sarif.runs[0].results.length, 1);
    assert.equal(sarif.runs[0].results[0].ruleId, "specbridge/REQ-FREE-3/ui-upgrade-prompt");
    assert.ok(sarif.runs[0].results[0].partialFingerprints["specbridge/v1"]);
    const markdown = renderRequirementCoverageMarkdown(coverage);
    assert.match(markdown, /Requirement coverage/);
    assert.match(markdown, /not verifiable/);
    const unverifiableOnly = normalizeCoverage(loaded.contract, decisions.map((item) => ({ ...item, status: "not_verifiable" as const, evidence: [] })), { reviewer: { name: "x" }, target: {} });
    assert.equal(hasBlockingRequirementViolation(unverifiableOnly), false);
    assert.equal(shouldRequestChangesForRequirements({ fail_on_violation: true }, unverifiableOnly, false), false);
    await writeFile(path.join(root, "coverage-table.md"), `${markdown}\n`);
    return { root, ...artifacts };
  } finally { globalThis.fetch = originalFetch; }
}

if (process.env.SWARM_OFFLINE_VALIDATION === "1") {
  const output = path.resolve("offline-specbridge-validation-output");
  runOfflineSpecBridgeValidation(output).then(({ coveragePath, sarifPath }) => console.log(JSON.stringify({ coveragePath, sarifPath }))).catch((error) => { console.error(error); process.exitCode = 1; });
}
