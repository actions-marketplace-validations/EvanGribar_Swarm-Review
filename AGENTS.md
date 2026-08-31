# AGENTS.md — swarm-review

## What we are building

**swarm-review** is an open source GitHub Action that brings a swarm of AI agents to every pull request. Each agent reviews the diff independently with its own mandate and expertise. Agents then debate each other's findings — one agent can dispute another's claim, defend its position, or concede. A principal agent reads the full debate transcript and writes the final PR comment, showing where agents agreed, where they clashed, and what the final call is.

The output is not a single blob of AI feedback. It reads like a real engineering team reviewed your PR.

This is the mechanic that doesn't exist anywhere else. That is the north star.

---

## Goals

- Zero hosting required — runs entirely inside GitHub Actions
- Users supply their own AI company (or openrouter, hermes, etc) API key as a repo secret
- Configurable — teams define their own agent roster, mandates, and debate rules via `.swarm.yml` in their repo
- The agent count, names, and specialties are not fixed — the swarm is whatever the team needs it to be
- Open source, MIT licensed, built to be forked and extended

---

## Core mechanic

### Stage 1 — independent specialist review
All agents receive the raw git diff in parallel. Each agent has no knowledge of what the others will say. Each returns structured findings: a claim, a severity, a file, a line, and a confidence score.

Additionally, if **Static Analysis** is enabled, linter and compiler tools (like ESLint and TypeScript compilation) are executed in the runner workspace. Their parsed diagnostics join the review findings and serve as ground-truth facts during principal synthesis.

If **Context Enrichment** is enabled, import dependencies in changed files are recursively traced up to `max_depth` (using AST parsing via the TypeScript compiler). Skeletal signatures (excluding method/function bodies) of imported classes, functions, types, and variables are extracted and injected into prompts as supporting codebase context, preventing context window explosion while providing necessary code details.

If **SpecBridge Requirement Evaluation** is enabled, checked-in `.specbridge/requirements.json` contracts are evaluated against the PR patch, generating structured `coverage.json` and `findings.sarif` artifacts.

### Stage 2 — evidence-aware principal synthesis (default)
A principal engineer agent receives all independent reviewer findings (along with optional static analysis and requirement evaluation results) and synthesizes the final PR review summary. The principal eliminates false positives, resolves overlaps, and makes final calls.

### Stage 3 — optional structured debate (opt-in)
When debate is explicitly enabled (`debate.enabled: true` or `debate.rounds > 0`), agents engage in structured rebuttal rounds before principal synthesis, receiving full transcript history to challenge or reinforce claims.

---

## Data model

The schema is the contract between all agents. Get this right first before any implementation.

```typescript
type Severity = "blocking" | "warning" | "suggestion"

type Finding = {
  id: string
  agent: string           // agent name from .swarm.yml
  severity: Severity
  file: string
  line: number
  claim: string           // the actual finding in plain English
  confidence: number      // 0.0 to 1.0
  rebuttal_to?: string    // ID of the finding this disputes, if any
}

type DebateTranscript = {
  rounds: Finding[][]     // each round is an array of findings/rebuttals
  agents: AgentConfig[]
}

type AgentConfig = {
  name: string
  mandate: string         // plain English description of what this agent looks for
  model?: string          // optional model override per agent
}

type PrincipalSummary = {
  agreements: Finding[]
  disputes: { finding: Finding; rebuttal: Finding }[]
  final_calls: { finding: Finding; decision: string }[]
  summary: string         // the markdown block posted to GitHub
}
```

---

## Configuration

Teams configure their swarm via `.swarm.yml` at the repo root. The schema is flexible — any agent name and mandate is valid. Example:

```yaml
agents:
  - name: security
    mandate: >
      Review for security vulnerabilities. Look for injection risks, exposed secrets,
      broken auth, insecure defaults, and unsafe data handling.

  - name: performance
    mandate: >
      Review for performance issues. Look for N+1 queries, unnecessary re-renders,
      expensive operations in hot paths, and missing pagination.

  - name: architecture
    mandate: >
      Review for architectural concerns. Look for separation of concerns violations,
      tight coupling, naming inconsistency, and patterns that don't fit the codebase.

  - name: dx
    mandate: >
      Review for developer experience. Look for missing tests, outdated docs,
      unclear variable names, and changes that will be hard to maintain.

debate:
  rounds: 2               # how many debate rounds before synthesis
  min_confidence: 0.6     # findings below this threshold are soft-filtered

principal:
  mandate: >
    You are the principal engineer. Read the full debate and make final calls.
    Be direct. Show your reasoning. Surface genuine disagreements clearly.

static_analysis:
  enabled: true
  commands:
    - name: eslint
      run: npx eslint --format json -o eslint-report.json
      outputFile: eslint-report.json
      parser: eslint-json
    - name: typescript
      run: npx tsc --noEmit
      parser: regex
      regex: "(?<file>[^:]+):(?<line>\\d+):(?<column>\\d+) - (?<claim>.+)"

context_enrichment:
  enabled: true           # whether to resolve dependencies and pull signature context
  max_depth: 1            # how deep to recursively trace import dependencies
  file_size_limit_kb: 100 # ignore dependency files larger than this to prevent context bloat
```

---

## Tech stack

- **Language:** TypeScript
- **Runtime:** GitHub Actions (`runs-on: ubuntu-latest`)
- **AI:** Anthropic API (user supplies `ANTHROPIC_API_KEY` as repo secret)
- **GitHub API:** Octokit for reading diffs and posting comments
- **Parallelism:** `Promise.all` for round 1, sequential per debate round
- **Schema validation:** Zod for all agent outputs
- **Config parsing:** `js-yaml` for `.swarm.yml`

---

## File structure

```
swarm-review/
├── .github/
│   └── workflows/
│       └── example.yml       # example workflow for users to copy
├── src/
│   ├── types.ts              # Finding, DebateTranscript, AgentConfig, PrincipalSummary
│   ├── config.ts             # parse and validate .swarm.yml
│   ├── diff.ts               # fetch and parse the PR diff via Octokit
│   ├── agents/
│   │   ├── review.ts         # round 1 — run all agents in parallel
│   │   ├── debate.ts         # round 2 — run debate rounds
│   │   └── principal.ts      # round 3 — synthesize and post comment
│   ├── prompts.ts            # all prompt templates in one place
│   ├── github.ts             # post comment, update check run
│   └── index.ts              # entrypoint, orchestrates the three rounds
├── action.yml                # GitHub Action metadata
├── .swarm.yml                # default config (used if repo has none)
├── AGENTS.md                 # this file
└── README.md
```

---

## Build order

Build in this order. Do not skip ahead.

1. `src/types.ts` — define all types and Zod schemas. Nothing else until this is solid.
2. `src/config.ts` — parse `.swarm.yml`, validate against schema, export `SwarmConfig`
3. `src/diff.ts` — fetch PR diff from GitHub API, return as structured `FileDiff[]`
4. `src/prompts.ts` — write all prompt templates. Keep prompts centralized, never inline.
5. `src/agents/review.ts` — round 1. Run all agents in parallel, collect `Finding[]`
6. `src/agents/debate.ts` — round 2. Run debate rounds, build `DebateTranscript`
7. `src/agents/principal.ts` — round 3. Synthesize, format, post GitHub comment
8. `src/index.ts` — wire everything together
9. `action.yml` — package as GitHub Action
10. `README.md` — write last, when the thing actually works

---

## Prompting rules

- Every agent prompt must include: the agent's mandate, the full diff, and (in debate rounds) the findings it is responding to
- Instruct agents to return **only valid JSON** matching the `Finding[]` schema — no preamble, no markdown fences
- The principal prompt must include the full `DebateTranscript` and instruct it to return a `PrincipalSummary`
- Keep all prompt templates in `src/prompts.ts` — never scatter them across files
- Use Zod to parse and validate every agent response before passing it downstream — never trust raw LLM output

---

## Installing skills

Before implementing any file type handling, parsing, or output formatting, check for relevant skills:

```
/mnt/skills/public/
```

Read the relevant `SKILL.md` before writing any code that touches file I/O, document generation, or structured output. Skills encode environment-specific constraints that are not in training data.

---

## What success looks like

A developer opens a PR. Within 2 minutes, a comment appears that reads like this:

```
## swarm-review

**🔒 security** flagged `src/api/users.ts:47` — raw user input passed directly to query string (blocking, 0.91)
**⚡ performance** disputes — this endpoint is internal-only, not reachable by untrusted input (0.74)
**🔒 security** maintains position — internal-only is an assumption, not enforced at the transport layer
**🧠 principal** → security is right. The assumption is not enforced. Use a parameterized query. Blocking.

---

**✅ agreed** — `src/components/Table.tsx:12` missing key prop (dx + architecture, warning)
**✅ agreed** — `src/hooks/useData.ts:88` unnecessary re-fetch on every render (performance, warning)

---

**💬 unresolved** — `src/lib/auth.ts:203` architecture flagged god object pattern, dx disagrees (refactor scope unclear)
→ principal defers: log as tech debt, not blocking this PR
```

That output. That is the goal. Every implementation decision should serve producing exactly that.

---

## Roadmap

The strategic development goals and future milestones are documented in [ROADMAP.md](file:///c:/Users/evang/Documents/Coding/Swarm-Review/ROADMAP.md).

> [!IMPORTANT]
> **Rule for Future AI Agents:**
> When updating the roadmap to mark a phase/milestone as completed:
> 1. Completely remove the completed phase/milestone and all of its details/subsections from `ROADMAP.md` (only show upcoming, non-completed milestones/phases).
> 2. Clean up the Gantt chart in `ROADMAP.md` to only display future releases.
> 3. Assess the project's current state and add new future milestones or phases to the roadmap as needed.