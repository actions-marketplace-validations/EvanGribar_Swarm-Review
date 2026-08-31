# SpecBridge v1.1 implementation plan

## Current architecture findings

Swarm-Review runs independent finding agents, optional static analysis, sequential debate rounds, and a principal synthesis. `src/index.ts` owns orchestration, managed comments, review events, output values, budget tracking, and the trusted `issue_comment` re-review boundary. Configuration is Zod-validated in `src/types.ts` and parsed in `src/config.ts`; prompts live in `src/prompts.ts`. The committed `dist/index.js` is produced by `npm run bundle` and CI rejects a stale bundle. Existing tests are offline Node tests with mocked model transport.

## Dependency strategy

Swarm Review consumes the consolidated `@specbridge/core` and `@specbridge/sarif` packages from the public SpecBridge GitHub release tarballs pinned in `package.json`. The action remains distributable because `ncc` bundles those dependencies, and CI installs them with a normal `npm ci` without submodules. If a future npm publication is configured, only the dependency URLs need to move to exact registry versions; the integration API remains unchanged.

## Modules and schema mappings

* `src/requirements.ts`: safe, size-bounded, local JSON contract loading with `parseContract`; canonical coverage normalization with `parseCoverageReport`; deterministic artifact and SARIF writing.
* `src/agents/requirements.ts`: one focused requirement evaluator and a principal normalization pass. It produces SpecBridge `CriterionCoverage` records rather than altering existing findings.
* `src/prompts.ts`: requirement-review and requirement-principal templates, each restricted to supplied contract IDs.
* `src/types.ts` / `src/config.ts`: opt-in `requirements` configuration.
* `src/format.ts`: a coverage section rendered only from validated coverage.
* `src/index.ts`: invokes the feature only when enabled, emits artifacts and outputs, and converts confirmed blocking violations into the existing review-event path only when configured.

The contract is parsed exclusively with `@specbridge/core`. Requirement and criterion IDs are preserved. Principal results are normalized against the contract into exactly one criterion result each; invalid IDs and duplicates fail closed, missing or budget-exhausted decisions become `not_verifiable`. Only evidenced `violated` results are accepted. The same validated `ReviewCoverageReport` feeds the JSON artifact, SARIF conversion, and Markdown table.

## Prompt changes

The requirement evaluator receives the contract criteria, diff, and context. It must return structured coverage decisions; it must use `not_verifiable` for insufficient evidence, cannot invent IDs, and cannot label unrelated quality observations as requirement failures. The requirement principal sees these decisions and the existing debate transcript, may challenge evidence, and returns canonical results only. No chain-of-thought is requested or persisted.

## Security and reliability

The configured path is repository-relative, rejects absolute and traversal paths, is size-limited, and is read locally only from the trusted workspace checkout. Contract/model text is Markdown-escaped. Evidence paths and ranges are revalidated through SpecBridge and against the workspace/diff context before a violation is retained. No remote contracts, shell interpolation, untrusted checkout execution, secrets logging, or parallel merge gate are introduced. Budget exhaustion produces `not_verifiable`, never a confirmed violation.

## Test and release plan

Add offline tests for configuration, loader safety, duplicate/version validation, evaluator/principal normalization, evidence rules, stable artifacts/SARIF, Markdown escaping, and gate behavior. Preserve current tests. Regenerate `dist/` with the existing bundle command and retain CI's stale-bundle check. Documentation covers the pinned package channel, configuration, artifacts, SARIF upload workflow, and known limits.
