# Function 3 — compare

## Source

* Package: `bcryptjs` `3.0.3`
* Implementation: `node_modules/bcryptjs/index.js:246-288`
* Project dependency: `freelancer-hub-authorization/package.json:22` → `"bcryptjs": "^3.0.3"`
* Project usage: `await bcrypt.compare(password, user.passwordHash)` at
  `src/server/actions/auth/reactivate-account.ts:33` and `src/lib/auth/auth.ts:100`.
* Difficulty: High.

---

## First-Pass Pseudocode (candidate-authored — verbatim, unmodified)

Provenance: authored by the candidate in `part-a/a2/function-3-compare.md`.
The AI has **not** written, rewritten, improved, reordered, or edited this text.
It is reproduced here exactly as the candidate wrote it, and the AI explanation
is added only below it.

FUNCTION compare

INPUTS:

* password: the value to compare
* hash: the bcrypt hash to compare against
* callback: function that receives the result
* progressCallback: optional function that receives progress updates

OUTPUT:

* Asynchronously provides whether the password matches the hash
* When using the Promise form, resolves with true or false

SIDE EFFECTS:

* Performs asynchronous bcrypt hashing/comparison work
* May call the progress callback while processing

FAILS WHEN:

* The callback is invalid when the callback-based form is used
* The password or hash is not a string

1. Check whether the callback is a valid function when the callback-based form is being used.
2. IF the callback is invalid:

   * Stop execution.
   * Throw an error.
3. Check whether password and hash are valid strings.
4. IF either value is invalid:

   * Report an argument error through the callback.
   * Stop execution.
5. Extract the salt portion from the supplied hash.
6. Start the password hashing operation using the extracted salt.
7. Perform the hashing asynchronously.
8. IF a progress callback was provided:

   * Report the progress of the hashing operation as processing continues.
9. When hashing finishes:

   * Compare the newly generated hash with the original hash.
10. Produce true if the values match.
11. Produce false if the values do not match.
12. Return the comparison result through the callback or Promise.

---

## AI Explanation (second stage)

`compare` asynchronously tests a plaintext password against a stored bcrypt
hash. With no callback it returns a Promise; with a callback it returns
`undefined` and reports through the callback. The sequence is:

1. If a callback was supplied and is not a function, throw synchronously
   (`Illegal callback: …`).
2. If `password` or `hashValue` is not a string, deliver an argument error via
   the callback (or reject the Promise).
3. **If `hashValue.length !== 60`, resolve `false` immediately and do not hash.**
4. Otherwise, re-hash the password using the salt sliced from the first 29
   characters of the hash (`hashValue.substring(0, 29)`), invoking
   `progressCallback` during the work.
5. Compare the recomputed hash with the stored hash using `safeStringCompare`, a
   constant-time comparison.
6. Return `true`/`false` through the callback or Promise; a hashing error is
   passed through as an error.

---

## Differences (first pass vs AI)

### Difference 1 — Missing length guard (most significant)

* Candidate (steps 5-7): after the string check, it always "extract[s] the salt
  portion" and "start[s] the password hashing operation".
* AI: there is an explicit short-circuit when the hash length is not 60; the
  function resolves `false` and performs **no hashing**.

Source evidence: `index.js:259-262`:
`if (hashValue.length !== 60) { nextTick(callback.bind(this, null, false)); return; }`.
This runs before the `hash(...)` call at `index.js:263`. Runtime check:
`compare("x", "short")` resolves `false` with no hashing. The candidate's model
does not contain this branch, so for a wrong-length hash its description is
incomplete/incorrect.

**Verdict: AI correct; candidate first-pass incomplete** (omits a real branch).

### Difference 2 — Error delivery channel

* Candidate (step 4): a non-string argument is reported "through the callback".
* AI: the error is delivered through the callback **or**, when no callback was
  given, by rejecting the Promise.

Source evidence: `index.js:248-258` schedules
`callback.bind(this, Error(...))`, and the outer `if (callback) … else return new Promise`
at `index.js:274-287` means the no-callback path rejects. The candidate's OUTPUT
section acknowledges the Promise form, but step 4 names only the callback.

**Verdict: AI correct; candidate first-pass imprecise** (minor, internally
inconsistent with its own OUTPUT section).

### Non-differences (omissions, not disagreements)

* The candidate describes the comparison generally (step 9); it does not name
  `safeStringCompare` or constant-time comparison. Missing detail, not a
  contradiction.
* The candidate does not state the exact 29-character slice. Missing detail.

---

## Source-Code Verification

All references are `node_modules/bcryptjs/index.js` (bcryptjs 3.0.3).

1. Argument type error path — lines 248-258.
2. Length short-circuit — lines 259-262.
3. Salt slice — line 265: `hash(password, hashValue.substring(0, 29), …)`.
4. Result comparison — line 268: `safeStringCompare(comp, hashValue)`.
5. `safeStringCompare` constant-time — lines 211-217.
6. Callback validation and Promise fallback — lines 274-287.
7. Related sync twin `compareSync` (same 60-length guard, 29-char salt) —
   lines 226-234.
8. Runtime: `compare(correct, validHash)` → `true`; `compare(wrong, validHash)`
   → `false`; `compare("x", "short")` → `false`; `compare(123, validHash)` →
   rejects `Illegal arguments: number, string`.

---

## Final Determination

The candidate's first-pass pseudocode was **partially correct**: the inputs,
output, callback validation, general hashing flow, and final true/false result
are right. It is **incorrect/incomplete** on the `hashValue.length !== 60`
short-circuit and imprecise on the error channel. The AI explanation matched the
source on every checked point, so **no AI error was found** in this function.

---

## Hand Trace (verification, added)

Runtime: `node` against installed `bcryptjs` 3.0.3. `compare` is asynchronous;
both the Promise form and the callback form are traced.

### Test 1 — Normal (match)

Inputs: `password = "s3cret"`, `hash` = a 60-char hash of `"s3cret"`.

Hand trace (`index.js:246-288`):

1. No callback supplied → Promise form.
2. `typeof password` / `hash` both string → no argument error.
3. `hash.length === 60` → no short-circuit.
4. Re-hash `"s3cret"` using `hash.substring(0, 29)` as the salt.
5. `safeStringCompare(recomputed, hash)` → equal.
6. Resolve `true`.

Expected: `true`.
Real: `compare("s3cret", good) => true`. Match: **yes.**

### Test 2 — Edge (mismatch and wrong-length hash)

* `password = "wrong"` → recomputed differs → resolve `false`.
  Real: `compare("wrong", good) => false`. Match.
* `password = "x"`, `hash = "short"` → `hash.length !== 60` →
  `nextTick(callback.bind(this, null, false))` → resolve `false` **without
  hashing**. Real: `compare("x", "short") => false`. Match.

### Test 3 — Invalid input

* `compare(123, good)` → no callback → Promise form; non-string argument →
  reject `Illegal arguments: number, string`.
  Real: `REJECTED Error: Illegal arguments: number, string`. Match.
* `compare("s3cret", good, "notfn")` → callback supplied and not a function →
  throw synchronously `Illegal callback: string`.
  Real: `THREW Error: Illegal callback: string`. Match.

### Comparison Summary

| Test | Expected | Real | Match |
| ---- | -------- | ---- | ----- |
| correct password | `true` | `true` | yes |
| wrong password | `false` | `false` | yes |
| `"x"` vs `"short"` | `false` (no hashing) | `false` | yes |
| `123` | rejects | rejects | yes |
| bad callback | throws sync | throws sync | yes |

### Correction

The trace confirms Difference 1: the `hashValue.length !== 60` short-circuit
resolves `false` without hashing; the first pass should add that guard between
its steps 4 and 5. Error delivery (Difference 2) is via the callback **or** a
Promise rejection; the first pass should say both. Execution matches the AI
explanation.
