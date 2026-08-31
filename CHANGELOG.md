# Changelog

All notable changes to this project are documented in this file.

## Unreleased

### Changed

* Migrate the opt-in requirement review integration to the consolidated SpecBridge Core and SARIF packages.
* Remove the former source-submodule and local SARIF bridge dependency; the action now pins public release tarballs and bundles them during release.

## [1.3.0](https://github.com/EvanGribar/Swarm-Review/compare/swarm-review-v1.2.0...swarm-review-v1.3.0) (2026-07-26)


### Features

* **architecture:** default non-debate review architecture, presets, and SpecBridge evaluation ([8622fce](https://github.com/EvanGribar/Swarm-Review/commit/8622fce7d83094f2f95a8fdbbbd41c5a1be3cb55))

## [1.2.0](https://github.com/EvanGribar/Swarm-Review/compare/swarm-review-v1.1.0...swarm-review-v1.2.0) (2026-07-25)


### Features

* Add configurable diff limits, custom API endpoint, and file filtering ([#51](https://github.com/EvanGribar/Swarm-Review/issues/51)) ([f0cea85](https://github.com/EvanGribar/Swarm-Review/commit/f0cea85fee246c40d0fa17c540e97d8a36255f69))
* Add Gemini provider support ([793bbc1](https://github.com/EvanGribar/Swarm-Review/commit/793bbc17dbec4263c605d1dc295b1062d9d5d530))
* add opt-in SpecBridge requirement-aware reviews ([#65](https://github.com/EvanGribar/Swarm-Review/issues/65)) ([c7c8ef0](https://github.com/EvanGribar/Swarm-Review/commit/c7c8ef088fa32d5229a3979bf51c7c0f08fdd0d1))
* add per-agent system prompts and confidence calibration overrides ([#59](https://github.com/EvanGribar/Swarm-Review/issues/59)) ([14124fc](https://github.com/EvanGribar/Swarm-Review/commit/14124fcb0e53ddaec2953bca4d0686e0d261afdb))
* AST Codebase Navigation & Context Enrichment (v0.7.0) ([#56](https://github.com/EvanGribar/Swarm-Review/issues/56)) ([6664856](https://github.com/EvanGribar/Swarm-Review/commit/6664856d7c04331c5619f4f82af60b5528e247dc))
* implement local sandbox and static analysis integration for v0.6.0 ([833d97e](https://github.com/EvanGribar/Swarm-Review/commit/833d97e35b200e8bffa8908cf455b6c83b58f412))
* implement local sandbox and static analysis integration for v0.6.0 ([#55](https://github.com/EvanGribar/Swarm-Review/issues/55)) ([1cb870c](https://github.com/EvanGribar/Swarm-Review/commit/1cb870cb491a4e6cd04b38ad538964ab302259a5))
* Implement Phase 1 analysis agents (heuristics, provenance, web-consensus) ([066a588](https://github.com/EvanGribar/Swarm-Review/commit/066a588cb5e84f1e0a84ea249a5612ef3979ca19))
* implement v0.7.0 AST codebase navigation and context enrichment ([e526f3d](https://github.com/EvanGribar/Swarm-Review/commit/e526f3db0cab5a006089b520a830e95a600db341))
* **orchestrator:** add degraded-mode consensus contract and kickoff backlog workflow ([8aba05a](https://github.com/EvanGribar/Swarm-Review/commit/8aba05a8f3b463491e7fce299b0bab4884538f69))
* **orchestrator:** wire temporal dispatch and collection activities ([f0b66d1](https://github.com/EvanGribar/Swarm-Review/commit/f0b66d148c99710359d1c363e4cc293002e9a39a))
* **phase-1:** core swarm completion and verification tools ([#13](https://github.com/EvanGribar/Swarm-Review/issues/13)) ([ae981cf](https://github.com/EvanGribar/Swarm-Review/commit/ae981cf1605ab8d06bc49267953703fceb1d7c7c))
* **runtime:** add kafka worker loops and orchestrator result consumer ([699debc](https://github.com/EvanGribar/Swarm-Review/commit/699debc99ed4fff8699e6d501eb1a2a651ec1a95))
* Swarm-Review v0.5 Release Sprint ([#54](https://github.com/EvanGribar/Swarm-Review/issues/54)) ([ee38c07](https://github.com/EvanGribar/Swarm-Review/commit/ee38c077839ff765e186530c7d53b4301ae1eb04))


### Bug Fixes

* 24: Simplify issue templates and redundant security template ([#25](https://github.com/EvanGribar/Swarm-Review/issues/25)) ([72159ec](https://github.com/EvanGribar/Swarm-Review/commit/72159ec2cbcc12862ab1429c67d04f932438f811))
* **ci:** align release-please manifest version with package.json v1.1.0 ([717a169](https://github.com/EvanGribar/Swarm-Review/commit/717a169de285a1db3cf334523bf9a7d196f63da6))
* **ci:** update CI for documentation-only repository ([a3e7648](https://github.com/EvanGribar/Swarm-Review/commit/a3e764807416139a33601ab18dd6a4631b903bbe))
* **github-actions:** use underscore input names for actions/first-interaction@v3 ([52f439c](https://github.com/EvanGribar/Swarm-Review/commit/52f439cef8468714b6754fc25b6a1346b160476d))
* **github-actions:** use underscore input names for actions/first-interaction@v3 ([b7e6bfa](https://github.com/EvanGribar/Swarm-Review/commit/b7e6bfa643861a15c454ae628697105657a76589))
* initialize SpecBridge submodule in release workflow ([7330c7a](https://github.com/EvanGribar/Swarm-Review/commit/7330c7a5e5bbd7eb6d8211e9009c77f5a1d75d5c))
* **labeler:** quote YAML label names to fix syntax error ([4673672](https://github.com/EvanGribar/Swarm-Review/commit/4673672dbf245591670bfe608ec01b7ff352e8b1))
* **labeler:** quote YAML label names to fix syntax error ([#11](https://github.com/EvanGribar/Swarm-Review/issues/11)) ([1971c3a](https://github.com/EvanGribar/Swarm-Review/commit/1971c3a002a6dc2e2a447c3ed30104d39ad43379))
* prevent fuzz target import-time crash when atheris is unavailable ([7af4882](https://github.com/EvanGribar/Swarm-Review/commit/7af4882b7070c581595a9a983c2a69dcb9994efc))
* resolve actions/setup-node SHA tag resolution error ([4963a33](https://github.com/EvanGribar/Swarm-Review/commit/4963a334543840aa7ee277a60def8878e6ff3526))
* resolve failing checks for CLI async path handling and optional fuzz dependency ([921ef27](https://github.com/EvanGribar/Swarm-Review/commit/921ef27a7bfd4abaa4de3f1ac8b4c03b854513fd))
* resolve YAML syntax error in labeler.yml ([bccd738](https://github.com/EvanGribar/Swarm-Review/commit/bccd7382981e6baf39ac391b7a5276bb6548e6d1))
* simplify pyproject.toml for documentation-only repository ([634a2b1](https://github.com/EvanGribar/Swarm-Review/commit/634a2b1e6b67fa8ba2ba3fac9fdfe1ddd3d1e00c))
* **test:** use regex pattern for version validation in metadata test instead of hardcoded version ([b943d2d](https://github.com/EvanGribar/Swarm-Review/commit/b943d2d5f1993f4fb60ce9c1031491cfc4fd7fe5))
* unblock CI format and clusterfuzz fuzz target startup ([32550f6](https://github.com/EvanGribar/Swarm-Review/commit/32550f62ca02befb46be4574f9c14eec2158dce6))

## [Unreleased]

## v1.1.0 - 2026-07-21

### Added
- Opt-in SpecBridge requirement contracts with safe, repository-local loading and validation.
- Criterion-level `satisfied`, `violated`, `not_verifiable`, and `not_applicable` coverage decisions with evidence enforcement.
- Canonical `swarm-review-output/coverage.json`, SARIF generation for evidenced violations, and artifact-derived PR coverage rendering.
- Optional `requirements.fail_on_violation` gating and action outputs for coverage and SARIF paths and counts.
- Deterministic offline validation covering the structured-output boundary, artifacts, SARIF, rendering, and gate policy without provider credentials.

### Changed
- Requirement-aware review remains disabled by default; existing review behavior is backward compatible.

### Limitations
- SpecBridge remains pinned through a Git submodule and a temporary local SARIF package bridge until published packages are available.
- SARIF is generated but not uploaded directly. Real-provider smoke validation is tracked in #66; offline validation does not prove model quality.

## v1.0.0 - 2026-07-14

### Added
- A committed, standalone GitHub Action bundle with CI enforcement against stale generated output.
- Per-agent `system_prompt` instructions for specialized reviewer personalities while preserving built-in output guardrails.
- Per-agent `min_confidence` thresholds, falling back to the global debate threshold when omitted.
- Trusted conversational re-reviews triggered by exact `/swarm-review` commands on pull requests.
- Strict per-run model budgets with concurrency-safe reservations, successful-call settlement, configurable output caps, and same-provider fallback models.
- Budget-aware degradation that skips unaffordable reviewer calls, defers unsynthesized findings for manual review, and prevents automatic approval after exhaustion.

### Security
- Restrict comment-triggered paid runs to repository owners, organization members, and collaborators.
- Bound developer-feedback context and ignore spoofed managed-comment markers from non-bot users.

### Fixed
- Declared the supported `pull-number` action input and corrected consumer workflow examples to reference the published action.
- Wired the legacy `api-endpoint` input through Anthropic calls instead of silently ignoring it.
- Normalized Anthropic and OpenAI-compatible base URLs to their request endpoints while preserving full endpoint URLs.
- Resolved documented `$ENV_VAR` provider API-key references instead of sending them as literal credentials.
- Corrected legacy provider documentation and action author metadata.
- Corrected diff prompt budget accounting for metadata, exclusions, and separators.

## v0.7.0 - 2026-05-21

### Added
- **Context Enrichment & AST Codebase Navigation**: Traces relative and aliased imports in modified files up to `max_depth` to extract signature declarations of classes, interfaces, types, functions, and variables (excluding method/function bodies).
- **TypeScript Path Aliases & baseUrl Support**: Resolves non-relative import paths with wildcards (e.g., `@/*`, `@utils/*`) and custom `baseUrl` mappings defined in `tsconfig.json`.
- **Path Traversal Security Validation**: Validates all resolved import paths to ensure they reside strictly within the workspace root, preventing path traversal attacks.
- **Fast Codebase Indexing**: Leverages `git ls-files` for extremely fast file discovery when indexing global symbols, automatically respecting `.gitignore` and falling back to manual disk traversal using custom `ignored_dirs`.
- **Import/AST Caching**: Caches resolved import paths, file signatures, and specifiers across agents and debate rounds, avoiding redundant file system operations and parsing.
- **Zod Schema Updates**: Added configuration schema support for `context_enrichment` including `ignored_dirs`.

## v0.6.0 - 2026-05-21

### Added
- **Local Sandbox & Static Analysis Hook**: Run user-specified shell commands (e.g. `npm run lint`, `tsc --noEmit`, `cargo check`) inside the Action runner workspace.
- **Linter & Compiler Parsers**: Parse CLI warnings/errors using:
  - `eslint-json`: For ESLint structured JSON reports (supports both direct stdout and output files via `-o`/`--output-file` regex-inference or an explicit `outputFile` config setting).
  - `regex`: Custom regular expressions with named capture groups to parse logs line-by-line (Zod schema enforces that `regex` pattern is required when parser is set to `"regex"` using a discriminated union).
- **Linter Agent Integration**: Static analysis findings automatically join the round 1 review and serve as ground-truth facts during the debate phase.

## v0.5.0 - 2026-05-19

### Added
- **GitHub Pull Request Reviews (Inline Comments)**: Published accepted findings directly as inline comments on specific modified lines in the pull request.
- **Review Status / PR Decision (Approve vs Request Changes)**: Added a `review_event` input support (`COMMENT`, `APPROVE`, `REQUEST_CHANGES`, and `AUTO`) to submit GitHub reviews and request changes when blocking findings are found.
- **Agent-Specific & Global Include/Exclude Glob Patterns**: Added `include_patterns` and `exclude_patterns` support globally and at the agent level. Reviewers skip running when no matching files are found.
- **Token Usage and Cost Tracking**: Implemented automated tracking of LLM input/output tokens and cost estimation per model for Anthropic, OpenAI, and Gemini models.
- **Action Metadata and Metrics Outputs**: Added inputs (`inline`, `review-event`) and outputs (`total-input-tokens`, `total-output-tokens`, `total-cost`, `total-calls`) to `action.yml`.

## v0.2.0 - 2026-04-21

### Added
- Broader reliability test coverage across model client behavior, GitHub integration helpers, and prompt template contracts.
- Action outputs for pull number, output mode, comment metadata, and check run update status for downstream workflow composition.
- Expanded README operational documentation with architecture, troubleshooting, output examples, and practical limits.

### Changed
- Version bumped from 0.1.1 to 0.2.0 for the feature-complete beta milestone.
- Release work organized into grouped, reviewable pull requests for safer rollout.

### Notes
- This release focuses on confidence, operability, and integration ergonomics ahead of a 1.0 hardening cycle.

## v0.1.1 - 2026-04-21

### Added
- Expanded automated test coverage for agent orchestration flows (shared finding normalization, review fan-out, debate progression, and synthesis schema).
- Added package metadata for repository links, issue tracking, and npm keywords.

### Changed
- Baseline version aligned to 0.1.1 for v0.2.0 development cycle.

## v0.1.0 - 2026-04-21

### Added
- Initial v0.1.x baseline release with core review swarm mechanics (independent review, multi-round debate, principal synthesis).
- GitHub Action integration with comment upsert and check-run reporting.
- YAML configuration via `.swarm.yml`.

## v0.0.2 - 2026-04-21

### Added
- Structured release plan execution in four delivery stages.
- Expanded unit coverage for diff formatting and GitHub helper behavior.

### Changed
- Release metadata updated for the v0.0.2 cycle.

### Notes
- Stage-specific implementation PRs are used to keep risk isolated and review focused.
