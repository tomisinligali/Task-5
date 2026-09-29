# resolvePayment — Hand Trace

## Test 1 — Normal

### Inputs
- `userId`: valid existing user
- `txRef`: valid existing checkout reference
- `transactionId`: valid numeric transaction ID
- `rawReturnParams`: valid return parameters
- `source`: valid payment source

### Preconditions
- Checkout exists and is not completed.
- Provider returns a successful payment.
- Verified amount and currency match the checkout.

### Expected result
`COMPLETED`

### Hand Trace

| Step | What happens | Result |
|---|---|---|
| 1 | Read payment source and create user-scoped database client | Continues |
| 2 | Reconcile existing subscription | Continues |
| 3 | Find checkout using `txRef` | Checkout found |
| 4 | Check whether checkout is already completed | Not completed |
| 5 | Validate `transactionId` and record verification request | Valid ID accepted |
| 6 | Verify payment with provider | Successful |
| 7 | Record verified payment details | Recorded |
| 8 | Check provider status | `SUCCESSFUL` |
| 9 | Check amount and currency | Match |
| 10 | Determine plan and subscription period | Determined |
| 11 | Apply payment in database transaction | User/subscription/checkout updated |
| 12 | Record successful subscription event | Recorded |
| 13 | Record final successful payment state | Recorded |
| 14 | Return result | `COMPLETED` |

---

## Test 2 — Edge Case

### Inputs
- `userId`: valid existing user
- `txRef`: valid existing checkout reference
- `transactionId`: missing
- `rawReturnParams`: valid return parameters
- `source`: valid payment source

### Preconditions
- Checkout exists and is not completed.
- Provider can verify the payment using `txRef`.

### Expected result
Payment verification proceeds without a transaction ID.

### Hand Trace

| Step | What happens | Result |
|---|---|---|
| 1 | Read payment source and create user-scoped database client | Continues |
| 2 | Reconcile existing subscription | Continues |
| 3 | Find checkout using `txRef` | Checkout found |
| 4 | Check whether checkout is already completed | Not completed |
| 5 | Validate `transactionId` | Missing, so no transaction ID is sent |
| 6 | Verify payment with provider | Verification uses `txRef` |
| 7 | Continue based on provider response | Depends on provider result |

---

## Test 3 — Invalid

### Inputs
- `userId`: valid existing user
- `txRef`: does not match any checkout
- `transactionId`: valid numeric transaction ID
- `rawReturnParams`: valid return parameters
- `source`: valid payment source

### Preconditions
- No checkout exists for the supplied `txRef`.

### Expected result
`NOT_FOUND`

### Hand Trace

| Step | What happens | Result |
|---|---|---|
| 1 | Read payment source and create user-scoped database client | Continues |
| 2 | Reconcile existing subscription | Continues |
| 3 | Find checkout using `txRef` | No checkout found |
| 4 | Record failed provider-return log | Recorded |
| 5 | Return result | `NOT_FOUND` |
| 6 | Stop processing | No provider verification |
## Real Code Results

### Test 1 — Normal

**Actual result:** `COMPLETED`

**Match:** Yes

**What happened:**
- The numeric transaction ID was accepted.
- The provider was called with the `txRef` and transaction ID.
- The payment was verified successfully.
- The amount and currency matched.
- The user plan was updated to MONTHLY.
- The subscription became ACTIVE.
- The checkout became COMPLETED.
- The payment event and final state log were created.

**Discrepancy:** None.

---

### Test 2 — Edge Case

**Actual result:** `COMPLETED`

**Match:** Yes

**What happened:**
- The missing transaction ID became `undefined`.
- The provider was called with the `txRef` and no transaction ID.
- The provider successfully verified the payment using the reference.
- The amount and currency matched.
- The user plan, subscription, and checkout were updated.
- The result was `COMPLETED`.

**Discrepancy:** None functionally. The provider received `undefined` for the transaction ID, while the database stored `null`.

---

### Test 3 — Invalid

**Actual result:** `NOT_FOUND`

**Match:** Yes

**What happened:**
- No checkout existed for the supplied `txRef`.
- A failed `PROVIDER_RETURN` log was created.
- The function returned `NOT_FOUND`.
- The payment provider was not called.
- No checkout, subscription, or subscription event was modified.

**Discrepancy:** None.

---

## Comparison Summary

| Test | Expected | Actual | Match? | Discrepancy |
|---|---|---|---|---|
| Normal | `COMPLETED` | `COMPLETED` | Yes | None |
| Edge case | Verification continues without transaction ID | `COMPLETED` | Yes | None functionally |
| Invalid | `NOT_FOUND` | `NOT_FOUND` | Yes | None |

## Correction

No correction was required. The hand-traced pseudocode accurately represented the behavior of the real `resolvePayment` function for all three tested inputs.