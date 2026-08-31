import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  SCHEMA_VERSION,
  parseContract,
  parseCoverageReport,
  type CriterionCoverage,
  type RequirementContract,
  type ReviewCoverageReport,
} from "@specbridge/core";
import { toSarif } from "@specbridge/sarif";

import type { RequirementsConfig } from "./types.js";

export type RequirementDecision = CriterionCoverage & { requirementId: string };

function safeContractPath(workspaceRoot: string, contractPath: string): string {
  if (path.isAbsolute(contractPath) || /^[a-zA-Z]:[\\/]/.test(contractPath)) {
    throw new Error("Requirement contract path must be repository-relative.");
  }
  const resolved = path.resolve(workspaceRoot, contractPath);
  const relative = path.relative(workspaceRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Requirement contract path escapes the repository workspace.");
  }
  return resolved;
}

export async function loadRequirementContract(
  workspaceRoot: string,
  config: RequirementsConfig
): Promise<{ contract: RequirementContract; sourcePath: string }> {
  const sourcePath = safeContractPath(workspaceRoot, config.contract_path);
  let fileInfo: Awaited<ReturnType<typeof stat>>;
  try {
    fileInfo = await stat(sourcePath);
  } catch {
    throw new Error(`Requirement-aware review is enabled but contract was not found: ${config.contract_path}`);
  }
  if (!fileInfo.isFile()) throw new Error(`Requirement contract is not a file: ${config.contract_path}`);
  if (fileInfo.size > config.max_file_size_kb * 1024) {
    throw new Error(`Requirement contract exceeds ${config.max_file_size_kb} KB limit.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to parse requirement contract JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof raw === "object" && raw !== null && "schemaVersion" in raw && (raw as { schemaVersion?: unknown }).schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported SpecBridge schema version; expected ${SCHEMA_VERSION}.`);
  }
  try {
    return { contract: parseContract(raw), sourcePath };
  } catch (error) {
    throw new Error(`Invalid SpecBridge requirement contract: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function normalizeCoverage(
  contract: RequirementContract,
  decisions: RequirementDecision[],
  metadata: Omit<ReviewCoverageReport, "schemaVersion" | "contractId" | "requirements">
): ReviewCoverageReport {
  const expected = new Map<string, string>();
  for (const requirement of contract.requirements) for (const criterion of requirement.criteria) expected.set(`${requirement.id}:${criterion.id}`, criterion.id);
  const supplied = new Map<string, RequirementDecision>();
  for (const decision of decisions) {
    const key = `${decision.requirementId}:${decision.criterionId}`;
    if (!expected.has(key)) throw new Error(`Unknown requirement criterion decision: ${key}`);
    if (supplied.has(key)) throw new Error(`Duplicate requirement criterion decision: ${key}`);
    if (decision.status === "violated" && decision.evidence.length === 0) throw new Error(`Violated criterion ${key} requires source-code evidence.`);
    supplied.set(key, decision);
  }
  const requirements = contract.requirements.map((requirement) => ({
    requirementId: requirement.id,
    ...(requirement.severity ? { severity: requirement.severity } : {}),
    criteria: requirement.criteria.map((criterion) => {
      const result = supplied.get(`${requirement.id}:${criterion.id}`);
      return result
        ? { criterionId: result.criterionId, status: result.status, explanation: result.explanation, evidence: [...result.evidence].sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine), ...(result.confidence === undefined ? {} : { confidence: result.confidence }) }
        : { criterionId: criterion.id, status: "not_verifiable" as const, explanation: "No canonical decision was available for this criterion.", evidence: [] };
    }),
  }));
  return parseCoverageReport({ schemaVersion: SCHEMA_VERSION, contractId: contract.id, ...metadata, requirements });
}

export async function writeRequirementArtifacts(workspaceRoot: string, coverage: ReviewCoverageReport): Promise<{ coveragePath: string; sarifPath: string }> {
  const outputDirectory = path.join(workspaceRoot, "swarm-review-output");
  await mkdir(outputDirectory, { recursive: true });
  const coveragePath = path.join(outputDirectory, "coverage.json");
  const sarifPath = path.join(outputDirectory, "findings.sarif");
  await writeFile(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");
  await writeFile(sarifPath, `${JSON.stringify(toSarif(coverage, { toolName: "swarm-review" }), null, 2)}\n`, "utf8");
  return { coveragePath, sarifPath };
}

export function coverageStats(coverage: ReviewCoverageReport): { requirementCount: number; violatedCount: number; notVerifiableCount: number } {
  const criteria = coverage.requirements.flatMap((requirement) => requirement.criteria);
  return { requirementCount: criteria.length, violatedCount: criteria.filter((item) => item.status === "violated").length, notVerifiableCount: criteria.filter((item) => item.status === "not_verifiable").length };
}

/** Applies the requirement gate to already-normalized canonical coverage only. */
export function hasBlockingRequirementViolation(coverage: ReviewCoverageReport): boolean {
  return coverage.requirements.some((requirement) =>
    requirement.severity === "blocking" && requirement.criteria.some((criterion) => criterion.status === "violated" && criterion.evidence.length > 0)
  );
}

export function shouldRequestChangesForRequirements(
  config: Pick<RequirementsConfig, "fail_on_violation">,
  coverage: ReviewCoverageReport | undefined,
  budgetExhausted: boolean
): boolean {
  return Boolean(config.fail_on_violation && coverage && !budgetExhausted && hasBlockingRequirementViolation(coverage));
}
