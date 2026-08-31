import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { StaticAnalysisConfig, StaticAnalysisCommand, Finding } from "./types.js";

const execAsync = promisify(exec);

export async function runStaticAnalysis(
  config: StaticAnalysisConfig,
  workspaceRoot: string = process.cwd()
): Promise<Finding[]> {
  if (!config.enabled || !config.commands || config.commands.length === 0) {
    return [];
  }

  const allFindings: Finding[] = [];
  let idCounter = 1;

  // Run all commands in parallel
  await Promise.all(
    config.commands.map(async (command) => {
      console.log(`Running static analysis command: "${command.name}" -> ${command.run}`);
      let stdout = "";
      let stderr = "";

      try {
        const result = await execAsync(command.run, { cwd: workspaceRoot });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (error: any) {
        // Many compiler/linter commands return non-zero exit codes when errors are found.
        // We capture stdout and stderr from the error object.
        stdout = error.stdout || "";
        stderr = error.stderr || "";
        if (!stdout && !stderr) {
          console.error(`Command "${command.name}" failed to execute:`, error);
        }
      }

      const findings = await parseCommandOutput(command, stdout, stderr, workspaceRoot, () => {
        const id = `${command.name}-${idCounter}`;
        idCounter += 1;
        return id;
      });
      allFindings.push(...findings);
    })
  );

  return allFindings;
}

async function parseCommandOutput(
  command: StaticAnalysisCommand,
  stdout: string,
  stderr: string,
  workspaceRoot: string,
  nextId: () => string
): Promise<Finding[]> {
  const findings: Finding[] = [];
  let content = stdout;

  // Support output files if specified in the config or fallback to command regex matching
  let outputFileName = command.outputFile;
  if (!outputFileName) {
    const fileMatch = command.run.match(/(?:-o|--output-file)\s+(\S+)/);
    if (fileMatch) {
      outputFileName = fileMatch[1];
    }
  }

  if (outputFileName) {
    const filePath = path.isAbsolute(outputFileName)
      ? outputFileName
      : path.join(workspaceRoot, outputFileName);
    if (existsSync(filePath)) {
      try {
        content = await readFile(filePath, "utf8");
      } catch (err) {
        console.error(`Failed to read output file ${filePath} for "${command.name}":`, err);
      }
    }
  }

  if (command.parser === "eslint-json") {
    if (!content.trim() && stderr.trim()) {
      content = stderr;
    }
    try {
      if (content.trim()) {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          for (const fileObj of parsed) {
            if (!fileObj || typeof fileObj !== "object" || !fileObj.filePath) {
              continue;
            }
            const rawFilePath = fileObj.filePath;
            const relativePath = path.isAbsolute(rawFilePath)
              ? path.relative(workspaceRoot, rawFilePath)
              : rawFilePath;
            const normalizedPath = relativePath.replace(/\\/g, "/");

            if (Array.isArray(fileObj.messages)) {
              for (const msg of fileObj.messages) {
                const line = msg.line && msg.line > 0 ? msg.line : 1;
                const severity = msg.severity === 2 ? "blocking" : "warning";
                const claim = msg.ruleId ? `[${msg.ruleId}] ${msg.message}` : msg.message;

                findings.push({
                  id: nextId(),
                  agent: command.name,
                  severity,
                  file: normalizedPath,
                  line,
                  claim: claim || "Linter warning/error",
                  confidence: 1.0,
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`Failed to parse ESLint JSON output for "${command.name}":`, err);
    }
  } else if (command.parser === "regex") {
    if (!command.regex) {
      console.error(`Regex pattern missing for command "${command.name}" with regex parser.`);
      return [];
    }

    let re: RegExp;
    try {
      re = new RegExp(command.regex);
    } catch (err) {
      console.error(`Invalid regex pattern "${command.regex}" for command "${command.name}":`, err);
      return [];
    }

    const lines = `${stdout}\n${stderr}`.split(/\r?\n/);
    for (const line of lines) {
      re.lastIndex = 0;
      const match = re.exec(line);
      if (match && match.groups) {
        const file = match.groups.file;
        const lineStr = match.groups.line;
        const claim = match.groups.claim;

        if (file && lineStr && claim) {
          const parsedLine = parseInt(lineStr, 10);
          const lineNum = isNaN(parsedLine) || parsedLine <= 0 ? 1 : parsedLine;
          const relativePath = path.isAbsolute(file)
            ? path.relative(workspaceRoot, file)
            : file;
          const normalizedPath = relativePath.replace(/\\/g, "/");

          let severity: "blocking" | "warning" | "suggestion" = "warning";
          if (match.groups.severity) {
            const sevLower = match.groups.severity.toLowerCase();
            if (sevLower.includes("error") || sevLower.includes("fail") || sevLower.includes("block")) {
              severity = "blocking";
            } else if (sevLower.includes("warn")) {
              severity = "warning";
            } else if (sevLower.includes("info") || sevLower.includes("suggest") || sevLower.includes("note")) {
              severity = "suggestion";
            }
          }

          findings.push({
            id: nextId(),
            agent: command.name,
            severity,
            file: normalizedPath,
            line: lineNum,
            claim: claim.trim(),
            confidence: 1.0,
          });
        }
      }
    }
  }

  return findings;
}
