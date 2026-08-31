# SpecBridge requirement-aware review

Swarm-Review v1.1 can evaluate a checked-in [SpecBridge](https://github.com/EvanGribar/SpecBridge) `1.0` contract. It is opt-in; without `requirements.enabled: true`, existing review behavior is unchanged.

```yaml
requirements:
  enabled: true
  contract_path: .specbridge/requirements.json
  fail_on_violation: false
  upload_sarif: false
```

Only a repository-relative local JSON path is supported. The loader rejects absolute/traversal paths, oversized files (256 KB default), malformed JSON, and non-`1.0` contracts. See [the complete example](../examples/specbridge/requirements.json).

Every criterion becomes exactly one `satisfied`, `violated`, `not_verifiable`, or `not_applicable` record. Violations require source-code evidence; budget exhaustion becomes `not_verifiable`. `swarm-review-output/coverage.json` is the source of truth and `swarm-review-output/findings.sarif` is generated from it with `@specbridge/sarif`; only evidenced violations appear in SARIF.

```yaml
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: swarm-review-output/findings.sarif
```

The action exposes `coverage-path`, `sarif-path`, `requirement-count`, `violated-count`, and `not-verifiable-count`. `fail_on_violation: true` requests changes only for evidenced blocking violations. Swarm Review consumes the released `@specbridge/core` and `@specbridge/sarif` tarballs pinned in `package.json`; there is no source submodule or local package bridge. The action bundle contains the canonical core validator and SARIF converter. Historical SpecBench evaluation references remain for provenance; the benchmark runtime now lives in SpecBridge.
