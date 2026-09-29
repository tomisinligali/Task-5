# A3 — Hand Trace (planted-bug pair)

Method: this route depends on the full Next.js request pipeline, Prisma, and
several `@/lib` modules, and the planted-bug source is not part of any runnable
project in this repository. The trace is therefore a **source trace**: it walks
the actual pseudocode (`actual-behavior.md`) and the intended pseudocode
(`intended-behavior.md`) over the same inputs and shows exactly where the cookie
value diverges. The bug is a single wrong argument, so it needs no runtime to
observe.

## Test 1 — Valid signup

Inputs: valid body; `signupSchema` passes; email not already registered.

Actual trace (`actual-behavior.md`):

1. Rate limit ok, idempotency key ok, body parsed and validated.
2. `handleSignup` hashes the password and generates **two different values**:
   `verificationToken` (`generateVerificationCode`) and `sessionToken`
   (`generateSecureToken`).
3. `createAccountAtomically` commits one transaction: inserts `User`; inserts
   `Session` with `token = sessionToken`; inserts `EmailJob` with
   `token = verificationToken`.
4. `processEmailJobs()` runs, then
   `buildSignupSuccessResponse(user, verificationToken)` is called.
5. Inside the builder, the session cookie is set to the value passed as the
   second argument — the `verificationToken`.

Result: cookie value = `verificationToken`. The `Session` row holds
`sessionToken`. A later request presenting the cookie cannot match the session,
so the new user is not actually authenticated, and the verification code is
exposed in a cookie.

Intended trace (`intended-behavior.md`): steps 1–4 are identical, but the call is
`buildSignupSuccessResponse(user, sessionToken)`, so the cookie equals the
`Session` row's token and the login is valid.

Difference: only the second argument to `buildSignupSuccessResponse`
(`verificationToken` instead of `sessionToken`).

## Test 2 — Duplicate email

Inputs: valid body, email already registered. `createAccountAtomically` retries
once on `P2002`, the retry also fails, and `handleSignup`'s catch returns `409`.
No cookie is set. Actual and intended are identical; no divergence.

## Test 3 — Invalid body

Inputs: `body = null`. `handleSignup` returns `400` "Invalid JSON body"; no
database write and no cookie. Actual and intended are identical.

## Test 4 — Rate limited

Rate limit not ok → `429` early return; no database work and no cookie. Actual
and intended are identical.

## Summary

| Test | Actual | Intended | Divergence |
| ---- | ------ | -------- | ---------- |
| Valid signup | cookie = verification token | cookie = session token | **yes** |
| Duplicate email | `409` | `409` | no |
| Invalid body | `400` | `400` | no |
| Rate limited | `429` | `429` | no |

The only divergence is Test 1, matching `bug-analysis.md`: the wrong token is
passed to the response builder, so the session cookie does not match the stored
session. The two-pseudocode method localises the bug to a single argument with no
runtime required.
