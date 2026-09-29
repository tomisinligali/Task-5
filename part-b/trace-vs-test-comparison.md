# B2 — Trace vs. Test Comparison

The B1 pseudocode was hand-traced first. The B2 implementation was then run
against those same inputs. This table records the hand-trace expectation beside
the observed test result.

Run: `cd part-b/implementation && node traces.ts`
Test file: `part-b/implementation/traces.ts`
Code: `part-b/implementation/discount.ts`

Money is in minor units (cents). Rules used: `SPRING10` = 10%, min 3000, expires
2026-12-31, one per customer; `FIVEOFF` = 1000 fixed, USD, one per customer.

| # | Input | Hand-trace expectation (B1) | Test result (B2) | Match |
|---|-------|-----------------------------|------------------|-------|
| 1 | cart 2 × 2000, `" spring10 "`, 2026-06-01 | `ok`, discount 400, total 3600 | `ok`, discount 400, total 3600 | yes |
| 2 | same cart, `SPRING10`, 2027-01-01 | `code_expired` | `code_expired` | yes |
| 3 | same cart, `SPRING10`, customer already redeemed | `already_used` {limit:1} | `already_used` {limit:1} | yes |
| 4 | cart 1 × 2000 qty `-1`, `SPRING10` | `invalid_cart` {reason:"quantity"} | `invalid_cart` {reason:"quantity"} | yes |
| 5 | cart 1 × 1000, `SPRING10` | `min_spend_not_met` {shortfall:2000} | `min_spend_not_met` {shortfall:2000} | yes |
| 6 | valid cart, `NOPE` | `code_not_found` | `code_not_found` | yes |
| 7 | cart 1 × 500, `FIVEOFF` | `ok`, discount 500, total 0 (capped) | `ok`, discount 500, total 0 (capped) | yes |

Result: **7 / 7 match.** No discrepancies between the hand trace and the test.

The B1 step asked for at least five traced inputs; seven were traced and all seven
were executed, covering the awkward cases (expired, reused, negative quantity)
plus below-minimum, unknown, and the over-subtotal cap.
