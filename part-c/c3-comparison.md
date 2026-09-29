# C3 — Compare the Two Implementations

Both implementations were built from the same B1 pseudocode:

* **B2** — `part-b/implementation/discount.ts` (written by hand; uses a tagged
  "failure" outcome from the transaction).
* **C1** — `part-c/c1-ai-implemented/discount.ts` (AI; uses a `LimitReached`
  exception).

Harness: `part-c/c3-compare/harness.ts`. It drives both against one shared
in-memory store (same rules, same planted redemptions) and compares normalized
results (`ok`, failure `code`, `details`, and the success money fields). Failure
**message text** is ignored because the pseudocode never fixed it.

Run: `node harness.ts`

## Inputs and results

The 7 already-traced inputs plus 10 new ones (8–17), plus a concurrent case.

| # | Input | B2 | C1 | Agree |
|---|-------|----|----|-------|
| 1 | valid percent (4000, SPRING10) | ok 400/3600 | ok 400/3600 | yes |
| 2 | expired | code_expired | code_expired | yes |
| 3 | already used (u1) | already_used {limit:1} | already_used {limit:1} | yes |
| 4 | negative quantity | invalid_cart quantity | invalid_cart quantity | yes |
| 5 | below minimum | min_spend_not_met {shortfall:2000} | min_spend_not_met {shortfall:2000} | yes |
| 6 | unknown code | code_not_found | code_not_found | yes |
| 7 | fixed larger than subtotal | ok 500/0 | ok 500/0 | yes |
| 8 | zero quantity | invalid_cart quantity | invalid_cart quantity | yes |
| 9 | mixed currency cart | invalid_cart mixed_currency | invalid_cart mixed_currency | yes |
| 10 | not started | code_not_started | code_not_started | yes |
| 11 | total cap reached | code_exhausted | code_exhausted | yes |
| 12 | fixed code, EUR cart | currency_mismatch {USD/EUR} | currency_mismatch {USD/EUR} | yes |
| 13 | percent rounding (3333) | ok 333/3000 | ok 333/3000 | yes |
| 14 | inactive code | code_not_found | code_not_found | yes |
| 15 | empty cart | empty_cart | empty_cart | yes |
| 16 | multi-use second time (max 2) | ok 100/900 | ok 100/900 | yes |
| 17 | not authenticated | not_authenticated | not_authenticated | yes |
| 18 | concurrent double-submit, one-use code | one ok + already_used {limit:1} | one ok + already_used (no details) | **NO** |

17 of 18 agree. One disagreement at input 18.

## The disagreement

Same result code (`already_used`) and same overall outcome (one request wins, one
loses), but the **failure `details` differ**:

* B2: `{ "code": "already_used", "details": { "limit": 1 } }`
* C1: `{ "code": "already_used", "details": null }`

The disagreement only appears on the **transaction re-check** path. In the
sequential case (input 3) both return `{limit:1}` from the pre-transaction check,
so the missing detail is hidden until a race forces the Stage 10 check.

## Which one is wrong, by tracing the pseudocode

B1 pseudocode, Stage 10:

```
// Re-check per-customer inside the transaction to close the race.
SET customerUses = database.countRedemptionsForUpdate(rule.id, userId)
IF customerUses >= rule.maxRedemptionsPerCustomer:
  ROLLBACK
  RETURN failure(already_used, { limit: rule.maxRedemptionsPerCustomer })
```

The pseudocode explicitly passes `{ limit: rule.maxRedemptionsPerCustomer }` on the
**in-transaction** `already_used` branch.

* **B2 is correct.** Its in-transaction branch builds
  `failure("already_used", ..., { limit: rule.maxRedemptionsPerCustomer })`.
* **C1 is wrong.** It throws `LimitReached("already_used")` and the catch returns
  `failure(error.code, <message>)` with **no `details`**. It dropped the `limit`
  payload specified by the pseudocode.

## Why it happened

C1 replaced the pseudocode's inline `ROLLBACK; RETURN failure(code, details)` with
an exception (`LimitReached`) that carries only the code. The message and the
`details` had to be rebuilt in the catch, and the `limit` value was not carried on
the exception. The result code stayed right, so the defect is limited to the
`details` field of that one branch.

## Recorded finding

* 17/18 inputs agree.
* 1 disagreement (concurrent double-submit): B2 matches the pseudocode; C1 omits
  `details.limit` on the in-transaction `already_used` failure.
* The concurrent test also confirms the intended race behavior: exactly one
  redemption is written and the other request is rejected with `already_used` —
  in both implementations.
