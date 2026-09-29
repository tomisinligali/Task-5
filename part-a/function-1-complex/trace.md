# Function 1 — Hand Trace

## Function

`processAiUploadJob`

## Test 1 — Normal Input

### Input

* `uploadId`: `cmu4nzsx70007mve9sba454gy`
* `userId`: `cmtwy1fx400098fe9hsbbn9b2`

### Starting State

* The `AiUpload` record exists.
* The record belongs to the supplied user.
* Status is `DONE`.
* MIME type is `image/png`.
* The stored file exists.
* DeepSeek is configured but does not support images.
* Gemini is configured and supports images.

### Trace

| Step | What happens                         | Result                                     |
| ---- | ------------------------------------ | ------------------------------------------ |
| 1    | Create scoped database client        | Success                                    |
| 2    | Set `provider = null`                | `provider = null`                          |
| 3    | Enter `try`                          | Continue                                   |
| 4    | Update upload status to `PROCESSING` | Success                                    |
| 5    | Read the upload record               | Record found                               |
| 6    | Check `!record`                      | False → continue                           |
| 7    | Read stored file                     | File found and read successfully           |
| 8    | Build content                        | Image branch → base64 image content        |
| 9    | Build AI request                     | `extract_expense` request created          |
| 10   | Select AI provider                   | DeepSeek skipped; Gemini selected          |
| 11   | Log provider start                   | Log written                                |
| 12   | Call Gemini and validate result      | If valid, continue                         |
| 13   | Log provider end                     | Log written                                |
| 14   | Update database with success         | Status becomes `DONE` and result is stored |
| 15   | End function                         | Resolves with `undefined`                  |

### Expected Final State

`AiUpload.status = DONE`

The validated expense extraction, raw output, provider, model, and attempt count are stored. Error fields are cleared.

---

## Test 2 — Edge Case

### Input

* `uploadId`: `cmu4nzsx70007mve9sba454gy`
* `userId`: `cmtwy1fx400098fe9hsbbn9b2`

### Edge Condition

The uploaded file is an image.

This tests the image-specific content and provider-selection branches.

### Trace

| Step | What happens                         | Result                                                                     |
| ---- | ------------------------------------ | -------------------------------------------------------------------------- |
| 1    | Create scoped database client        | Success                                                                    |
| 2    | Set `provider = null`                | `provider = null`                                                          |
| 3    | Enter `try`                          | Continue                                                                   |
| 4    | Update upload status to `PROCESSING` | Success                                                                    |
| 5    | Read the upload record               | Image record found                                                         |
| 6    | Check `!record`                      | False → continue                                                           |
| 7    | Read stored file                     | PNG file read successfully                                                 |
| 8    | Build content                        | `mimeType` starts with `image/` → image content created                    |
| 9    | Build AI request                     | `extract_expense` request created                                          |
| 10   | Select AI provider                   | DeepSeek is skipped because it does not support images; Gemini is selected |
| 11   | Log provider start                   | Log written                                                                |
| 12   | Call selected provider               | Gemini processes the image and returns a response                          |
| 13   | Validate response                    | Valid response continues to success path                                   |
| 14   | Update database                      | Status becomes `DONE`                                                      |
| 15   | End function                         | Resolves with `undefined`                                                  |

### Expected Final State

`AiUpload.status = DONE`

The important edge-case behavior is that the image causes DeepSeek to be skipped and Gemini to be selected.

---

## Test 3 — Invalid Input

### Input

* `uploadId`: `cmu4nzsx70007mve9sba0000`
* `userId`: `cmtwy1fx400098fe9hsbbn9b2`

### Starting State

* No `AiUpload` exists with this `uploadId`.
* Therefore there is no file or ownership relationship for this ID.

### Trace

| Step | What happens                                       | Result                                            |
| ---- | -------------------------------------------------- | ------------------------------------------------- |
| 1    | Create scoped database client                      | Success                                           |
| 2    | Set `provider = null`                              | `provider = null`                                 |
| 3    | Enter `try`                                        | Continue                                          |
| 4    | Attempt to update upload to `PROCESSING`           | Ownership lookup finds no record                  |
| 5    | Update throws `AiUpload not found or unauthorized` | Control moves to `catch`                          |
| 6    | Normalize the failure                              | Failure becomes an `invalid_request`-type failure |
| 7    | Attempt to update upload to `FAILED`               | Ownership lookup again finds no record            |
| 8    | Failure update throws                              | Error is swallowed by the inner `catch`           |
| 9    | End function                                       | Resolves with `undefined`                         |

### Expected Final State

No `AiUpload` row is changed.

The function does not rethrow the error.

---

## Comparison

| Test    | Input condition                                        | Main path                                                   | Expected database result |
| ------- | ------------------------------------------------------ | ----------------------------------------------------------- | ------------------------ |
| Normal  | Valid existing image upload                            | Processing → provider → success                             | `DONE`                   |
| Edge    | Same valid upload, specifically testing image handling | Image branch → DeepSeek skipped → Gemini selected → success | `DONE`                   |
| Invalid | Non-existent `uploadId`                                | Processing update fails → failure handling                  | No database row changed  |
## Runtime Comparison

### Test setup

The normal and edge cases were executed against an isolated PostgreSQL database, not the development database.

Setup:

* A temporary database `freelancer_hub_a1_trace` was created on the same local PostgreSQL server and synced from `prisma/schema.prisma` with `prisma db push`.
* The exact documented inputs were seeded with the real record values:

  * `User.id = cmtwy1fx400098fe9hsbbn9b2`
  * `AiUpload.id = cmu4nzsx70007mve9sba454gy`
  * `fileName = REC.png`
  * `mimeType = image/png`
  * `sizeBytes = 22117`
  * `storagePath = receipts/cmtwy1fx400098fe9hsbbn9b2/597d7aa69ddf66949ab39665c0f4fa4e.png`
  * initial `status = DONE`, `attempts = 2`, `provider = deepseek`, `model = deepseek-chat`
* The real `processAiUploadJob` was invoked through its existing public entry point `enqueueAiUploadJobs` from `src/server/jobs/ai-uploads.ts`. That entry point calls the real `processAiUploadJob`.
* A local HTTP endpoint on `127.0.0.1` stood in for the Gemini API. `GEMINI_BASE_URL` pointed at it and a dummy `GEMINI_API_KEY` was set. `DEEPSEEK_API_KEY` was also set to a dummy value so DeepSeek was configured but still image-incompatible, and `ANTHROPIC_API_KEY` was empty. No real AI provider was contacted.
* R2 environment values were removed so the existing local storage fallback read the stored PNG from `storage/uploads/receipts/...`.
* The temporary provider endpoint, script, and database were removed after the runs.

### Test 1 — Normal Input

Input (exact):

* `uploadId`: `cmu4nzsx70007mve9sba454gy`
* `userId`: `cmtwy1fx400098fe9hsbbn9b2`

The real function executed.

Observed log:

```text
[ai-queue] start at=... active=1/2 queued=0
[ai] provider call start at=... upload=cmu4nzsx70007mve9sba454gy provider=gemini
[fake-gemini] POST /v1beta/models/gemini-3.6-flash:generateContent bytes=31944
[ai] provider call end   at=... upload=cmu4nzsx70007mve9sba454gy provider=gemini attempts=1
[ai-queue] done  at=... active=0/2 queued=0
```

Actual result and state:

* The function resolved without throwing.
* `status = DONE`
* `provider = gemini`
* `model = gemini-3.6-flash`
* `attempts` increased from `2` to `3`
* `rawOutput` and `result` were stored
* `errorCode` and `errorMessage` were cleared

Expected from the hand trace:

* `AiUpload.status = DONE`
* The validated extraction, raw output, provider, model, and attempt count are stored, and the error fields are cleared.
* DeepSeek is skipped because the upload is an image, and Gemini is selected.

Match: yes.

Correction: none.

### Test 2 — Edge Input

Input (exact):

* `uploadId`: `cmu4nzsx70007mve9sba454gy`
* `userId`: `cmtwy1fx400098fe9hsbbn9b2`

Edge condition: the uploaded file is an image, so this run exercises the image-specific content and provider-selection branches.

The isolated row was reset to the same documented starting state before this run, then the real function executed again.

Observed log: the same provider path as Test 1, with `provider=gemini` and `attempts=1`.

Actual result and state:

* The function resolved without throwing.
* `status = DONE`
* `provider = gemini`
* `model = gemini-3.6-flash`
* `attempts` increased from `2` to `3`
* `rawOutput` and `result` were stored
* `errorCode` and `errorMessage` were cleared

Expected from the hand trace:

* `AiUpload.status = DONE`
* The image branch creates image content, DeepSeek is skipped because it does not support images, and Gemini is selected.

Match: yes. The observed provider was `gemini`.

Correction: none.

### Test 3 — Invalid Input

Input (exact):

* `uploadId`: `cmu4nzsx70007mve9sba0000`
* `userId`: `cmtwy1fx400098fe9hsbbn9b2`

This case was not rerun. The isolated normal and edge runs did not write to the development database, so the previously executed invalid-case result remains valid.

The documented behavior is unchanged:

1. The upload ownership check fails.
2. The `PROCESSING` update does not occur.
3. Control moves to the failure handler.
4. The attempted `FAILED` update also fails because the upload does not exist.
5. The inner catch swallows that error.
6. The function resolves without throwing.
7. No database row is changed.

### Comparison Result

* Normal: `DONE`, Gemini selected, result stored. Matches the hand trace.
* Edge: `DONE`, image branch, DeepSeek skipped, Gemini selected. Matches the hand trace.
* Invalid: previously executed; remains valid and was not affected by the isolated runs.

No pseudocode correction was required based on the runtime evidence.
