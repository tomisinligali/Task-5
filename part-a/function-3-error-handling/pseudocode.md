FUNCTION deleteRecordAction
INPUTS:
- publicId: string
OUTPUT:
- Promise<DeleteRecordResponse>, where DeleteRecordResponse = { success: boolean; error?: string }
- The normal success path does not return an object; it calls redirect(), which throws a Next.js redirect signal.
- The caught-error path returns { success: false, error: "An unexpected error occurred while deleting the record." }.
SIDE EFFECTS:
- Reads the session and the User row.
- Calls deleteRecordWithAudit, which reads the record and, inside one transaction, creates a DELETED audit log and deletes the record.
- Logs the caught error to the console.
- Revalidates the "/dashboard/records" path.
- Redirects to "/dashboard/records".
FAILS WHEN:
- The session/user lookup fails or returns no user -> unauthorized() is called.
- publicId fails validation -> forbidden() is called.
- deleteRecordWithAudit throws -> the error is caught, logged, and converted to the generic failure response.
- deleteRecordWithAudit returns null -> forbidden() is called.
- revalidatePath or redirect throws (not caught).
- getSessionUserId throws (not caught).
STEPS:
 1. Call getSessionUserId() to resolve the authenticated user. DB READ: session and User lookup
 2. IF userId is falsy:
a. Call unauthorized(). throws a Next.js control-flow error; function stops
 3. Validate publicId with publicIdSchema.safeParse(publicId).
 4. IF validation fails:
a. Call forbidden(). throws a Next.js control-flow error; function stops
 5. Set deleted to null.
 6. Begin TRY.
 7. Call deleteRecordWithAudit(userId, parsed.data).
DB READ: record lookup
DB WRITE: DELETED audit log create
DB WRITE: record delete
Both writes are in one transaction
 8. IF deleteRecordWithAudit returns:
a. Store the returned result in deleted.
 9. IF deleteRecordWithAudit throws:
a. Catch the error as err.
b. Log console.error("Delete record error:", err).
c. Return { success: false, error: "An unexpected error occurred while deleting the record." }.
d. Stop.
10. End TRY/CATCH.
11. IF deleted is null:
a. Call forbidden(). throws a Next.js control-flow error; function stops
12. Call revalidatePath("/dashboard/records").
13. Call redirect("/dashboard/records"). throws a Next.js redirect signal; function stops
14. End.
Note: The branch that must not be missed is that only deleteRecordWithAudit is inside the try/catch. The unauthorized(), forbidden(), revalidatePath(), and redirect() calls are outside it and throw Next.js control-flow signals, so they are not caught or converted to the generic error response.