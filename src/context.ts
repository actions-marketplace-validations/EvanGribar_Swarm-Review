import ts from "typescript";
import path from "node:path";
import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import type { FileDiff, ContextEnrichmentConfig } from "./types.js";

export interface IndexedSymbol {
  name: string;
  filePath: string;
  signature: string;
}

export interface TsConfigPaths {
  baseUrl?: string;
  paths?: Record<string, string[]>;
}

// Module-level caches to avoid redundant file I/O and AST parsing
const signatureCache = new Map<string, string>();
const importPathsCache = new Map<string, string | null>();
const importSpecifiersCache = new Map<string, string[]>();

export const DEFAULT_IGNORED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  "coverage",
  "bin",
  "obj",
];

/**
 * Clears all cached path resolutions, file signatures, and import specifiers.
 * Useful to prevent test pollution in test suites.
 */
export function clearContextCaches(): void {
  signatureCache.clear();
  importPathsCache.clear();
  importSpecifiersCache.clear();
}

/**
 * Loads tsconfig.json paths and baseUrl configuration from the workspace root.
 */
export function loadTsConfigPaths(workspaceRoot: string): TsConfigPaths {
  const tsconfigPath = path.resolve(workspaceRoot, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    return {};
  }
  try {
    const parseResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (parseResult.error) {
      return {};
    }
    const compilerOptions = parseResult.config?.compilerOptions;
    if (!compilerOptions) {
      return {};
    }
    return {
      baseUrl: compilerOptions.baseUrl,
      paths: compilerOptions.paths,
    };
  } catch {
    return {};
  }
}

/**
 * Maps a non-relative import specifier to absolute path candidates using tsconfig.json paths.
 */
export function resolvePathAlias(
  importSpecifier: string,
  pathsConfig: TsConfigPaths,
  workspaceRoot: string
): string[] {
  const { baseUrl, paths } = pathsConfig;
  const resolvedCandidates: string[] = [];

  if (paths) {
    for (const pattern of Object.keys(paths)) {
      const targets = paths[pattern];
      if (pattern.includes("*")) {
        const prefix = pattern.replace("*", "");
        if (importSpecifier.startsWith(prefix)) {
          const suffix = importSpecifier.slice(prefix.length);
          for (const target of targets) {
            const resolvedRel = target.replace("*", suffix);
            const base = baseUrl ? path.resolve(workspaceRoot, baseUrl) : workspaceRoot;
            resolvedCandidates.push(path.resolve(base, resolvedRel));
          }
        }
      } else {
        if (importSpecifier === pattern) {
          for (const target of targets) {
            const base = baseUrl ? path.resolve(workspaceRoot, baseUrl) : workspaceRoot;
            resolvedCandidates.push(path.resolve(base, target));
          }
        }
      }
    }
  }

  // Fallback to baseUrl if import is not relative and baseUrl is specified
  if (
    baseUrl &&
    !importSpecifier.startsWith(".") &&
    !importSpecifier.startsWith("/") &&
    resolvedCandidates.length === 0
  ) {
    const base = path.resolve(workspaceRoot, baseUrl);
    resolvedCandidates.push(path.resolve(base, importSpecifier));
  }

  return resolvedCandidates;
}

/**
 * Resolves a relative or aliased import path to the actual file path on disk.
 * Validates that the resolved path is contained within the workspace root to prevent path traversal.
 */
export function resolveImportPath(
  importingFilePath: string,
  importSpecifier: string,
  workspaceRoot?: string,
  pathsConfig?: TsConfigPaths
): string | null {
  const cacheKey = `${importingFilePath}::${importSpecifier}`;
  if (importPathsCache.has(cacheKey)) {
    return importPathsCache.get(cacheKey)!;
  }

  const result = resolveImportPathInternal(importingFilePath, importSpecifier, workspaceRoot, pathsConfig);
  importPathsCache.set(cacheKey, result);
  return result;
}

function resolveImportPathInternal(
  importingFilePath: string,
  importSpecifier: string,
  workspaceRoot?: string,
  pathsConfig?: TsConfigPaths
): string | null {
  const isRelative = importSpecifier.startsWith(".") || importSpecifier.startsWith("/");

  const isSafe = (p: string) => {
    if (!workspaceRoot) return true;
    const absWorkspaceRoot = path.resolve(workspaceRoot);
    const absPath = path.resolve(p);
    const relative = path.relative(absWorkspaceRoot, absPath);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  };

  const extensions = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs"];

  const checkCandidates = (targetPaths: string[]): string | null => {
    for (const targetPath of targetPaths) {
      try {
        if (existsSync(targetPath) && !statSync(targetPath).isDirectory() && isSafe(targetPath)) {
          return targetPath;
        }
      } catch {}

      // Try replacing/appending extensions
      const parsed = path.parse(targetPath);
      const pathWithoutExt = path.join(parsed.dir, parsed.name);

      for (const ext of extensions) {
        const p = pathWithoutExt + ext;
        if (existsSync(p) && isSafe(p)) {
          return p;
        }
      }

      for (const ext of extensions) {
        const p = targetPath + ext;
        if (existsSync(p) && isSafe(p)) {
          return p;
        }
      }

      // Try directory index files
      try {
        if (existsSync(targetPath) && statSync(targetPath).isDirectory()) {
          for (const ext of extensions) {
            const p = path.join(targetPath, "index" + ext);
            if (existsSync(p) && isSafe(p)) {
              return p;
            }
          }
        }
      } catch {}
    }
    return null;
  };

  if (isRelative) {
    const dir = path.dirname(importingFilePath);
    const targetPath = path.resolve(dir, importSpecifier);
    return checkCandidates([targetPath]);
  }

  // Otherwise check path alias/baseUrl mapping
  if (workspaceRoot && pathsConfig) {
    const candidates = resolvePathAlias(importSpecifier, pathsConfig, workspaceRoot);
    if (candidates.length > 0) {
      return checkCandidates(candidates);
    }
  }

  return null;
}

/**
 * Extracts import/require module specifiers from a parsed SourceFile.
 */
export function getImportSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    } else if (ts.isCallExpression(node)) {
      if (
        (ts.isIdentifier(node.expression) && node.expression.text === "require") ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isStringLiteral(firstArg)) {
          specifiers.push(firstArg.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

/**
 * Formats a clean node declaration signature by trimming body brackets/operators.
 */
function cleanBody(sigText: string): string {
  return sigText.replace(/=>\s*$/, "").replace(/=\s*$/, "").replace(/\{\s*$/, "").trim();
}

/**
 * Extracts signature declarations for classes, functions, interfaces, types, and variables.
 */
export function extractSignatures(filePath: string, fileContent: string): string {
  if (signatureCache.has(filePath)) {
    return signatureCache.get(filePath)!;
  }

  const sourceFile = ts.createSourceFile(filePath, fileContent, ts.ScriptTarget.Latest, true);
  const signatures: string[] = [];

  for (const node of sourceFile.statements) {
    // Bind parent so getStart() works accurately with parent references
    (node as any).parent = sourceFile;

    if (ts.isFunctionDeclaration(node)) {
      const sig = node.body
        ? fileContent.slice(node.getStart(), node.body.getStart()).trim()
        : node.getText().trim();
      signatures.push(cleanBody(sig));
    } else if (ts.isClassDeclaration(node)) {
      const classText = node.getText();
      const braceIndex = classText.indexOf("{");
      const classHeader = braceIndex !== -1 ? classText.slice(0, braceIndex).trim() : classText;

      const memberSigs: string[] = [];
      for (const member of node.members) {
        const modifiers = (member as any).modifiers;
        const isPublic = !modifiers?.some(
          (m: any) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword
        );

        if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) {
          if (isPublic) {
            const sig = member.body
              ? fileContent.slice(member.getStart(), member.body.getStart()).trim()
              : member.getText().trim();
            memberSigs.push(`  ${cleanBody(sig)};`);
          }
        } else if (ts.isPropertyDeclaration(member)) {
          if (isPublic) {
            const sig = member.initializer
              ? fileContent.slice(member.getStart(), member.initializer.getStart()).trim()
              : member.getText().trim();
            memberSigs.push(`  ${cleanBody(sig)};`);
          }
        }
      }
      signatures.push(`${classHeader} {\n${memberSigs.join("\n")}\n}`);
    } else if (ts.isInterfaceDeclaration(node)) {
      signatures.push(node.getText().trim());
    } else if (ts.isTypeAliasDeclaration(node)) {
      signatures.push(node.getText().trim());
    } else if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword);
      const declarationList = node.declarationList;
      const kind = declarationList.flags & ts.NodeFlags.Const ? "const" : declarationList.flags & ts.NodeFlags.Let ? "let" : "var";

      for (const decl of declarationList.declarations) {
        if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          const func = decl.initializer;
          const sigText = fileContent.slice(decl.getStart(), func.body.getStart()).trim();
          signatures.push(`${isExported ? "export " : ""}${kind} ${cleanBody(sigText)};`);
        } else {
          const sigText = decl.initializer
            ? fileContent.slice(decl.getStart(), decl.initializer.getStart()).trim()
            : decl.getText().trim();
          signatures.push(`${isExported ? "export " : ""}${kind} ${cleanBody(sigText)};`);
        }
      }
    }
  }

  const result = signatures.join("\n\n");
  signatureCache.set(filePath, result);
  return result;
}

/**
 * Scans a directory recursively for TS/JS files.
 */
function scanDirectory(dir: string, ignoredDirs: string[], fileList: string[] = []): string[] {
  if (!existsSync(dir)) return fileList;
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (!ignoredDirs.includes(file)) {
        scanDirectory(fullPath, ignoredDirs, fileList);
      }
    } else {
      const ext = path.extname(file);
      if ([".ts", ".tsx", ".js", ".jsx"].includes(ext) && !file.endsWith(".d.ts")) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

/**
 * Obtains a list of git-tracked files in the workspace.
 */
function getGitTrackedFiles(workspaceRoot: string): string[] | null {
  try {
    const stdout = execSync("git ls-files", {
      cwd: workspaceRoot,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();

    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        const ext = path.extname(line);
        return [".ts", ".tsx", ".js", ".jsx"].includes(ext) && !line.endsWith(".d.ts");
      })
      .map((line) => path.resolve(workspaceRoot, line));
  } catch {
    return null;
  }
}

/**
 * Builds a codebase index of class and function signatures.
 * Prioritizes git ls-files for speed and automatically ignoring untracked build folders.
 */
export function buildCodebaseIndex(
  workspaceRoot: string,
  config: ContextEnrichmentConfig
): Map<string, IndexedSymbol> {
  const index = new Map<string, IndexedSymbol>();
  if (!config.enabled) {
    return index;
  }

  const sizeLimitBytes = config.file_size_limit_kb * 1024;
  let allFiles: string[] = [];
  try {
    const trackedFiles = getGitTrackedFiles(workspaceRoot);
    if (trackedFiles !== null) {
      allFiles = trackedFiles;
    } else {
      const ignoredDirs = config.ignored_dirs || DEFAULT_IGNORED_DIRS;
      allFiles = scanDirectory(workspaceRoot, ignoredDirs);
    }
  } catch (err) {
    console.error("Failed to scan directory for codebase indexing:", err);
    return index;
  }

  for (const filePath of allFiles) {
    try {
      const stat = statSync(filePath);
      if (stat.size > sizeLimitBytes) {
        continue;
      }
      const content = readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

      for (const statement of sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name) {
          const name = statement.name.text;
          const sig = statement.body
            ? content.slice(statement.getStart(), statement.body.getStart()).trim()
            : statement.getText().trim();
          index.set(name, { name, filePath, signature: cleanBody(sig) });
        } else if (ts.isClassDeclaration(statement) && statement.name) {
          const name = statement.name.text;
          const classText = statement.getText();
          const braceIndex = classText.indexOf("{");
          const classHeader = braceIndex !== -1 ? classText.slice(0, braceIndex).trim() : classText;
          index.set(name, { name, filePath, signature: classHeader });
        } else if (ts.isInterfaceDeclaration(statement) && statement.name) {
          const name = statement.name.text;
          index.set(name, { name, filePath, signature: statement.getText().trim() });
        } else if (ts.isTypeAliasDeclaration(statement) && statement.name) {
          const name = statement.name.text;
          index.set(name, { name, filePath, signature: statement.getText().trim() });
        } else if (ts.isVariableStatement(statement)) {
          const isExported = statement.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword);
          for (const decl of statement.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              const name = decl.name.text;
              const sig = decl.initializer
                ? content.slice(decl.getStart(), decl.initializer.getStart()).trim()
                : decl.getText().trim();
              index.set(name, { name, filePath, signature: `${isExported ? "export " : ""}const ${cleanBody(sig)}` });
            }
          }
        }
      }
    } catch (err) {
      console.warn(`Failed to index file ${filePath}:`, err);
    }
  }

  return index;
}

/**
 * Recursively resolves import paths and gathers signatures.
 */
export async function gatherContextForDiff(
  diff: FileDiff[],
  workspaceRoot: string,
  config: ContextEnrichmentConfig,
  codebaseIndex?: Map<string, IndexedSymbol>
): Promise<string> {
  if (!config.enabled) {
    return "";
  }

  const processedFiles = new Set<string>();
  const contextBlocks: string[] = [];
  const sizeLimitBytes = config.file_size_limit_kb * 1024;
  const diffFilePaths = new Set(diff.map((f) => path.resolve(workspaceRoot, f.path)));
  const pathsConfig = loadTsConfigPaths(workspaceRoot);

  async function processFile(filePath: string, currentDepth: number) {
    if (currentDepth > config.max_depth) {
      return;
    }

    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(workspaceRoot, filePath);
    const normalizedKey = path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");

    if (processedFiles.has(normalizedKey)) {
      return;
    }
    processedFiles.add(normalizedKey);

    if (!existsSync(absolutePath)) {
      return;
    }

    try {
      const stat = statSync(absolutePath);
      if (stat.size > sizeLimitBytes) {
        return;
      }

      let imports: string[];
      if (importSpecifiersCache.has(absolutePath)) {
        imports = importSpecifiersCache.get(absolutePath)!;
      } else {
        const content = await readFile(absolutePath, "utf8");
        const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true);
        imports = getImportSpecifiers(sourceFile);
        importSpecifiersCache.set(absolutePath, imports);
      }

      for (const imp of imports) {
        const resolved = resolveImportPath(absolutePath, imp, workspaceRoot, pathsConfig);
        if (resolved) {
          const relResolved = path.relative(workspaceRoot, resolved).replace(/\\/g, "/");
          if (diffFilePaths.has(resolved)) {
            continue;
          }

          if (!processedFiles.has(relResolved)) {
            try {
              const impStat = statSync(resolved);
              if (impStat.size <= sizeLimitBytes) {
                let sigs = "";
                if (signatureCache.has(resolved)) {
                  sigs = signatureCache.get(resolved)!;
                } else {
                  const impContent = await readFile(resolved, "utf8");
                  sigs = extractSignatures(resolved, impContent);
                }

                if (sigs.trim()) {
                  contextBlocks.push(`File: \`${relResolved}\`\n\`\`\`typescript\n${sigs}\n\`\`\``);
                }

                if (currentDepth + 1 <= config.max_depth) {
                  await processFile(resolved, currentDepth + 1);
                }
              }
            } catch (err) {
              console.warn(`Failed to read/parse imported file ${relResolved}:`, err);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`Failed to process file ${normalizedKey} for imports:`, err);
    }
  }

  // 1. Trace explicit imports from the changed files
  const allowedExtensions = [".ts", ".tsx", ".js", ".jsx"];
  for (const file of diff) {
    const ext = path.extname(file.path);
    if (allowedExtensions.includes(ext)) {
      const fullPath = path.resolve(workspaceRoot, file.path);
      await processFile(fullPath, 1);
    }
  }

  // 2. Scan diff patches for global reference keywords (indexing-based reference resolution)
  if (codebaseIndex && codebaseIndex.size > 0) {
    const matchedSymbols = new Set<string>();
    for (const file of diff) {
      if (file.patch) {
        // Unique the matched words in the patch using a Set to avoid redundant index lookups
        const words = new Set(file.patch.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || []);
        for (const word of words) {
          if (codebaseIndex.has(word) && !matchedSymbols.has(word)) {
            const sym = codebaseIndex.get(word)!;
            const relPath = path.relative(workspaceRoot, sym.filePath).replace(/\\/g, "/");
            const relFileOfDiff = file.path.replace(/\\/g, "/");

            if (relPath !== relFileOfDiff && !diffFilePaths.has(sym.filePath)) {
              matchedSymbols.add(word);
              const blockKey = `File: \`${relPath}\` (referenced symbol: \`${word}\`)\n\`\`\`typescript\n${sym.signature}\n\`\`\``;
              if (!contextBlocks.includes(blockKey)) {
                contextBlocks.push(blockKey);
              }
            }
          }
        }
      }
    }
  }

  if (contextBlocks.length === 0) {
    return "";
  }

  return [
    `### Supporting Code Context`,
    `Below are the signature declarations of classes, methods, and functions imported or referenced by the changed files:`,
    "",
    ...contextBlocks,
  ].join("\n");
}
