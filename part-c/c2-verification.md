# C2 — Verify Line by Line

Comparison of the original B1 pseudocode against the reverse-engineered pseudocode
written only from the C1 AI code (`part-c/c1-ai-implemented/discount.ts`).

## Part 1 — Reverse-engineered pseudocode (from the C1 code alone)

FUNCTION: `applyDiscountCode` (the inner function returned by `createApplyDiscountCode(database)`)

INPUTS:

* `userId`: string
* `cart`: CartLine[]
* `codeInput`: string
* `nowUtc`: Date
* `orderId`: string
* (captured) `database`: a handle exposing `findDiscountCode`, `countRedemptions`,
  `countRedemptionsForCode`, `runInTransaction`, `isUniqueViolation`

OUTPUT: `Promise<Success | Failure>`

STEPS:

1. IF `userId` is falsy → Failure(`not_authenticated`).
2. IF `cart` is falsy or empty → Failure(`empty_cart`).
3. currency = null; subtotal = 0.
4. FOR each line in cart:
   * IF quantity is not an integer or < 1 → Failure(`invalid_cart`, {reason: "quantity", productId}).
   * IF unitPrice is not an integer or < 0 → Failure(`invalid_cart`, {reason: "unitPrice", productId}).
   * IF currency is null → currency = line.currency; ELSE IF differs → Failure(`invalid_cart`, {reason: "mixed_currency"}).
   * subtotal += unitPrice * quantity.
5. cartCurrency = currency.
6. normalized = `codeInput.trim().toUpperCase()`; IF empty → Failure(`code_required`).
7. rule = `database.findDiscountCode(normalized)`; IF null or `active === false` → Failure(`code_not_found`).
8. IF `startsAtUtc !== null` and `nowUtc < startsAtUtc` → Failure(`code_not_started`).
9. IF `expiresAtUtc !== null` and `nowUtc > expiresAtUtc` → Failure(`code_expired`).
10. IF subtotal < `minSubtotal` → Failure(`min_spend_not_met`, {shortfall}).
11. IF kind is FIXED and `rule.currency !== cartCurrency` → Failure(`currency_mismatch`, {expected, actual}).
12. customerUses = `database.countRedemptions(rule.id, userId)`; IF `>= maxRedemptionsPerCustomer` → Failure(`already_used`, {limit}).
13. IF `maxRedemptionsTotal !== null`: totalUses = `database.countRedemptionsForCode(rule.id)`; IF `>= maxRedemptionsTotal` → Failure(`code_exhausted`).
14. rawDiscount = PERCENT ? `floor(subtotal * value / 100)` : FIXED ? `value` : return Failure(`code_not_found`).
15. discountAmount = `min(rawDiscount, subtotal)`; total = subtotal - discountAmount.
16. TRY:
    * `redemption = database.runInTransaction(async (tx) => {`
      * uses = `tx.countRedemptionsForUpdate(rule.id, userId)`; IF `>= maxPerCustomer` → THROW `LimitReached("already_used")`.
      * IF `maxRedemptionsTotal !== null`: used = `tx.countRedemptionsForCodeForUpdate(rule.id)`; IF `>= maxRedemptionsTotal` → THROW `LimitReached("code_exhausted")`.
      * RETURN `tx.insertRedemption({codeId, userId, orderId, discountAmount, subtotal, currency, redeemedAtUtc})`.
    * `})`
    * RETURN Success(`{code, subtotal, discountAmount, total, currency, redemptionId: redemption.id}`).
17. CATCH error:
    * IF `error instanceof LimitReached` → Failure(`error.code`, <message chosen by code>).
    * ELSE IF `database.isUniqueViolation(error)` → Failure(`duplicate_redemption`).
    * ELSE THROW error (re-raise).

## Part 2 — Difference table

| # | Area | Original pseudocode | C1 code (reverse-engineered) | Difference type | Verdict / action |
|---|------|---------------------|------------------------------|-----------------|------------------|
| 1 | How the DB is supplied | Free function calls `database.*` (no source stated) | `createApplyDiscountCode(database)` factory; DB captured in closure | Interpreted differently | Ambiguity. Fix pseudocode: state the DB handle is injected. |
| 2 | Stage 10 limit branches | `ROLLBACK; RETURN failure(...)` written inline | `throw new LimitReached(code)`, caught outside `runInTransaction` | Added (mechanism) | Welcome; same observable behavior. Keep. |
| 3 | Stage 10 other errors | Only `CATCH unique_violation` stated | Explicit `else { throw error }` | Added | Welcome; makes the unstated default explicit. |
| 4 | Failure message text | `failure(code, message)` — text unspecified | Hard-coded English strings per failure | Added | Welcome/necessary; text was never specified. |
| 5 | `failure()` helper | Implied by `RETURN failure(...)` | Local helper that omits `details` when absent | Added (mechanism) | Welcome; no behavior change. |
| 6 | Type/interface declarations | Not specified | `CartLine`, `DiscountRule`, `Database`, `Transaction`, etc. | Added (non-behavioral) | Welcome scaffolding; no behavior. |
| 7 | Type widening | "currency is definitely set" | `currency as string` cast | Interpreted differently | Non-behavioral; both rely on the non-empty cart. |
| 8 | Stages 0–9 checks | As written | Matched 1:1 (order, conditions, codes, details) | — | No difference. |
| 9 | Stage 10 re-check | per-customer then total cap, inside transaction | Same order and conditions | — | No difference. |
| 10 | Success/failure shape | `{ok, code, subtotal, discountAmount, total, currency, redemptionId}` / `{ok:false, code, message, details?}` | Identical | — | No difference. |

## Part 3 — Omissions found

None. Every failure code, branch, ordering rule, and returned field in the original
pseudocode appears in the C1 code. No defect of omission.

## Part 4 — Ambiguities in the original pseudocode and fixes

1. **Database source was unspecified.** The pseudocode wrote `database.findDiscountCode(...)`
   without saying where `database` comes from. The AI chose constructor/factory injection.
   Fix: add an input line "`database`: handle exposing the read/redeem methods" or state it is
   a module-level import.
2. **Unhandled-error behavior inside Stage 10 was unspecified.** Only `CATCH unique_violation`
   was described, so the AI had to guess for other errors. Fix: add "Any other error
   propagates out of the function (is rethrown)."
3. **Failure message text was unspecified.** `failure(code, message)` never defined the text.
   Fix: mark message text as caller-facing and not fixed by the pseudocode, or list the strings.
4. **Input type guarantees were unspecified.** The pseudocode says "trim(codeInput)" without
   saying `codeInput` is always a string, and "FOR each line" without saying `cart` is an array.
   Fix: declare the input types so the guard behavior is unambiguous.

## Part 5 — Verdict

* Additions: 5 (all mechanical or unspecified text; welcome, none change behavior).
* Omissions: 0.
* Misinterpretations: 1 (DB injection, caused by an ambiguous pseudocode line).
* Net: the C1 implementation is behaviorally faithful to B1; the only real ambiguity is how the
  database dependency is supplied. The pseudocode should be tightened per Part 4.
