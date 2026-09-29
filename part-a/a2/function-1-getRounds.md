# Function 1 — getRounds

## Source

* Package: `bcryptjs` `3.0.3`
* Implementation: `node_modules/bcryptjs/index.js:296-300`
* Project dependency: `freelancer-hub-authorization/package.json:22` → `"bcryptjs": "^3.0.3"`
* Exported by the same installed package that the project imports
  (`import bcrypt from "bcryptjs"` at five files; default export map at
  `index.js:1146-1158`). It is not called directly in `src/`.
* Difficulty: Short / Low. This is the first function in increasing-difficulty
  order: short → medium → hard.

---

## First-Pass Pseudocode (candidate-authored — verbatim, unmodified)

Provenance: authored by the candidate in this file before any AI explanation.
The AI has **not** written, rewritten, improved, reordered, or edited this text.

FUNCTION getRounds

INPUTS:

* `hash`: a bcrypt hash string

OUTPUT:

* The numeric number of bcrypt rounds/cost factor contained in the hash

SIDE EFFECTS:

* None

FAILS WHEN:

* The `hash` input is not a string

1. Receive the `hash` input.
2. Check whether `hash` is a string.
3. IF `hash` is not a string:

   * Throw an error.
   * Stop execution.
4. Split the hash string using `$` as the separator.
5. Take the part containing the bcrypt rounds/cost value.
6. Convert that value from a string into a number.
7. Return the number.

---

## AI Explanation (second stage)

`getRounds` returns the cost factor encoded in a bcrypt string. It checks only
that the argument is a string; otherwise it throws
`Error("Illegal arguments: " + typeof hash)`. It then does exactly
`parseInt(hash.split("$")[2], 10)`.

Two consequences follow from the literal code:

* There is no length, version, or format validation, so a bare salt
  (`$2b$09$…`) also returns a number (`9`), not only a 60-character hash.
* A string with no third `$` segment (e.g. `"nope"`) returns `NaN`, because
  `parseInt(undefined, 10)` is `NaN`; it does not throw.

---

## Differences (first pass vs AI)

**None.** Every step in the candidate's first pass matches the source:

| Candidate step | Source | Agreement |
| -------------- | ------ | --------- |
| Receive the `hash` input | parameter `hash` | Yes |
| Check it is a string | `index.js:297` | Yes |
| Non-string → throw and stop | `index.js:297-298` | Yes |
| Split on `$` | `hash.split("$")` (`index.js:299`) | Yes |
| Take the rounds part | `[2]` (`index.js:299`) | Yes |
| Convert to a number | `parseInt(..., 10)` (`index.js:299`) | Yes |
| Return the number | `return` (`index.js:299`) | Yes |

The AI explanation is more explicit about the two edge behaviors (works on a
salt; returns `NaN`), but these are refinements of the same understanding, not
contradictions. Per the instruction not to invent disagreements, they are **not**
recorded as differences.

---

## Source-Code Verification

1. Type check and throw — `index.js:297-298`:
   `if (typeof hash !== "string") throw Error("Illegal arguments: " + typeof hash);`
2. Parse — `index.js:299`: `return parseInt(hash.split("$")[2], 10);`
3. No further validation exists in the body (lines 296-300).
4. Runtime: `getRounds("$2b$12$…")` → `12`; `getRounds("$2b$09$…")` → `9`;
   `getRounds("nope")` → `NaN`; `getRounds(123)` → throws
   `Illegal arguments: number`.

---

## Final Determination

The candidate's first-pass pseudocode was **correct**. The AI explanation was
also correct. There were no meaningful differences, and therefore no incorrect
AI explanation to record for this function.

---

## Hand Trace (verification, added)

Runtime: `node` against the installed `bcryptjs` 3.0.3
(`freelancer-hub-authorization/node_modules/bcryptjs`). Random salt bytes differ
per run; the prefix and structure are what is checked.

### Test 1 — Normal input

Inputs:

* `hash` = `$2b$12$Qtgb8t3PwCQsLtBj6JSbQ.N3ifT1colMPQDYipbLjZMfBc7LBHu5m`

Hand trace (source, `index.js:296-300`):

1. `typeof hash` is `"string"` → no throw.
2. `hash.split("$")` → `["", "2b", "12", "Qtgb…", ""]`.
3. Take `[2]` → `"12"`.
4. `parseInt("12", 10)` → `12`.
5. Return `12`.

Expected: `12`.
Real execution: `getRounds(hash12) => 12`.
Match: **yes.**

### Test 2 — Edge cases

* `hash` = `$2b$09$0a7egFtvdR3U/CQBZOWt5.` (a 29-char salt, not a 60-char hash)
  → `[2]` = `"09"` → `9`. Real: `getRounds(salt9) => 9`. Match.
* `hash` = `"nope"` → split = `["nope"]`, `[2]` is `undefined` →
  `parseInt(undefined, 10)` = `NaN` → return `NaN`. Real: `getRounds("nope")`
  returns `NaN` (`JSON.stringify` prints it as `null`). Match.

### Test 3 — Invalid input

Input: `hash` = `123`.

Hand trace: `typeof 123 !== "string"` → `throw Error("Illegal arguments: number")`;
stop.

Expected: throws `Illegal arguments: number`.
Real execution: `getRounds(123) => THREW Error: Illegal arguments: number`.
Match: **yes.**

### Comparison Summary

| Test | Expected | Real | Match |
| ---- | -------- | ---- | ----- |
| Normal hash | `12` | `12` | yes |
| Salt string | `9` | `9` | yes |
| `"nope"` | `NaN` | `NaN` | yes |
| `123` | throws | throws | yes |

### Correction

None. The first-pass pseudocode matched the source, so no correction is required.
