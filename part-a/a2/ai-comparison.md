# Task 5 — Part A2 — AI Comparison

Second-stage AI explanation compared against the candidate's first-pass
pseudocode for three `bcryptjs` functions, with every difference adjudicated
against the actual installed source code.

Source of truth: `/Users/mac/git/freelancer-hub-authorization/node_modules/bcryptjs/index.js`
(bcryptjs 3.0.3). No production code was modified.

---

## 1. Library was actually used by the project

| Evidence | Location |
| -------- | -------- |
| Declared dependency | `freelancer-hub-authorization/package.json:22` → `"bcryptjs": "^3.0.3"` |
| Installed version | `node_modules/bcryptjs/package.json:4` → `"version": "3.0.3"` |
| Imported in project code | `src/server/actions/auth/reactivate-account.ts:3`, `reset-password.ts:3`, `signup.ts:4`, `src/server/services/auth-flows.ts:2`, `src/lib/auth/auth.ts:5` |
| Called in project code | `bcrypt.compare` at `reactivate-account.ts:33` and `auth.ts:100`; `bcrypt.hash(password, 12)` at `reset-password.ts:49`, `signup.ts:95`, `auth-flows.ts:141`, `auth-flows.ts:493` |
| ESM entry resolved by the package | `node_modules/bcryptjs/index.js` (per `bcryptjs/package.json:32-42`) |

`bcrypt.hash` reaches `genSaltSync`; `bcrypt.compare` **is** the analyzed
function. `getRounds` is an exported member of the same installed package
(`index.js:1154`) but is not called directly in `src/`.

---

## 2. Three functions were selected

| # | Function | Difficulty | Source location | In evidence file |
| - | -------- | ---------- | --------------- | ---------------- |
| 1 | `getRounds` | Short | `bcryptjs/index.js:296-300` | `function-1-getRounds.md` |
| 2 | `genSaltSync` | Medium | `bcryptjs/index.js:87-102` | `function-2-genSaltSync.md` |
| 3 | `compare` | Hard | `bcryptjs/index.js:246-288` | `function-3-compare.md` |

---

## 3. Difficulty progression

| # | Function | Difficulty | Why |
| - | -------- | ---------- | --- |
| 1 | `getRounds` | Short | A single split and `parseInt`; no loops, no side effects |
| 2 | `genSaltSync` | Medium | Defaulting, type check, clamping, zero-padding, random-byte dependency, base64 encoding |
| 3 | `compare` | Hard | Async dual API, length short-circuit, salt slicing, key derivation, constant-time compare, error routing |

The order is now strictly increasing in difficulty: short (`getRounds`) →
medium (`genSaltSync`) → hard (`compare`). `compare` is unambiguously the
function that takes the longest to follow in full.

---

## 4. First-pass pseudocode existed before the AI explanation

* The candidate wrote the first-pass pseudocode by hand before any AI
  involvement, in `part-a/a2/function-1-getRounds.md`,
  `function-2-genSaltSync.md`, and `function-3-compare.md`.
* At the time of reading, each file contained only the candidate's own
  `FUNCTION / INPUTS / OUTPUT / SIDE EFFECTS / FAILS WHEN / STEPS` text — no AI
  explanation, no comparison, no source-code citations.
* The AI explanation and comparison were then appended **after** that first
  pass, never inserted into it.
* The candidate's pseudocode text is byte-for-byte preserved in each file. The
  only change to each file is the appended AI section below the unchanged first
  pass (verified with `diff` for `getRounds` and `genSaltSync`).

---

## 5. Comparison vs the source code

Every candidate/description difference was checked against `index.js`.

| Function | Diff | Candidate first pass | AI explanation | Source verdict | Who was right |
| -------- | ---- | -------------------- | -------------- | -------------- | ------------- |
| 1 `getRounds` | — | (fully consistent) | (fully consistent) | `index.js:296-300` | **Both correct** |
| 2 `genSaltSync` | 2.1 | Out-of-range rounds → throw | Out-of-range rounds → clamp to [4,31] | `index.js:93-94` clamps; only `index.js:89-92` throws (non-number) | **AI** |
| 2 `genSaltSync` | 2.2 | Default only when "not provided" | `0`/`NaN`/`undefined` → default 10 via `||` | `index.js:88`, `:515` | **AI** |
| 3 `compare` | 3.1 | Always extracts salt and hashes | Returns `false` without hashing when length ≠ 60 | `index.js:259-262` short-circuits before `hash(...)` at `:263` | **AI** |
| 3 `compare` | 3.2 | Non-string error only "through the callback" | Callback path callback, no-callback path Promise rejection | `index.js:248-258`, `:274-287` | **AI** |

Runtime spot-checks confirming the verdicts:

* `genSaltSync(2)` → `$2b$04$…` and `genSaltSync(40)` → `$2b$31$…` (no throw).
* `compare("x", "short")` → `false` (no hashing).
* `compare(123, validHash)` → rejects `Illegal arguments: number, string`.

---

## 6. Incorrect AI explanations

**None.** In this comparison the second-stage AI explanation agreed with the
installed source on every point that was checked, including the two points the
candidate missed. No AI error is recorded because none was found, and none was
invented.

---

## 7. Errors in the candidate's first pass (source-confirmed)

1. `getRounds` (#1): no errors; the first pass was correct.
2. `genSaltSync` (#2): out-of-range `rounds` throws. **Incorrect** — the source
   clamps (`index.js:93-94`).
3. `genSaltSync` (#2): default applies only when rounds is absent. **Incomplete**
   — `0`/`NaN` also default to `10` (`index.js:88`).
4. `compare` (#3): no awareness of the `hashValue.length !== 60` short-circuit.
   **Incomplete** — a real branch that returns `false` without hashing
   (`index.js:259-262`).
5. `compare` (#3): non-string errors described only via the callback.
   **Imprecise** — the no-callback form rejects the Promise (`index.js:248-258`,
   `:274-287`).

---

## 8. Preservation and integrity

* Candidate pseudocode reproduced verbatim; never rewritten.
* Each evidence file (`function-1-getRounds.md`, `function-2-genSaltSync.md`,
  `function-3-compare.md`) has the AI explanation and comparison appended below
  its unchanged first pass.
* Application/production code not modified.
* Only Markdown evidence files under `part-a/a2/` were created or appended to.
* Old misnumbered duplicates created during the first attempt
  (`function-1-genSaltSync.md`, `function-2-getRounds.md`) were removed so the
  numbering matches the strict short → medium → hard order.
