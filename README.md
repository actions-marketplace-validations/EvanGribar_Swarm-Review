# swarm-review

swarm-review is a GitHub Action for **independent specialist review, evidence-aware synthesis, and optional requirement validation**.

Requirement-aware review is supported via [SpecBridge integration](docs/SPECBRIDGE.md) for contract configuration, coverage artifacts, SARIF consumption, and merge-gate behavior.

Each configured agent reads the diff independently and flags domain-specific issues. A principal agent synthesizes all findings into a clear, actionable engineering review. Structured debate rounds remain available as an opt-in feature for complex or high-risk pull requests.

## Why it exists

Most AI review tools give you a single uncoordinated opinion. swarm-review gives you an evidence-backed review process.

- **Specialized Independent Review**: Different agents specialize in security, performance, architecture, or custom domains.
- **Evidence-Aware Principal Synthesis**: A principal engineering agent synthesizes findings, eliminates false positives, and makes final calls.
- **Optional Requirement Validation**: Validate pull requests directly against `.specbridge/requirements.json` contracts.
- **Evaluation-Backed Efficiency**: Default non-debate mode eliminates unnecessary LLM calls, saving cost and latency.

## How it works

1. The action fetches the pull request diff from GitHub.
2. If `static_analysis` is enabled, the action runs linter and compiler checks in the runner workspace and parses warnings and errors.
3. Every agent performs an independent first-pass review in parallel.
4. The principal agent synthesizes all findings (and optional static analysis / SpecBridge contracts) into a final review summary.
5. If debate is explicitly enabled (`debate.enabled: true` or `debate.rounds > 0`), agents engage in structured rebuttal rounds before principal synthesis.
6. The action updates the PR comment and, optionally, the check run.

## Evaluation & Architecture Benchmarks

Swarm-Review's multi-agent debate architecture has been empirically benchmarked against [SpecBench v0.2](https://github.com/EvanGribar/SpecBench) across 5 distinct review configurations (Single-Agent, Swarm without Debate, Swarm with Debate, Swarm Debate + Static Analysis, and Requirement-Aware SpecBridge).

Key measured findings:
- **Principal Synthesis Sufficiency**: Independent reviewers plus principal synthesis (`swarm-no-debate`) achieves **100.0% Recall** and **100.0% Precision** on SpecBench v0.2 requirement violation cases. Principal synthesis alone filters false positives without requiring multi-agent debate rounds.
- **Debate Cost & Latency Penalty**: Structured debate (`swarm-with-debate`) achieves identical 100% precision and recall as non-debate swarm, while adding **+26.2% cost** ($0.0077 vs $0.0061) and **+38.1% runtime latency** (116.4s vs 84.3s).
- **SpecBridge Requirement Efficiency**: Contract-aware SpecBridge evaluation delivers **98.4% F1** at **22% of the cost** ($0.0017 vs $0.0077) and **27% of the latency** (31.9s vs 116.4s).

For detailed methodology, per-case breakdowns, budget controls, and artifact indices, see:
- [Evaluation Methodology](docs/EVALUATION.md)
- [Evaluation Results & Benchmarks Report](docs/EVALUATION_RESULTS.md)

## Architecture

swarm-review uses a strict three-stage pipeline:

1. Review stage (parallel): each agent reviews the same diff independently.
2. Debate stage (round-based): agents receive the shared transcript and can rebut or reinforce findings.
3. Principal stage: one synthesis pass turns the transcript into a final call.

All model output is validated with Zod before it can flow to the next stage.
If an output is malformed, the run fails fast instead of silently accepting invalid content.

## Quick Start

Add this workflow to your repository:

```yaml
name: swarm-review

on:
  pull_request:
    types: [opened, synchronize, reopened]
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  review:
    if: >-
      github.event_name != 'issue_comment' ||
      (github.event.issue.pull_request &&
      contains(github.event.comment.body, '/swarm-review') &&
      (github.event.comment.author_association == 'OWNER' ||
      github.event.comment.author_association == 'MEMBER' ||
      github.event.comment.author_association == 'COLLABORATOR'))
    runs-on: ubuntu-latest
    concurrency:
      group: swarm-review-${{ github.event.pull_request.number || github.event.issue.number }}
      cancel-in-progress: true
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run swarm-review
        uses: EvanGribar/Swarm-Review@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          anthropic-model: claude-3-5-sonnet-latest
          config-path: .swarm.yml
```

Then add a `.swarm.yml` file at the repository root if you want to customize the swarm.

### Conversational Re-Review

When the `issue_comment` trigger is enabled, repository owners, organization members, and collaborators can reply with `/swarm-review` or `/swarm-review debate` on its own line to trigger a re-review. Commands from bots, outside contributors, and other users are ignored so public comments cannot spend the repository's model budget.

During a re-review, the action:
1. Gathers all comments posted after the latest principal's review comment.
2. Identifies developer feedback (excluding the bot's own comments).
3. Strips the trigger commands and feeds the text directly into the debate agent prompt.

This allows agents to incorporate developer feedback and debate, defend, or concede their findings based on developer responses. The action bounds collected feedback to avoid unbounded prompt growth. If a comment does not contain an exact command, the action exits immediately without calling a model.

For `issue_comment` events, keep the checkout on the trusted default branch. Checking out and executing code from an untrusted pull request in a workflow that can access secrets is unsafe. The pull request diff still comes from GitHub's API; local static-analysis and context-enrichment inputs come from the trusted checkout.

## Presets & Configuration

If `.swarm.yml` is missing, the action defaults to `preset: balanced` (3 independent reviewers + principal synthesis, 0 debate rounds).

### Presets

Swarm-Review supports simple evaluation-backed presets:

| Preset | Description | Reviewers | Debate | Static Analysis | Requirement Evaluation |
| --- | --- | --- | --- | --- | --- |
| `fast` | Lowest cost & latency for quick PRs | 1 (`security`) | 0 rounds | Off | Off |
| `balanced` *(default)* | Evidence-backed default architecture | 3 (`security`, `performance`, `architecture`) | 0 rounds | Off | Off |
| `thorough` | Full suite with linter/compiler checks | 4 (+ `dx`) | 0 rounds | On | Off |
| `requirements` | Contract-aware SpecBridge evaluation | 3 | 0 rounds | Off | On (`.specbridge/requirements.json`) |

### Example `.swarm.yml`

```yaml
preset: balanced

# Opt-in structured debate (optional)
debate:
  enabled: false # Set to true or rounds: 1 to enable debate
  rounds: 0
  min_confidence: 0.6

budget:
  max_cost_usd: 1.50
  fallback_model: claude-3-5-haiku-latest
  max_output_tokens: 4096

principal:
  mandate: >
    You are the principal engineer. Read the full debate and make final calls.
    Be direct. Show your reasoning. Surface genuine disagreements clearly.

output:
  mode: outcome
  inline: false
  review_event: COMMENT

diff:
  max_files: 80
  max_patch_chars_per_file: 12000
  max_total_chars: 180000
  include_patterns: []
  exclude_patterns: []

static_analysis:
  enabled: false
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
  enabled: true
  max_depth: 1
  file_size_limit_kb: 100
  ignored_dirs: ["node_modules", ".git", "dist", "build", "out", ".next", "target", "coverage", "bin", "obj"]
```

### Output modes

- `outcome`: posts only the principal summary.
- `full`: posts the principal summary plus the full round-by-round transcript.

Example (`outcome`):

```text
## swarm-review

security flagged src/api/users.ts:47 - raw user input is passed into query construction.
principal: blocking until this path uses parameterized queries.
```

Example (`full`):

```text
## swarm-review

security flagged src/api/users.ts:47 - raw user input is passed into query construction.
principal: blocking until this path uses parameterized queries.

### Debate Transcript
#### Round 1
- [BLOCKING] security - src/api/users.ts:47
  - Raw user input is passed into query construction.

#### Round 2
- [WARNING] performance - src/api/users.ts:47
  - Endpoint traffic is low, but query safety still should be fixed.
```

### Config fields

- `provider`: optional LLM provider configuration (see Provider Configuration below).
- `agents`: list of reviewer agents, each with a `name`, `mandate`, optional `model`, and optional agent-level overrides:
  - `agents[].system_prompt`: custom reviewer instructions appended to the built-in structured-output prompt.
  - `agents[].min_confidence`: confidence threshold from `0` to `1`. Defaults to `debate.min_confidence`.
  - `agents[].include_patterns`: glob patterns of files this agent should review.
  - `agents[].exclude_patterns`: glob patterns of files this agent should ignore.
- `budget.max_cost_usd`: optional strict per-run spend cap. Before every call, swarm-review reserves a conservative worst-case cost and never starts a call that would exceed the cap. Successful calls settle to an observed-output upper bound; failed or ambiguous calls retain their reservation because they may still be billable.
- `budget.fallback_model`: optional cheaper model from the same provider to use when the primary model no longer fits. Models without known pricing require a known fallback when budgeting is enabled.
- `budget.max_output_tokens`: maximum output tokens reserved and requested per call. Defaults to `4096`.
- `debate.rounds`: how many debate rounds to run after the first-pass review.
- `debate.min_confidence`: findings below this threshold are filtered out.
- `principal.mandate`: instructions for the synthesis agent.
- `output.mode`: controls whether the transcript is included in the PR comment.
- `output.inline`: whether to publish accepted findings as inline GitHub review comments.
- `output.review_event`: GitHub review submission event status (`COMMENT`, `APPROVE`, `REQUEST_CHANGES`, or `AUTO`).
- `diff.max_files`: maximum number of files to include in the diff sent to agents.
- `diff.max_patch_chars_per_file`: maximum characters per file patch before truncation.
- `diff.max_total_chars`: maximum total characters across all files.
- `diff.include_patterns`: global list of glob patterns to limit review files (e.g., `["src/**"]`).
- `diff.exclude_patterns`: global list of glob patterns to exclude files from review (e.g., `["\\.lock$", "package-lock\\.json"]`).
- `static_analysis.enabled`: whether to run local linter and compiler commands (`true` or `false`).
- `static_analysis.commands`: list of shell commands to run, each with:
  - `name`: the name of the tool (used as the agent name for findings).
  - `run`: the shell command to execute.
  - `parser`: log parser to use (`eslint-json` or `regex`).
  - `outputFile`: optional path to a generated report file. If provided, the linter report is read directly from this file. If omitted, the runner falls back to extracting the output file path from command line arguments (e.g. `-o <file>` or `--output-file <file>`) or stdout.
  - `regex`: the regular expression to parse output logs line-by-line (required when `parser` is `regex`). Must define `(?<file>...)`, `(?<line>...)`, and `(?<claim>...)` named capture groups, and optionally `(?<severity>...)`.
- `context_enrichment.enabled`: whether to resolve import dependencies and pull skeletal signature context (`true` or `false`). Defaults to `true`.
- `context_enrichment.max_depth`: how deep to recursively trace import dependencies (e.g., `1` for direct imports, `2` for imports of imports). Defaults to `1`.
- `context_enrichment.file_size_limit_kb`: ignore dependency files larger than this size in KB to prevent context window bloat. Defaults to `100`.
- `context_enrichment.ignored_dirs`: optional list of directories to ignore when searching for dependency files or building codebase index (e.g., `["node_modules", ".git", "dist"]`). Defaults to standard build and node directories.

## Provider Configuration

swarm-review supports multiple LLM providers through the `provider` field in `.swarm.yml`. If not specified, the action falls back to the legacy `anthropic-api-key` input.

Provider `apiKey` values may reference an environment variable as `$NAME` or `${NAME}`. Set that environment variable on the action step from a GitHub secret; swarm-review resolves the reference at runtime and fails clearly if it is missing. Literal keys are supported for local testing but should never be committed.

### Anthropic (default)

```yaml
provider:
  type: anthropic
  config:
    apiKey: $ANTHROPIC_API_KEY  # Or use a GitHub secret reference
    model: claude-3-5-sonnet-latest
```

### OpenAI

```yaml
provider:
  type: openai
  config:
    apiKey: $OPENAI_API_KEY
    model: gpt-4o
    baseURL: https://api.openai.com/v1  # optional, defaults to OpenAI
```

### OpenRouter

```yaml
provider:
  type: openrouter
  config:
    apiKey: $OPENROUTER_API_KEY
    model: anthropic/claude-3.5-sonnet
```

### OpenClaw

OpenClaw is an open-source autonomous AI agent that can be used as a provider via its OpenAI-compatible API. It requires a running OpenClaw gateway instance.

```yaml
provider:
  type: openclaw
  config:
    apiKey: $OPENCLAW_GATEWAY_TOKEN
    model: kimi-k2.5:cloud
    baseURL: http://localhost:11434/v1
```

**Note:** OpenClaw requires a gateway to be running. The default `baseURL` points to the local Ollama/OpenClaw gateway. Adjust the `baseURL` if your gateway is hosted elsewhere.

### Hermes Agent

Hermes Agent is a self-improving AI agent built by Nous Research that supports OpenAI-compatible API endpoints. It can work with local models, cloud APIs, and multi-provider routers.

```yaml
provider:
  type: hermes
  config:
    apiKey: $HERMES_API_KEY
    model: nous-hermes-3-llama-3.1-405b
    baseURL: http://localhost:8080/v1
```

**Note:** Hermes requires a running instance. The default `baseURL` points to the local Hermes gateway. Adjust the `baseURL` if your Hermes instance is hosted elsewhere.

### Groq

Groq provides ultra-low latency inference using their LPU (Language Processing Unit) technology. It's ideal for speed-sensitive applications requiring fast response times.

```yaml
provider:
  type: groq
  config:
    apiKey: $GROQ_API_KEY
    model: llama-3.3-70b-versatile
```

**Note:** Groq offers industry-leading latency for compatible models. Visit [Groq's documentation](https://console.groq.com/docs/models) for available models.

### Together AI

Together AI specializes in high-scale open-source LLMs with excellent price/performance. It supports fine-tuning and provides sub-100ms response times.

```yaml
provider:
  type: together
  config:
    apiKey: $TOGETHER_API_KEY
    model: meta-llama/Llama-3.3-70B-Instruct-Turbo
```

**Note:** Together AI is optimized for open-source models like Llama. Check their [model catalog](https://api.together.xyz/models) for available options.

### Mistral AI

Mistral AI is a leader in open-weight model APIs, providing access to their Mistral models through an OpenAI-compatible endpoint.

```yaml
provider:
  type: mistral
  config:
    apiKey: $MISTRAL_API_KEY
    model: mistral-large-latest
```

**Note:** Mistral offers both open-weight and proprietary models. See their [API documentation](https://docs.mistral.ai/) for model options.

### Cohere

Cohere provides enterprise-grade language models with an OpenAI-compatible API. Their models are optimized for business applications including text generation, summarization, and analysis.

```yaml
provider:
  type: cohere
  config:
    apiKey: $COHERE_API_KEY
    model: command-r-plus
```

**Note:** Cohere's Compatibility API allows seamless integration with OpenAI-based applications. Visit [Cohere's documentation](https://docs.cohere.com/docs/compatibility-api) for available models.

### Perplexity

Perplexity offers search-enhanced AI models that combine language understanding with real-time web search capabilities, providing up-to-date and factual responses.

```yaml
provider:
  type: perplexity
  config:
    apiKey: $PERPLEXITY_API_KEY
    model: llama-3.1-sonar-small-128k-online
```

**Note:** Perplexity models include web search capabilities for more accurate and current information. See their [API documentation](https://docs.perplexity.ai/docs/getting-started/quickstart) for model options.

### Hyperbolic

Hyperbolic provides cost-optimized GPU inference for open-source models through an OpenAI-compatible API, offering competitive pricing for high-scale deployments.

```yaml
provider:
  type: hyperbolic
  config:
    apiKey: $HYPERBOLIC_API_KEY
    model: meta-llama/Llama-3.3-70B-Instruct
```

**Note:** Hyperbolic specializes in affordable on-demand GPU inference. Check their [REST API documentation](https://docs.hyperbolic.xyz/docs/rest-api) for available models.

### Gemini

Gemini is Google's family of multimodal AI models, including the experimental Gemini 2.0 Flash model with fast inference and strong reasoning capabilities.

```yaml
provider:
  type: gemini
  config:
    apiKey: $GEMINI_API_KEY
    model: gemini-2.0-flash-exp
```

**Note:** Gemini uses the Google AI API with the API key passed as a query parameter. Visit [Google AI Studio](https://makersuite.google.com/app/apikey) to get an API key and check their [documentation](https://ai.google.dev/gemini-api/docs) for available models.

### Custom Provider

For any OpenAI-compatible API:

```yaml
provider:
  type: custom
  config:
    apiKey: $CUSTOM_API_KEY
    model: your-model-name
    baseURL: https://your-provider.com/v1
    headers:
      X-Custom-Header: value
```

`baseURL` may be an API root such as `https://your-provider.com/v1` or the full `/chat/completions` endpoint.

### Legacy Mode

If you don't configure a provider in `.swarm.yml`, the action uses the legacy inputs:

```yaml
- name: Run swarm-review
  uses: EvanGribar/Swarm-Review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    anthropic-model: claude-3-5-sonnet-latest
```

This is equivalent to configuring:

```yaml
provider:
  type: anthropic
  config:
    apiKey: $ANTHROPIC_API_KEY
    model: claude-3-5-sonnet-latest
```

## Action Inputs

- `github-token`: GitHub token with permission to comment on pull requests.
- `anthropic-api-key`: legacy Anthropic API key; use `.swarm.yml` for other providers.
- `anthropic-model`: optional legacy Anthropic model override.
- `api-endpoint`: optional Anthropic-compatible messages endpoint for legacy configuration.
- `config-path`: optional path to the swarm config file.
- `pull-number`: optional pull request number when it cannot be resolved from the event payload.
- `check-run-id`: optional existing check run ID to update after the review.
- `inline`: optional override to post findings as inline review comments (`true` or `false`).
- `review-event`: optional override for GitHub review event status (`COMMENT`, `APPROVE`, `REQUEST_CHANGES`, or `AUTO`).

## Action Outputs

- `pull-number`: pull request number processed by this run.
- `output-mode`: active render mode (`outcome` or `full`).
- `comment-id`: numeric ID of the created or updated PR comment.
- `comment-action`: either `created` or `updated`.
- `comment-url`: URL of the created or updated PR comment when available.
- `check-run-updated`: `true` when a valid check run ID was provided and updated.
- `total-input-tokens`: total input tokens consumed by LLM calls.
- `total-output-tokens`: total output tokens consumed by LLM calls.
- `total-cost`: estimated total cost of LLM calls in USD.
- `total-calls`: total number of LLM calls executed.

## Example Result

The final comment is designed to read like a human review thread:

```text
## swarm-review

security flagged src/api/users.ts:47 — raw user input is passed into a query string.
performance disagreed — the path is currently low traffic but still has avoidable overhead.
principal: the security concern is valid. Use a parameterized query.
```

## Local Development

```bash
npm install
npm run build
npm test
```

## Troubleshooting

- Missing token or API key:
  - Ensure `github-token` and `anthropic-api-key` are passed to the action.
- The action cannot resolve pull request number:
  - Confirm the workflow runs on pull request events, or provide the `pull-number` action input.
- LLM response parsing failures:
  - The run fails when the model output is not valid JSON matching the schema.
  - Retry with a stricter model instruction in your agent mandates or principal mandate.
- Check run was not updated:
  - `check-run-id` must be a positive integer string.

## Practical Limits

- Large diffs increase token usage and can reduce claim quality due to context compression.
- High agent counts and many debate rounds increase runtime and cost linearly.
- Recommended starting point:
  - 3-5 agents
  - 1-2 debate rounds
  - confidence threshold of 0.6-0.75

Tune these values based on repository size and expected review depth.

## Release Process

Releases are delivered in focused pull requests so each risk domain can be reviewed and rolled back independently. To publish a stable release:

1. Merge the release metadata PR after CI passes and create the matching `vX.Y.Z` tag and GitHub release.
2. The release workflow checks that the tag matches `package.json`, runs the full tests, and verifies the committed bundle.
3. For stable releases, the workflow advances the floating major tag (for example, `v1`) to the verified release commit.

Consumers should pin `EvanGribar/Swarm-Review@v1` for compatible v1 updates or a full tag such as `@v1.1.0` for an immutable version.


## Project Layout

- `src/types.ts`: shared schemas and data contracts.
- `src/config.ts`: config loading and validation.
- `src/diff.ts`: pull request diff fetching and formatting.
- `src/prompts.ts`: all LLM prompt templates.
- `src/agents/`: review, debate, and synthesis rounds.
- `src/index.ts`: action entrypoint.

## Notes

The implementation is intentionally small and explicit. The system is built around a strict data contract so agent output can be validated before it is passed to the next stage.
