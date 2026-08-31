# Swarm-Review Evaluation Results & Architecture Benchmarks

This report presents a controlled, empirical evaluation of Swarm-Review's multi-agent debate architecture against four baseline review configurations across the 10-case **SpecBench v0.2** benchmark suite.

---

## 1. Methodology

The evaluation was conducted using SpecBench to test whether multi-agent debate improves pull-request review quality enough to justify its added cost and latency. Five distinct configurations were tested:

1. **Single-Agent Review (`v03-single-agent`)**: A single LLM reviewer inspecting PR patches for requirement violations.
2. **Multiple Independent Reviewers without Debate (`v03-swarm-no-debate`)**: 3 domain-specialized reviewers + 1 Principal Consolidator call (0 debate rounds).
3. **Multiple Agents with Debate (`v03-swarm-with-debate`)**: 3 domain-specialized reviewers + 1 structured debate round + 1 Principal Consolidator call.
4. **Multiple Agents with Debate plus Static Analysis (`v03-swarm-debate-static`)**: 3 specialized reviewers + Static analysis findings injected into debate + 1 debate round + 1 Principal Consolidator call.
5. **Requirement-Aware Review using SpecBridge Contracts (`v03-specbridge-requirements`)**: Direct evaluation of checked-in `.specbridge/requirements.json` contracts via structured LLM evaluator, generating `coverage.json`.

All configurations were evaluated under strict experimental controls:
- Identical prompt instructions, token budgets (1,500 max output tokens), and case patch inputs.
- Deterministic scoring without manual intervention.
- 3 independent trials per configuration to measure variance.

---

## 2. Model and Configuration

- **Primary Evaluated Model**: `gpt-4o-mini` (OpenAI API).
- **Benchmark Version**: SpecBench `v0.2` (10 reference SaaS cases).
- **Repetitions**: 3 trials per configuration (15 complete benchmark runs, 450 total model calls).
- **Price Rates**: $0.15 / 1M input tokens, $0.60 / 1M output tokens.

---

## 3. Budget

| Metric | Budget Ceiling | Actual Spend |
| --- | --- | --- |
| Total Experiment Cost | $5.0000 USD | $0.0718 USD |
| Max Cost Per Run | $10.0000 USD | $0.0077 USD |
| Per-Call Output Token Limit | 1,500 tokens | ~150-350 tokens (avg) |
| Budget Violations | 0 | 0 |

All runs stayed strictly within the reserved budget ceiling.

---

## 4. Aggregate Comparison Table

Mean values across 3 independent repetitions (10 cases per repetition):

| Configuration | Reps | Recall | Precision | F1 Score | Critical Detection | Mean False Positives | Mean Cost / Run | Mean Runtime / Run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Single-Agent** (`v03-single-agent`) | 3 | 100.0% | 86.1% | 92.4% | 100.0% | 1.67 | $0.0014 | 23.0s |
| **Swarm without Debate** (`v03-swarm-no-debate`) | 3 | 100.0% | 100.0% | 100.0% | 100.0% | 0.00 | $0.0061 | 84.3s |
| **Swarm with Debate** (`v03-swarm-with-debate`) | 3 | 100.0% | 100.0% | 100.0% | 100.0% | 0.00 | $0.0077 | 116.4s |
| **Swarm Debate + Static** (`v03-swarm-debate-static`) | 3 | 100.0% | 100.0% | 100.0% | 100.0% | 0.00 | $0.0077 | 110.0s |
| **SpecBridge Requirements** (`v03-specbridge-requirements`) | 3 | 100.0% | 97.0% | 98.4% | 100.0% | 0.33 | $0.0017 | 31.9s |

---

## 5. Per-Case Results

Detection status across all 10 benchmark cases:

| Case ID | Expected Violation | Single-Agent | Swarm No-Debate | Swarm Debate | Swarm Static | SpecBridge |
| --- | --- | --- | --- | --- | --- | --- |
| `admin-invite-authorization` | Missing admin role check | Detected (1 FP) | Detected | Detected | Detected | Detected |
| `dashboard-export-ux` | Premature export success | Detected | Detected | Detected | Detected | Detected |
| `failed-payment-retry` | Idempotency key omitted | Detected | Detected | Detected | Detected | Detected |
| `invoice-audit-omission` | Missing void audit log | Detected (1 FP) | Detected | Detected | Detected | Detected |
| `notification-cancellation` | Cancelled retry bug | Detected | Detected | Detected | Detected | Detected |
| `notification-opt-out` | Ignored reminder opt-out | Detected | Detected | Detected | Detected | Detected |
| `profile-validation` | Blank display name accepted | Detected | Detected | Detected | Detected | Detected |
| `role-change-regression` | Last-admin demotion bug | Detected | Detected | Detected | Detected | Detected |
| `starter-seat-limit` | Starter seat limit bypass | Detected | Detected | Detected | Detected | Detected |
| `trial-cancellation` | Trial reactivation bug | Detected | Detected | Detected | Detected | Detected |

---

## 6. Debate Wins

- **No Unique Discoveries**: In 0 out of 10 cases did debate discover a requirement violation that was missed by initial independent reviewers.
- **No Additional FP Suppression**: Principal synthesis in the non-debate configuration (`v03-swarm-no-debate`) already eliminated 100% of false positives. Debate added no additional precision gains.

---

## 7. Debate Failures

- **Cost Inflation**: Debate increased run cost by **+26.2%** ($0.0077 vs $0.0061) without any gain in recall or precision.
- **Latency Penalty**: Debate increased review completion latency by **+38.1%** (116.4s vs 84.3s).
- **Redundant Processing**: Debate rounds consistently re-confirmed candidate findings without changing the final principal synthesis output.

---

## 8. Static-Analysis Contribution

- Static analysis rules produced clean, deterministic findings for file/line hunks in 100% of cases.
- Because multi-agent reviewers already achieved 100% recall on the benchmark suite, static analysis did not alter the final true positive count, but provided zero-latency candidate verification.

---

## 9. Requirement-Aware Contribution

- **SpecBridge Contract Mode (`v03-specbridge-requirements`)**:
  - Achieved **100.0% Recall** and **97.0% Precision** (F1 = 98.4%).
  - Reduced cost by **78%** compared to multi-agent debate ($0.0017 vs $0.0077).
  - Reduced latency by **73%** (31.9s vs 116.4s).
  - Provided structured criterion coverage (`coverage.json`) and standard SARIF export (`findings.sarif`).

---

## 10. Cost-Quality Tradeoff

$$\text{Efficiency Ratio} = \frac{\text{F1 Score}}{\text{Cost per Run}}$$

| Architecture | F1 Score | Cost / Run | F1 per $0.001 | Latency |
| --- | --- | --- | --- | --- |
| **Single-Agent** | 92.4% | $0.0014 | 66.0 | 23.0s |
| **SpecBridge Requirements** | 98.4% | $0.0017 | 57.9 | 31.9s |
| **Swarm without Debate** | 100.0% | $0.0061 | 16.4 | 84.3s |
| **Swarm with Debate** | 100.0% | $0.0077 | 13.0 | 116.4s |
| **Swarm Debate + Static** | 100.0% | $0.0077 | 13.0 | 110.0s |

Multi-agent debate has the lowest cost-efficiency ratio among all tested architectures.

---

## 11. Variance Across Repetitions

Across 3 independent repetitions per configuration, performance was highly stable:
- `v03-swarm-no-debate`, `v03-swarm-with-debate`, and `v03-swarm-debate-static` maintained **100% Precision and 100% Recall** across all 3 trials (Standard Deviation = 0.00).
- `v03-single-agent` precision ranged between 83.3% and 90.9% (Mean = 86.1%, SD = 0.03).
- `v03-specbridge-requirements` precision ranged between 90.9% and 100.0% (Mean = 97.0%, SD = 0.04).

---

## 12. Limitations

1. **Benchmark Size**: SpecBench v0.2 consists of 10 controlled cases. While adequate for directional comparison, complex production pull requests may exhibit higher mandate ambiguity.
2. **Evaluator Identity**: SpecBench was authored by the same engineering team as Swarm-Review.
3. **Model Selection**: Benchmarks were performed using `gpt-4o-mini`. Larger reasoning models may show different relative debate dynamics.

---

## 13. Honest Product Recommendation

> [!IMPORTANT]
> **Recommendation: Keep Debate Optional (Default to Non-Debate Swarm or SpecBridge Requirement Review)**
>
> Multi-agent debate does **not** justify being the default review mode in Swarm-Review. Principal synthesis alone (`v03-swarm-no-debate`) achieves identical 100% precision and 100% recall while saving **26% in cost** and **38% in latency**. When explicit `.specbridge/requirements.json` contracts exist, SpecBridge requirement-aware review should be preferred, delivering 98.4% F1 at 22% of the cost.
