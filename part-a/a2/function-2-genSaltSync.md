# Function 2 — genSaltSync

## Source

* Package: `bcryptjs` `3.0.3`
* Implementation: `node_modules/bcryptjs/index.js:87-102`
* Project dependency: `freelancer-hub-authorization/package.json:22` → `"bcryptjs": "^3.0.3"`
* Project usage on the call path: `bcrypt.hash(password, 12)` at
  `src/server/actions/auth/reset-password.ts:49`, `signup.ts:95`,
  `src/server/services/auth-flows.ts:141`, `auth-flows.ts:493` → `hash` →
  `genSalt` → `genSaltSync`.
* Difficulty: Medium. Second function in increasing-difficulty order:
  short → medium → hard.

---

## First-Pass Pseudocode (candidate-authored — verbatim, unmodified)

Provenance: authored by the candidate in this file before any AI explanation.
The AI has **not** written, rewritten, improved, reordered, or edited this text.

FUNCTION genSaltSync

INPUTS:

* rounds: optional number specifying the bcrypt cost/rounds
* seed_length: optional value retained for compatibility

OUTPUT:

* A generated bcrypt salt string

SIDE EFFECTS:

* Requests random bytes from the available random-number source

FAILS WHEN:

* The rounds value is invalid or outside the supported range
* A required secure random source/fallback is unavailable

1. IF rounds was not provided:

   * Set rounds to the default value.
2. IF rounds is outside the supported bcrypt range:

   * Stop execution.
   * Throw an error.
3. Request the required random bytes from the available random source.
4. IF secure random bytes cannot be obtained:

   * Stop execution.
   * Throw an error.
5. Convert the random bytes into the bcrypt salt representation.
6. Build the salt using the bcrypt version, rounds value, and generated random data.
7. Return the generated salt.

---

## AI Explanation (second stage)

`genSaltSync` synchronously builds a bcrypt salt string from an optional cost
factor.

1. Apply the default: `rounds = rounds || 10`. Because `||` is used, `undefined`,
   `0`, and `NaN` all become `10`.
2. If `rounds` is not a number, throw
   `Error("Illegal arguments: " + typeof rounds + ", " + typeof seed_length)`.
3. **Clamp** `rounds`: `< 4` becomes `4`; `> 31` becomes `31`. Out-of-range
   numbers are corrected, not rejected.
4. Format: `"$2b$"`, a `"0"` pad only when `rounds < 10`, the two-digit cost,
   `"$"`, and 22 characters of bcrypt-base64 produced from 16 secure random bytes.
5. Return the 29-character salt.

`seed_length` is never used. `randomBytes` uses Web Crypto, else Node `crypto`,
else a configured fallback, and throws if none is available.

---

## Differences (first pass vs AI)

### Difference 1 — Out-of-range rounds: throw vs clamp

* Candidate (FAILS WHEN, step 2): a rounds value "outside the supported bcrypt
  range" stops execution and throws.
* AI: out-of-range values are **clamped** to `[4, 31]`; the function throws only
  for a non-number.

Source evidence: `index.js:93-94` (`if (rounds < 4) rounds = 4; else if (rounds > 31) rounds = 31;`)
performs silent clamping, with no `throw`. The only `throw` is the type check at
`index.js:89-92`. Runtime check: `genSaltSync(2)` returns a valid `$2b$04$…`
salt and `genSaltSync(40)` returns `$2b$31$…`; neither throws.

**Verdict: AI correct; candidate first-pass incorrect.**

### Difference 2 — Defaulting on falsy rounds

* Candidate (step 1): default is applied only when rounds "was not provided".
* AI: the `||` operator also defaults `0` and `NaN` to `10`.

Source evidence: `index.js:88` (`rounds = rounds || GENSALT_DEFAULT_LOG2_ROUNDS;`)
with `GENSALT_DEFAULT_LOG2_ROUNDS = 10` (`index.js:515`). A supplied `0` becomes
`10`, not `4` and not a thrown error.

**Verdict: AI correct; candidate first-pass incomplete** (and, combined with
Difference 1, misleading for the `0` input).

### Non-differences (omissions, not disagreements)

* The candidate does not mention the zero-padding branch (`rounds < 10`),
  `index.js:97`. This is missing detail, not a contradiction.
* The candidate does not name the base64 alphabet, `index.js:400`. Missing
  detail only.

---

## Source-Code Verification

All references are `node_modules/bcryptjs/index.js` (bcryptjs 3.0.3).

1. `rounds = rounds || GENSALT_DEFAULT_LOG2_ROUNDS;` — line 88.
2. `var GENSALT_DEFAULT_LOG2_ROUNDS = 10;` — line 515.
3. Type check throw — lines 89-92.
4. Clamp, no throw — lines 93-94.
5. `"$2b$"` and pad — lines 96-98.
6. 16 random bytes encoded bcrypt-base64 — line 100; `BCRYPT_SALT_LEN = 16` —
   line 508; `BASE64_CODE` — line 400; `base64_encode` — lines 425-453.
7. RNG fallback chain — lines 49-65.

---

## Final Determination

The candidate's first-pass pseudocode was **partially correct**: the inputs,
output, defaulting intent, random-byte side effect, and overall salt construction
are right, but its failure model is wrong. The function does **not** throw for an
out-of-range cost; it clamps. The AI explanation matched the source on every
point, including the clamp and the falsy-default behavior. No AI error was found
in this function.

---

## Hand Trace (verification, added)

Runtime: `node` against installed `bcryptjs` 3.0.3. The 22-character random tail
differs on every call; the `$2b$NN$` prefix is deterministic and is what the
trace verifies.

### Test 1 — Normal (default rounds)

Inputs: `rounds` omitted.

Hand trace (`index.js:87-102`):

1. `rounds = undefined || 10` → `10`.
2. `typeof 10` is `"number"` → no throw.
3. `10 < 4`? no. `10 > 31`? no. → unchanged.
4. `"$2b$"` + (`10 < 10`? no pad) + `"10"` + `"$"` + 22 chars.
5. Return `$2b$10$` + 22 random chars.

Expected: a string starting `$2b$10$`.
Real: `genSaltSync() => "$2b$10$GKfV5hRRMODZuQq.eiF5A."`. Match: **yes.**

### Test 2 — Edge (out-of-range and falsy)

* `rounds = 2` → `2 < 4` → clamped to `4`; pad (`4 < 10`) → `$2b$04$…`.
  Real: `genSaltSync(2) => "$2b$04$drB/L3oYTYPqJNZNgT4Vne"`. Match.
* `rounds = 40` → `40 > 31` → clamped to `31`; no pad → `$2b$31$…`.
  Real: `genSaltSync(40) => "$2b$31$sOHUP5lR.6DuhFy1niqtke"`. Match.
* `rounds = 0` → `0 || 10` → `10` → `$2b$10$…`.
  Real: `genSaltSync(0) => "$2b$10$ODHLuU2qcMWLJvxLskVXM."`. Match.
* `rounds = NaN` → `NaN || 10` → `10` → `$2b$10$…`.
  Real: `genSaltSync(NaN) => "$2b$10$8NN97SuuIsu9Ya51AUqI.."`. Match.

### Test 3 — Invalid input

Input: `rounds = "x"`.

Hand trace: `"x" || 10` → `"x"`; `typeof "x" !== "number"` → throw
`Illegal arguments: string, undefined`; stop.

Expected: throws.
Real: `genSaltSync("x") => THREW Error: Illegal arguments: string, undefined`.
Match: **yes.**

### Comparison Summary

| Test | Expected | Real | Match |
| ---- | -------- | ---- | ----- |
| omitted | `$2b$10$…` | `$2b$10$…` | yes |
| `2` | `$2b$04$…` | `$2b$04$…` | yes |
| `40` | `$2b$31$…` | `$2b$31$…` | yes |
| `0` | `$2b$10$…` | `$2b$10$…` | yes |
| `NaN` | `$2b$10$…` | `$2b$10$…` | yes |
| `"x"` | throws | throws | yes |

### Correction

The trace confirms Difference 1: out-of-range rounds are **clamped**, not thrown.
The first-pass `FAILS WHEN` line and step 2 should say "clamped", and step 1
should say falsy (`||`), not merely "not provided". Execution matches the AI
explanation and the source.
