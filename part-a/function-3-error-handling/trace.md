# Hand Trace

## Test 1 — Normal

### Inputs
- `publicId`: valid record belonging to the authenticated user
- Session: valid authenticated user

### Expected result
Successful deletion followed by redirect to `/dashboard/records`.

### Hand Trace

| Step | What happens | Result |
|---|---|---|
| 1 | Resolve authenticated user | User found |
| 2 | Check whether `userId` is falsy | User ID exists |
| 3 | Validate `publicId` | Valid |
| 4 | Call `deleteRecordWithAudit` | Continues |
| 5 | Find the record | Record found |
| 6 | Create `DELETED` audit log and delete record in transaction | Successful |
| 7 | Check returned deletion result | Result exists |
| 8 | Check whether `deleted` is null | Not null |
| 9 | Revalidate `/dashboard/records` | Completed |
| 10 | Redirect to `/dashboard/records` | Redirect |

---

## Test 2 — Edge Case

### Inputs
- `publicId`: validly formatted public ID, but the record does not exist or is not owned by the authenticated user
- Session: valid authenticated user

### Expected result
`forbidden()` is called.

### Hand Trace

| Step | What happens | Result |
|---|---|---|
| 1 | Resolve authenticated user | User found |
| 2 | Check whether `userId` is falsy | User ID exists |
| 3 | Validate `publicId` | Valid |
| 4 | Call `deleteRecordWithAudit` | Continues |
| 5 | Find the record | No matching record |
| 6 | `deleteRecordWithAudit` returns `null` | `null` |
| 7 | Check whether `deleted` is null | Yes |
| 8 | Call `forbidden()` | Function stops |

---

## Test 3 — Invalid

### Inputs
- `publicId`: malformed/invalid public ID
- Session: valid authenticated user

### Expected result
`forbidden()` is called.

### Hand Trace

| Step | What happens | Result |
|---|---|---|
| 1 | Resolve authenticated user | User found |
| 2 | Check whether `userId` is falsy | User ID exists |
| 3 | Validate `publicId` | Invalid |
| 4 | Call `forbidden()` | Function stops |
| 5 | `deleteRecordWithAudit` is not called | No deletion |
# Function 3 — deleteRecordAction

## Function

`deleteRecordAction`

## Source

`Freelancer-Authorization/src/server/actions/authorization/delete-record.ts`

## Purpose

Delete a record for the authenticated user while handling authorization, validation, deletion errors, audit logging, revalidation, and redirect behavior.

## INPUTS

* `publicId: string`

## OUTPUT

* `Promise<DeleteRecordResponse>`
* Success path redirects to `/dashboard/records` instead of returning a response object.
* Caught deletion error returns:

  * `success: false`
  * `error: "An unexpected error occurred while deleting the record."`

## SIDE EFFECTS

* Reads the authenticated user's session.
* Validates the supplied `publicId`.
* Reads and deletes the record through `deleteRecordWithAudit`.
* Creates a `DELETED` audit log when deletion succeeds.
* Logs caught deletion errors.
* Revalidates `/dashboard/records`.
* Redirects to `/dashboard/records`.

## FAILS WHEN

* No authenticated user is found → `unauthorized()`.
* `publicId` fails validation → `forbidden()`.
* `deleteRecordWithAudit` returns `null` → `forbidden()`.
* `deleteRecordWithAudit` throws → error is logged and a generic failure respo

---

## Real-Code Execution Comparison

### Test 1 — Normal

* publicId: `a1-normal-1790349976070`
* Session: authenticated user A
* User ID: `cmuh45esn0000mhe96zq1hrqh`
* Record belonged to user A.
* Real `deleteRecordAction` executed.
* Real `deleteRecordWithAudit` executed.
* Record was deleted.
* Audit row increased from 0 to 1.
* Record existence changed from true to false.
* `revalidatePath("/dashboard/records")` was called.
* Real redirect signal occurred:
  `NEXT_REDIRECT;replace;/dashboard/records;307;`
* Expected: delete → audit → revalidate → redirect.
* Result: Match.
* Correction: None.

### Test 2 — Edge

* publicId: `a1-edge-1790349976070`
* Session: authenticated user A.
* Public ID was validly formatted but the record belonged to user B.
* Real `deleteRecordAction` executed.
* Real `deleteRecordWithAudit` executed.
* Scoped lookup returned no record for user A.
* Record B remained unchanged.
* Audit count remained 0.
* Real `forbidden()` signal occurred:
  `NEXT_HTTP_ERROR_FALLBACK;403`
* Expected: `deleteRecordWithAudit` returns null → `forbidden()`.
* Result: Match.
* Correction: None.

### Test 3 — Invalid

* publicId: `bad id!`
* Session: authenticated user A.
* Real `deleteRecordAction` executed.
* `publicIdSchema.safeParse()` failed.
* `deleteRecordWithAudit` was not called.
* Record B remained unchanged.
* Audit count remained 0.
* Real `forbidden()` signal occurred:
  `NEXT_HTTP_ERROR_FALLBACK;403`
* Expected: validation fails → `forbidden()`.
* Result: Match.
* Correction: None.

## Final Comparison

| Test | Real Code Executed | Expected | Actual | Match | Correction |
|---|---|---|---|---|---|
| Normal | Yes | Delete → audit → revalidate → redirect | Delete → audit → revalidate → redirect | Yes | None |
| Edge | Yes | deleteRecordWithAudit returns null → forbidden | 403 forbidden signal | Yes | None |
| Invalid | Yes | Validation fails → forbidden | 403 forbidden signal | Yes | None |

* All three real executions matched the hand traces.
* Discrepancies: None.
* Corrections: None.
* Production code modified: No.
* Production database modified: No.
