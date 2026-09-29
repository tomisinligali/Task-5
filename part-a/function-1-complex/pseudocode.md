# Function 1 — Complex Function

## Function

`processAiUploadJob`

## Inputs

* `uploadId`: string — identifies the uploaded receipt.
* `userId`: string — identifies the authenticated user and scopes database access.

## Output

* `Promise<void>`
* The function does not return a value.

## Side Effects

* Updates the `AiUpload` database record.
* Reads the uploaded file from local storage or Cloudflare R2.
* Calls a configured AI provider.
* Writes processing, success, or failure information to the database.
* Writes logs to the console.

## Fails When

* The `userId` is invalid or missing.
* The upload does not exist or is not owned by the user.
* The stored file cannot be read.
* No suitable AI provider is configured.
* No configured provider supports the uploaded content.
* The AI provider returns an authentication, rate-limit, server, request, timeout, or malformed-output error.
* The final database update fails.

## Steps

1. Create a user-scoped database client using `userId`.

2. Set `provider` to `null`.

3. Begin the main processing `TRY` block.

4. Update the `AiUpload` record identified by `uploadId` to `PROCESSING`.

5. Read the `AiUpload` record from the database.

6. IF the record does not exist:

   * Return immediately.
   * Do not perform any further processing.

7. Read the uploaded file from storage using the record's `storagePath`.

   * Use local storage when local storage is configured.
   * Otherwise read the file from Cloudflare R2.
   * IF the file cannot be read, the operation fails.

8. Build the AI content from the file.

   * IF the file is an image, convert the entire file to base64 image content.
   * ELSE convert the file to UTF-8 text and limit it to the configured maximum text length.

9. Create an AI request with:

   * task = `extract_expense`
   * the generated content
   * the uploaded file name

10. Select an enabled AI provider.

    * Check providers in the configured order: Claude, DeepSeek, then Gemini.
    * Skip providers that are not configured.
    * IF a configured provider can handle the content, select the first suitable provider.
    * IF no provider is configured, fail with `not_configured`.
    * ELSE IF providers are configured but none can handle the content, fail with `unsupported_content`.

11. Log that the AI provider call is starting.

12. Call the selected AI provider to process the request.

    * The provider may retry eligible failures.
    * Validate the provider's returned output.
    * IF the returned output is invalid or does not match the required structure, fail with `malformed_output`.

13. Log that the AI provider call has finished.

14. Update the `AiUpload` record with the successful result:

    * status = `DONE`
    * increase `attempts` by the number of provider attempts
    * store the validated extraction result
    * store the raw AI output
    * store the provider
    * store the model
    * clear `errorCode`
    * clear `errorMessage`

15. End the function successfully.

16. IF any error occurs during the main processing steps:

    * Normalize the error into an AI failure code and user-facing message.
    * IF the failure policy is `graceful_failure`:

      * Attempt to update the `AiUpload` record:

        * status = `FAILED`
        * increase `attempts` by the provider attempt count, or by `0` if no provider was selected
        * store the raw AI output if available
        * store the failure code
        * store the failure message
      * IF this failure update itself fails:

        * Swallow the error.
        * Leave the record in its current state.
    * End the function without rethrowing the handled error.
