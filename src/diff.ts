import { Octokit } from "@octokit/rest";

import { FileDiffSchema, type DiffConfig, type FileDiff, type AgentConfig } from "./types.js";

type DiffFormatOptions = DiffConfig;

const DEFAULT_DIFF_FORMAT_OPTIONS: Required<DiffFormatOptions> = {
  max_files: 80,
  max_patch_chars_per_file: 12_000,
  max_total_chars: 180_000,
  exclude_patterns: [],
  include_patterns: [],
};

export function createOctokit(token: string): Octokit {
  return new Octokit({
    auth: token,
    userAgent: "swarm-review",
  });
}

export async function fetchPullRequestDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<FileDiff[]> {
  const files = await octokit.paginate(
    octokit.rest.pulls.listFiles,
    { owner, repo, pull_number: pullNumber, per_page: 100 },
    (response) => response.data
  );

  return files.map((file) =>
    FileDiffSchema.parse({
      path: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ?? undefined,
      previousPath: file.previous_filename ?? undefined,
    })
  );
}

export function globToRegex(pattern: string): RegExp {
  const hasGlobChars = /[*?]/.test(pattern);
  if (!hasGlobChars) {
    try {
      return new RegExp(pattern);
    } catch {
      // Proceed to glob conversion if it fails to compile directly
    }
  }

  let regexStr = "";
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          regexStr += "(?:.*/)?";
          i += 3;
        } else {
          regexStr += ".*";
          i += 2;
        }
      } else {
        regexStr += "[^/]*";
        i += 1;
      }
    } else if (char === "?") {
      regexStr += "[^/]";
      i += 1;
    } else if ("[\\^$.|?*+()".includes(char)) {
      regexStr += "\\" + char;
      i += 1;
    } else {
      regexStr += char;
      i += 1;
    }
  }

  const cleanPattern = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  const hasSlash = cleanPattern.includes("/");

  if (!hasSlash) {
    return new RegExp(`(?:^|\\/)${regexStr}$`);
  } else {
    const prefix = regexStr.startsWith("^") ? "" : "^";
    const suffix = regexStr.endsWith("$") ? "" : "$";
    return new RegExp(`${prefix}${regexStr}${suffix}`);
  }
}

export function compilePatterns(patterns: string[]): RegExp[] {
  return patterns
    .map((p) => {
      try {
        return globToRegex(p);
      } catch (e) {
        console.error(`Invalid pattern "${p}":`, e);
        return null;
      }
    })
    .filter((r): r is RegExp => r !== null);
}

export function formatFileDiffs(files: FileDiff[], options?: Partial<DiffFormatOptions>): string {
  const settings = {
    ...DEFAULT_DIFF_FORMAT_OPTIONS,
    ...options,
  };

  const SEPARATOR = "\n\n---\n\n";

  // Pre-compile regex patterns for better performance
  const excludeRegexes = compilePatterns(settings.exclude_patterns);
  const includeRegexes = compilePatterns(settings.include_patterns);

  // Filter out excluded files
  const filteredFiles = files.filter((file) => {
    if (includeRegexes.length > 0) {
      const matchesInclude = includeRegexes.some((r) => r.test(file.path));
      if (!matchesInclude) return false;
    }
    return !excludeRegexes.some((r) => r.test(file.path));
  });
  const omittedByPatterns = files.length - filteredFiles.length;

  // Reserve the longest possible count values so the final metadata cannot
  // exceed the budget calculation as files are omitted.
  const countPlaceholder = String(files.length);
  const metadataPlaceholder = [
    "### Diff Budget",
    `- total_files: ${files.length}`,
    `- included_files: ${countPlaceholder}`,
    `- omitted_files: ${countPlaceholder}`,
    `- excluded_by_patterns: ${omittedByPatterns}`,
    `- max_files: ${settings.max_files}`,
    `- max_patch_chars_per_file: ${settings.max_patch_chars_per_file}`,
    `- max_total_chars: ${settings.max_total_chars}`,
  ].join("\n");

  let remainingChars = settings.max_total_chars - metadataPlaceholder.length;
  const selectedFiles = filteredFiles.slice(0, settings.max_files);
  const renderedFiles: string[] = [];

  for (const file of selectedFiles) {
    const header = [
      `### ${file.path}`,
      `status: ${file.status}`,
      `additions: ${file.additions}`,
      `deletions: ${file.deletions}`,
      file.previousPath ? `previous path: ${file.previousPath}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const rawPatch = file.patch ?? "PATCH UNAVAILABLE";
    const patchTruncated = rawPatch.length > settings.max_patch_chars_per_file;
    const patch = patchTruncated
      ? `${rawPatch.slice(0, settings.max_patch_chars_per_file)}\n... [PATCH TRUNCATED]`
      : rawPatch;
    const rendered = `${header}\n\n\`\`\`diff\n${patch}\n\`\`\``;

    // Account for the file content and the separator that will follow it.
    if (rendered.length + SEPARATOR.length > remainingChars) {
      break;
    }

    renderedFiles.push(rendered);
    remainingChars -= rendered.length + SEPARATOR.length;
  }

  const omittedCount = files.length - renderedFiles.length;

  const metadata = [
    "### Diff Budget",
    `- total_files: ${files.length}`,
    `- included_files: ${renderedFiles.length}`,
    `- omitted_files: ${omittedCount}`,
    `- excluded_by_patterns: ${omittedByPatterns}`,
    `- max_files: ${settings.max_files}`,
    `- max_patch_chars_per_file: ${settings.max_patch_chars_per_file}`,
    `- max_total_chars: ${settings.max_total_chars}`,
  ].join("\n");

  return [metadata, ...renderedFiles].join(SEPARATOR);
}

export function filterDiffForAgent(diff: FileDiff[], agent: AgentConfig): FileDiff[] {
  if (!agent.include_patterns && !agent.exclude_patterns) {
    return diff;
  }

  const includeRegexes = compilePatterns(agent.include_patterns || []);
  const excludeRegexes = compilePatterns(agent.exclude_patterns || []);

  return diff.filter((file) => {
    if (includeRegexes.length > 0) {
      const matchesInclude = includeRegexes.some((r) => r.test(file.path));
      if (!matchesInclude) return false;
    }
    if (excludeRegexes.length > 0) {
      const matchesExclude = excludeRegexes.some((r) => r.test(file.path));
      if (matchesExclude) return false;
    }
    return true;
  });
}

export function getDiffLineNumbers(patch: string): Set<number> {
  const lineNumbers = new Set<number>();
  if (!patch) return lineNumbers;

  const lines = patch.split("\n");
  let currentNewLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (match) {
        currentNewLine = parseInt(match[1], 10);
      }
    } else if (line.startsWith("+")) {
      lineNumbers.add(currentNewLine);
      currentNewLine++;
    } else if (line.startsWith("-")) {
      // Deletion - doesn't increment new line number
    } else {
      // Context line
      lineNumbers.add(currentNewLine);
      currentNewLine++;
    }
  }

  return lineNumbers;
}
