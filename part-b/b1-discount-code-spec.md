# B1 — Specify Before Building: Apply a Discount Code

Feature: a customer applies a discount code at checkout. The code has rules for
expiry, minimum spend, one-use-per-customer, an optional total cap, and a
percentage or fixed-amount value.

This document is specification + pseudocode + hand traces only. No code yet.

## 1. Design overview

### Money and time

* All money is handled in **minor units** (e.g. cents) as integers to avoid
  floating-point rounding. No floating-point math is used anywhere.
* `nowUtc` is passed in as an input so behavior is deterministic and testable.
* Currency is a 3-letter code (e.g. `USD`).

### Data model (conceptual)

* **DiscountCode**
  * `id`
  * `code` (unique, stored normalized, e.g. uppercase)
  * `kind`: `PERCENT` | `FIXED`
  * `value`: for `PERCENT`, integer 1..100; for `FIXED`, integer minor units
  * `currency`: required for `FIXED`, ignored for `PERCENT`
  * `minSubtotal`: integer minor units (0 = no minimum)
  * `expiresAtUtc`: timestamp or null (null = never expires)
  * `startsAtUtc`: timestamp or null (null = already started)
  * `active`: boolean
  * `maxRedemptionsTotal`: integer or null (null = unlimited)
  * `maxRedemptionsPerCustomer`: integer >= 1 (default 1)
* **DiscountRedemption**
  * `id`
  * `codeId`, `userId`, `orderId`
  * `discountAmount`, `subtotal`, `currency`
  * `redeemedAtUtc`
  * Unique constraint on (`codeId`, `userId`) when per-customer limit is 1;
    in general the per-customer count is re-checked inside the same
    transaction that writes the redemption.

### Function under specification

`applyDiscountCode(userId, cart, codeInput, nowUtc, orderId)` — computes a
discount for a cart, or returns a typed failure. It does not create the order;
it prepares the discount and records a redemption when successful.

### Success return

`{ ok: true, code, subtotal, discountAmount, total, currency, redemptionId }`

### Failure return

`{ ok: false, code: <failure code>, message, details? }`

Failure codes (never throw for expected business failures):

* `not_authenticated`
* `empty_cart`
* `invalid_cart` (quantity not an integer >= 1, or unit price < 0, or mixed currencies)
* `code_required`
* `code_not_found` (unknown or inactive — generic, to avoid code enumeration)
* `code_not_started`
* `code_expired`
* `min_spend_not_met` (includes `shortfall`)
* `currency_mismatch` (fixed code currency differs from cart currency)
* `already_used` (per-customer limit reached)
* `code_exhausted` (total redemption cap reached)
* `duplicate_redemption` (unique-constraint race lost)

## 2. Pseudocode

```
FUNCTION applyDiscountCode(userId, cart, codeInput, nowUtc, orderId)

  // ---- Stage 0: identity ----
  IF userId is null/empty:
    RETURN failure(not_authenticated)

  // ---- Stage 1: validate cart ----
  IF cart is null OR cart has 0 line items:
    RETURN failure(empty_cart)

  SET currency = null
  SET subtotal = 0

  FOR each line IN cart:
    IF line.quantity is not an integer OR line.quantity < 1:
      RETURN failure(invalid_cart, { reason: "quantity", productId: line.productId })
    IF line.unitPrice is not an integer OR line.unitPrice < 0:
      RETURN failure(invalid_cart, { reason: "unitPrice", productId: line.productId })

    IF currency is null:
      SET currency = line.currency
    ELSE IF currency != line.currency:
      RETURN failure(invalid_cart, { reason: "mixed_currency" })

    SET subtotal = subtotal + (line.unitPrice * line.quantity)
  END FOR

  // ---- Stage 2: validate code input ----
  SET normalized = trim(codeInput)
  SET normalized = uppercase(normalized)

  IF normalized is empty:
    RETURN failure(code_required)

  // ---- Stage 3: load the code ----
  SET rule = database.findDiscountCode(normalized)   // lookup by normalized code

  IF rule is null OR rule.active is false:
    RETURN failure(code_not_found)                   // generic message

  // ---- Stage 4: time window ----
  IF rule.startsAtUtc is not null AND nowUtc < rule.startsAtUtc:
    RETURN failure(code_not_started)

  IF rule.expiresAtUtc is not null AND nowUtc > rule.expiresAtUtc:
    RETURN failure(code_expired)

  // ---- Stage 5: minimum spend ----
  IF subtotal < rule.minSubtotal:
    RETURN failure(min_spend_not_met, { shortfall: rule.minSubtotal - subtotal })

  // ---- Stage 6: currency compatibility (fixed only) ----
  IF rule.kind == FIXED AND rule.currency != currency:
    RETURN failure(currency_mismatch, { expected: rule.currency, actual: currency })

  // ---- Stage 7: per-customer limit ----
  SET customerUses = database.countRedemptions(rule.id, userId)
  IF customerUses >= rule.maxRedemptionsPerCustomer:
    RETURN failure(already_used, { limit: rule.maxRedemptionsPerCustomer })

  // ---- Stage 8: total cap ----
  IF rule.maxRedemptionsTotal is not null:
    SET totalUses = database.countRedemptionsForCode(rule.id)
    IF totalUses >= rule.maxRedemptionsTotal:
      RETURN failure(code_exhausted)

  // ---- Stage 9: compute the discount ----
  IF rule.kind == PERCENT:
    SET rawDiscount = floor(subtotal * rule.value / 100)
  ELSE IF rule.kind == FIXED:
    SET rawDiscount = rule.value
  ELSE:
    RETURN failure(code_not_found)                   // defensive: corrupt kind

  // Discount can never exceed the subtotal.
  SET discountAmount = min(rawDiscount, subtotal)
  SET total = subtotal - discountAmount
  // total is guaranteed >= 0

  // ---- Stage 10: record the redemption (atomic with the order later) ----
  BEGIN TRANSACTION
    // Re-check per-customer inside the transaction to close the race.
    SET customerUses = database.countRedemptionsForUpdate(rule.id, userId)
    IF customerUses >= rule.maxRedemptionsPerCustomer:
      ROLLBACK
      RETURN failure(already_used, { limit: rule.maxRedemptionsPerCustomer })

    IF rule.maxRedemptionsTotal is not null:
      SET totalUses = database.countRedemptionsForCodeForUpdate(rule.id)
      IF totalUses >= rule.maxRedemptionsTotal:
        ROLLBACK
        RETURN failure(code_exhausted)

    TRY:
      SET redemption = database.insertRedemption({
        codeId: rule.id,
        userId: userId,
        orderId: orderId,
        discountAmount: discountAmount,
        subtotal: subtotal,
        currency: currency,
        redeemedAtUtc: nowUtc
      })
    CATCH unique_violation:
      ROLLBACK
      RETURN failure(duplicate_redemption)

    COMMIT
  END TRANSACTION

  RETURN success({
    code: rule.code,
    subtotal: subtotal,
    discountAmount: discountAmount,
    total: total,
    currency: currency,
    redemptionId: redemption.id
  })

END FUNCTION
```

### Invariants

* `discountAmount <= subtotal` always, so `total >= 0`.
* `total = subtotal - discountAmount`.
* A redemption is written only on the success path, and only once per
  (code, customer) within the per-customer limit.
* Expected business failures return typed failures; no exceptions escape.
* The per-customer and total-cap checks are repeated inside the transaction so
  concurrent requests cannot both redeem past the limit.

## 3. Hand traces

Currency `USD`, money in minor units.

### Trace 1 — Valid percentage code

* Input: `userId = u1`, cart = `[{ productId: p1, unitPrice: 2000, quantity: 2, currency: USD }]`,
  `codeInput = " spring10 "`, `nowUtc = 2026-06-01`, `orderId = o1`.
* Rule: `SPRING10`, PERCENT 10, minSubtotal 3000, expires 2026-12-31, max/customer 1.
* Steps: cart valid → subtotal = 4000 → normalized `SPRING10` → found/active →
  within time → 4000 >= 3000 → percent → raw = floor(4000*10/100)=400 →
  discount 400 → total 3600 → insert redemption succeeds.
* Result: `ok:true, discountAmount:400, total:3600`.

### Trace 2 — Expired code (awkward)

* Input: valid cart subtotal 4000, `codeInput = "SPRING10"`,
  `nowUtc = 2027-01-01`, rule expires 2026-12-31.
* Steps: cart valid → code found/active → start ok → `nowUtc > expiresAtUtc`.
* Result: `ok:false, code: code_expired`. No redemption written.

### Trace 3 — Code used twice by the same customer (awkward)

* Input: `userId = u1`, valid cart subtotal 4000, `codeInput = "SPRING10"`,
  rule max/customer = 1, and `database.countRedemptions(rule.id, u1) = 1`.
* Steps: all checks pass until per-customer limit → `1 >= 1`.
* Result: `ok:false, code: already_used, details:{ limit:1 }`. No redemption written.

### Trace 4 — Negative quantity (awkward)

* Input: cart = `[{ productId: p1, unitPrice: 2000, quantity: -1, currency: USD }]`,
  `codeInput = "SPRING10"`.
* Steps: first line quantity is not >= 1 → fail before any code lookup.
* Result: `ok:false, code: invalid_cart, details:{ reason:"quantity", productId:p1 }`.
  Note: no database read of the code happens.

### Trace 5 — Subtotal below minimum spend

* Input: cart subtotal 1000, `codeInput = "SPRING10"`, rule minSubtotal = 3000.
* Steps: cart valid → code found → time ok → `1000 < 3000`.
* Result: `ok:false, code: min_spend_not_met, details:{ shortfall:2000 }`.

### Trace 6 — Unknown / inactive code

* Input: valid cart, `codeInput = "NOPE"`, no such code (or `active = false`).
* Steps: normalize → lookup returns null/inactive.
* Result: `ok:false, code: code_not_found` (same generic message for both cases).

### Trace 7 — Fixed discount larger than subtotal (cap)

* Input: cart subtotal 500, `codeInput = "FIVEOFF"`, rule FIXED 1000, currency USD.
* Steps: currency matches → rawDiscount = 1000 → `discountAmount = min(1000, 500) = 500`
  → `total = 0` → redemption inserted.
* Result: `ok:true, discountAmount:500, total:0`. Never negative.

## 4. Awkward-input coverage checklist

* Expired code → Trace 2.
* Code used twice by same customer → Trace 3.
* Negative quantity → Trace 4.
* Below minimum spend → Trace 5.
* Unknown/inactive code → Trace 6.
* Fixed discount exceeding subtotal → Trace 7.
* Concurrent double redemption → handled by the in-transaction re-check and the
  `duplicate_redemption` failure.
