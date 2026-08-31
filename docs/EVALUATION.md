# Swarm-Review Multi-Agent Debate Evaluation Methodology

This document details the evaluation methodology, benchmark configuration, metrics, and budget controls used to test whether Swarm-Review's multi-agent debate architecture improves pull-request review quality enough to justify its added cost and complexity.

## Research Question

Does multi-agent debate in AI pull-request review improve requirement violation detection or precision compared to single-agent baselines, multi-agent non-debate review, static analysis, and contract-aware SpecBridge evaluation?

## Benchmark Environment: SpecBench

The evaluation is conducted against **SpecBench v0.2**, a controlled benchmark suite consisting of 10 pull-request review cases derived from a reference SaaS application:

1. `admin-invite-authorization`: Authorization check omitted on team member invitation.
2. `dashboard-export-ux`: Export success label displayed before file generation completes.
3. `failed-payment-retry`: Payment retry generates fresh request instead of reusing idempotency key.
4. `invoice-audit-omission`: Manual invoice void endpoint omits audit event recording.
5. `notification-cancellation`: Cancelled notifications included in automated retry batch.
6. `notification-opt-out`: Billing reminder dispatched to user who opted out.
7. `profile-validation`: Display name validation accepts whitespace-only strings.
8. `role-change-regression`: Role demotion omits last-admin protection guard.
9. `starter-seat-limit`: Starter plan team member invitation bypasses 3-seat limit.
10. `trial-cancellation`: Cancelled trial subscription reactivated by retry logic.

## Evaluated Configurations

Five architectures are evaluated under identical case inputs, primary model (`gpt-4o-mini`), token limits (1,500 max output tokens per call), and scoring rules:

1. **Single-agent review (`v03-single-agent`)**: A single reviewer inspecting the PR diff against explicit product requirements.
2. **Multiple independent agents without debate (`v03-swarm-no-debate`)**: Three specialized reviewer agents (Auth/State, UX/Behavior, Data Integrity/Audit) + Principal Consolidator synthesis (0 debate rounds).
3. **Multiple agents with debate (`v03-swarm-with-debate`)**: Three specialized reviewer agents + 1 structured debate round + Principal Consolidator synthesis.
4. **Multiple agents with debate plus static analysis (`v03-swarm-debate-static`)**: Three specialized reviewer agents + Static analysis findings injected into debate + 1 debate round + Principal Consolidator synthesis.
5. **Requirement-aware review using SpecBridge contracts (`v03-specbridge-requirements`)**: Direct evaluation of checked-in `.specbridge/requirements.json` contracts via LLM requirement evaluator, ingesting `coverage.json` artifacts into SpecBench scoring.

## Metrics & Scoring Methodology

SpecBench applies deterministic matching against expected requirement violations to calculate:

- **True Positives (TP)**: Submitted findings matching expected requirement violations by ID, line range, or keyword match.
- **False Positives (FP)**: Submitted findings not matching any expected requirement violation, or duplicate findings matching already-claimed expected findings.
- **False Negatives (FN)**: Expected requirement violations not detected by the configuration.
- **Precision**: $\frac{TP}{TP + FP}$
- **Recall**: $\frac{TP}{TP + FN}$
- **F1 Score**: $2 \times \frac{\text{Precision} \times \text{Recall}}{\text{Precision} + \text{Recall}}$
- **Severity-Weighted Recall**: Recall weighted by severity importance (Critical: 4, High: 3, Medium: 2, Low: 1).
- **Critical Requirement Detection Rate**: Ratio of critical/high-severity requirement violations successfully detected.
- **Duplicate Finding Count**: Multiple findings matching the same underlying issue (counted as FPs to prevent recall inflation).
- **Runtime (ms)**: Wall-clock execution latency per review case.
- **Input & Output Tokens**: Total LLM token usage across all agent, debate, and principal calls.
- **Estimated Cost (USD)**: Calculated from measured token usage using configured pricing ($0.15/M input, $0.60/M output).
- **Cost per Actionable Finding**: $\frac{\text{Total Cost}}{\text{True Positives}}$.
- **Structured-Output Failure & Retry Rate**: Recorded schema validation errors or provider retries.

## Budget Controls & Experimental Rigor

1. **Pre-execution Estimation**: Maximum estimated cost calculated before live invocation.
2. **Hard Cost Ceiling**: Strict total experiment budget ($5.00 USD) enforced via `SPECBENCH_MAX_TOTAL_COST_USD`.
3. **Per-Call & Per-Run Limits**: Clamped output token limits (1,500 tokens) and call ceilings per case.
4. **Uncertain Billing Reservation**: Failed or unpriced calls retain conservative budget reservations.
5. **Repetitions**: 3 independent trials per configuration to account for LLM non-determinism.
6. **No Secret Leakage**: API keys and tokens are excluded from committed artifacts and logs.
