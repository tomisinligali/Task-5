# Task 5 — Pseudocode Specification, Implementation, and Verification

A repository of pseudocode specs and implementations for three parts:

* **part-a** — nine pseudocode artifacts: three own functions, three
  open-source functions, and one planted-bug pair plus its identification.
* **part-b** — a feature specified only in pseudocode, then implemented by hand,
  then tested against the hand traces.
* **part-c** — the same feature implemented by AI from the pseudocode, then
  reverse-engineered, diffed against the spec, and compared against the hand
  implementation.

## Repository map

```
part-a/
  function-1-complex/       processAiUploadJob (pseudocode + hand trace)
  function-2-money/         resolvePayment      (pseudocode + hand trace)
  function-3-error-handling/deleteRecordAction  (pseudocode + hand trace)
  a2/                       bcryptjs open-source functions (getRounds, genSaltSync, compare)
                            first-pass pseudocode, AI explanation, differences, ai-comparison.md
  a3/                       planted-bug pair: function.md + actual-behavior.md + intended-behavior.md
                            plus bug-analysis.md and hand-trace.md
part-b/
  b1-discount-code-spec.md  feature pseudocode + 7 hand traces
  implementation/           discount.ts (own implementation) + traces.ts (tests)
  trace-vs-test-comparison.md
part-c/
  c1-ai-implemented/        discount.ts + run.ts (AI implementation)
  c2-verification.md        reverse-engineered pseudocode, difference table, ambiguities
  c3-compare/               harness.ts (runs B2 and C1 on the same inputs)
  c3-comparison.md          two-implementation comparison + the one disagreement
  c4-explanation.md         five-minute speaking notes + non-coder check
```

## The pseudocode standard used

Every specification follows the same rules:

1. **One named function per spec**, with explicit sections: `FUNCTION`,
   `INPUTS`, `OUTPUT`, `SIDE EFFECTS`, `FAILS WHEN`, `STEPS`.
2. **Actual vs. intended are separate.** Actual-behavior specs describe what the
   code really does, bug and all; intended-behavior specs describe what it should
   do. The bug is the difference.
3. **Deterministic inputs.** Time is injected (e.g. `nowUtc`), never read from the
   clock inside the logic.
4. **Money in integer minor units** (cents), never floats.
5. **Every failure has a stable code** and expected business failures are
   returned as typed failures, not thrown.
6. **Checks are listed in exact evaluation order**, and every early return is
   explicit, so the first failing check is unambiguous.
7. **Every database read/write, external call, and state change is listed**, and
   transaction boundaries are marked.
8. **Invariants are stated** (for example: `total >= 0`, `attempts` is
   incremented not overwritten).
9. **Hand-trace at least five inputs before coding**, including the awkward ones
   (expired, reused, negative quantity).
10. **One small code block per pseudocode step.** If a line has no matching step,
    the code is wrong or the spec is incomplete.

## What I learned about the gap between what you specify and what you get

* **Exact pseudocode produces faithful code.** The C1 implementation, built from
  the B1 spec alone, reproduced every failure code, the exact check order, and
  the transaction re-check. A vague "build a discount code feature" prompt would
  not have pinned down the failure taxonomy or the ordering.

* **The AI still added mechanical things.** It introduced a factory for the
  database dependency, an exception to signal rollback, a `failure()` helper, and
  concrete message text. These are not behavioural surprises, but they are
  additions the spec did not request. Most are welcome; all should be reviewed.

* **Ambiguity is where divergence starts.** The pseudocode wrote `database.*`
  without saying where `database` comes from, so the AI bound it through a
  factory. That was the only genuine interpretation gap in C2.

* **Unspecified fields get silently dropped.** The pseudocode's in-transaction
  `already_used` failure carried `{ limit: ... }`. C1 replaced the inline
  `ROLLBACK; RETURN` with an exception that held only the code, so the rebuilt
  failure lost `details.limit`. The two implementations agreed on 17 of 18
  inputs and only diverged under a concurrent double-submit (C3). Specifying the
  full payload on every return would have prevented it.

* **Ordering and early returns matter as much as the rules.** Because the
  pseudocode fixed the check order, both implementations returned the same code
  for inputs that could fail several ways (for example an expired code on an
  already-used account returns `code_expired`, not `already_used`).

* **Verification needs more than the happy path.** Line-by-line reverse
  engineering (C2) plus running both implementations on the same inputs (C3)
  caught what the sequential traces hid.

* **Plain-language test.** If a non-coder can restate the feature ("it checks a
  coupon's rules and applies the discount, or says why not"), the spec and the
  explanation were clear; if not, the spec or the explanation was the problem.

## Running the code

Requires Node 22.6+ (TypeScript types are stripped natively); tested on Node 26.

```
cd part-b/implementation && node traces.ts            # own implementation vs traces
cd part-c/c1-ai-implemented && node run.ts            # AI implementation vs traces
cd part-c/c3-compare && node harness.ts               # B2 vs C1 on 18 shared inputs
```

No dependencies and no build step are required.
