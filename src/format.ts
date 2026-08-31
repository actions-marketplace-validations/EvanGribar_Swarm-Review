import type { DebateTranscript, Finding, Severity } from "./types.js";
import type { ReviewCoverageReport } from "@specbridge/core";

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`|<>]/g, "\\$&").replace(/\r?\n/g, " ");
}

const SEVERITY_MARKER: Record<Severity, string> = {
  blocking: "[BLOCKING]",
  warning: "[WARNING]",
  suggestion: "[SUGGESTION]",
};

function findingLine(finding: Finding): string {
  const marker = SEVERITY_MARKER[finding.severity];
  const rebuttal = finding.rebuttal_to ? `, rebuttal to ${finding.rebuttal_to}` : "";
  return `- ${marker} **${finding.agent}** ${finding.file}:${finding.line} (${finding.severity}, ${finding.confidence.toFixed(2)}${rebuttal}) - ${finding.claim}`;
}

export function renderDebateTranscriptMarkdown(transcript: DebateTranscript): string {
  const lines: string[] = ["", "---", "", "### Debate Transcript"];

  transcript.rounds.forEach((round, index) => {
    lines.push("");
    lines.push(`#### Round ${index + 1}`);

    if (round.length === 0) {
      lines.push("- No findings in this round.");
      return;
    }

    round.forEach((finding) => lines.push(findingLine(finding)));
  });

  return lines.join("\n");
}

export function formatInlineCommentBody(finding: Finding, decision?: string): string {
  const emoji = finding.severity === "blocking" ? "🚨" : finding.severity === "warning" ? "⚠️" : "💡";
  const lines = [
    `### Swarm-Review Finding ${emoji}`,
    `- **Agent**: \`${finding.agent}\` (severity: \`${finding.severity}\`, confidence: \`${finding.confidence.toFixed(2)}\`)`,
    `- **Claim**: ${finding.claim}`,
  ];
  if (decision) {
    lines.push(`- **🧠 Principal Decision**: ${decision}`);
  }
  return lines.join("\n");
}

export function renderRequirementCoverageMarkdown(coverage: ReviewCoverageReport): string {
  const lines = ["## Requirement coverage", "", "| Requirement | Criterion | Status | Confidence | Evidence |", "|---|---|---|---:|---|"];
  const details: string[] = [];
  for (const requirement of coverage.requirements) for (const criterion of requirement.criteria) {
    const evidence = criterion.evidence.map((item) => `\`${escapeMarkdown(item.path)}:${item.startLine}${item.endLine ? `-${item.endLine}` : ""}\``).join(", ") || "—";
    lines.push(`| ${escapeMarkdown(requirement.requirementId)} | ${escapeMarkdown(criterion.criterionId)} | ${criterion.status.replace(/_/g, " ")} | ${criterion.confidence === undefined ? "—" : criterion.confidence.toFixed(2)} | ${evidence} |`);
    if (criterion.status === "violated" || criterion.status === "not_verifiable") details.push(`- **${escapeMarkdown(requirement.requirementId)} / ${escapeMarkdown(criterion.criterionId)}** (${criterion.status.replace(/_/g, " ")}): ${escapeMarkdown(criterion.explanation)}`);
  }
  return details.length ? `${lines.join("\n")}\n\n${details.join("\n")}` : lines.join("\n");
}
