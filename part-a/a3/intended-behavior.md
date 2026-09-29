# Intended-Behavior Pseudocode — `app/api/auth/signup/route.ts`

Purpose: create a new credentials account when a visitor submits the signup form. The route must protect itself with an IP rate limit and idempotency, validate the input, create the user, an authenticated session, and the verification email job atomically, send the verification email, then return a `201` and log the new user in by setting a session cookie that matches the session that was actually persisted. It must rotate the CSRF token after authentication (anti-fixation) and surface clear errors for invalid input, duplicate email, throttling, and unexpected failures.

FUNCTION: `handleSignup` (invoked by the exported `POST` route handler)

INPUTS:

* `req`: `NextRequest` — the incoming HTTP request. Provides the client IP, the idempotency key header, the HTTP method, the URL pathname, and the raw JSON body.
* `body`: `unknown` — the parsed request JSON, or `null` if parsing fails. Validated against `signupSchema`.

OUTPUT:

* `Promise<NextResponse>`. Success: `201` with `{ message: "Account created successfully", user }` and two `Set-Cookie` headers (session cookie and CSRF cookie). Handled errors: `400`, `409`, `429`, or `500` JSON responses. Expected/handled errors are converted to responses rather than thrown out of `POST`.

SIDE EFFECTS:

* Consumes the `SIGNUP_IP` rate-limit bucket keyed by client IP.
* Runs the handler through `withIdempotency` for the key, method, path, and body.
* Hashes the password with `hashPassword`.
* Generates a verification code (`generateVerificationCode`), a session token (`generateSecureToken`), and a CSRF token (`generateCsrfToken`).
* Database writes inside one transaction: insert `User`, insert `Session`, insert `EmailJob` (type `verification`).
* Sends the verification email by calling `processEmailJobs()` after the account is created.
* Sets the session cookie and rotates the CSRF cookie on the response.
* Logs `[AUTH_SIGNUP_ERROR]` to the console on unexpected errors.
* `createAccountAtomically` may sleep 100 ms and retry the transaction once if a unique-constraint error occurs.

FAILS WHEN (intended error handling):

* Rate limit is exhausted → returns `429` (the rate-limit response) early.
* Idempotency key is missing/invalid → returns the idempotency-key error response early.
* `req.json()` rejects → `body` becomes `null` and is treated as invalid input.
* `body` is falsy or not an object → `400` "Invalid JSON body".
* `signupSchema.safeParse(body)` fails → `400` "Validation failed" with field errors.
* An account with that email already exists (unique constraint that survives the single retry) → `409`.
* `processEmailJobs()` fails after the account is committed → the error propagates and is handled as an unexpected `500` (the account and session already exist).
* Any unexpected error in the handler or wrapper → `500` generic error after logging.

STEPS:

1. `POST` receives `req`.
2. Consume the rate limit: `rateLimit = await consumeRateLimit(SIGNUP_IP, getClientIp(req))`.
3. IF `!rateLimit.ok`: return `rateLimitResponse(rateLimit.retryAfterSeconds, <message with formatted retry delay>)`. Early return.
4. `idempotencyKey = getRequiredIdempotencyKey(req)`.
5. IF `!idempotencyKey.ok`: return `idempotencyKey.response`. Early return.
6. `body = await req.json().catch(() => null)`.
7. Return `await withIdempotency({ key, method: req.method, path: new URL(req.url).pathname, body, handler: () => handleSignup(body) })`, so a replayed request returns the stored response and otherwise `handleSignup` runs.

8. Inside `handleSignup(body)`:
   1. IF `!body || typeof body !== "object"` → return `400` `{ error: "Invalid JSON body" }`. Early return.
   2. `parseResult = signupSchema.safeParse(body)`.
   3. IF parsing fails → return `400` `{ error: "Validation failed", details: fieldErrors }`. Early return.
   4. Destructure `{ email, password, name, timezone }` from `parseResult.data`.
   5. Generate credentials concurrently: `passwordHash = await hashPassword(password)`, `verificationToken = generateVerificationCode()`, `sessionToken = generateSecureToken()`.
   6. `verificationExpires = new Date(Date.now() + 24h)`.
   7. Begin `try`.
   8. `user = await createAccountAtomically({ email, passwordHash, name: name ?? null, timezone: timezone || "UTC", verificationToken, verificationExpires, sessionToken })`.

9. `createAccountAtomically` runs `withRetry(() => prisma.$transaction(...))`:
   * `withRetry`: run the transaction; if it throws a `P2002` unique-constraint error, sleep 100 ms and run it once more; otherwise rethrow.
   * Transaction, in order:
     1. Insert `User` with the email, password hash, name, timezone, `authProvider: "credentials"`, `emailVerified: false`, and the verification token/expiry; select `id, email, name, timezone, emailVerified, createdAtUtc`.
     2. Insert `Session` with `userId = user.id`, `token = sessionToken`, and `expiresAtUtc = now + SESSION_EXPIRATION_MS`. This is the token that authenticates the user.
     3. Insert `EmailJob` with `type = "verification"`, `status = "pending"`, payload `{ to: user.email, token: verificationToken, userName }`, and the current time.
     4. Return the created user.

10. After the transaction commits, `await processEmailJobs()` so the verification email is sent.
11. Return `buildSignupSuccessResponse(user, sessionToken)` — passing the same `sessionToken` that was persisted on the `Session` row.
12. `buildSignupSuccessResponse`:
    1. Build `NextResponse.json({ message: "Account created successfully", user }, { status: 201 })`.
    2. Set the session cookie `SESSION_COOKIE_NAME` to the session token value, with `httpOnly: true`, `secure` in production, `sameSite: "lax"`, `maxAge = SESSION_EXPIRATION_DAYS * 86400`, `path: "/"`. The cookie value must equal the token stored on the `Session` row so the cookie authenticates that session.
    3. Rotate the CSRF cookie: set `CSRF_COOKIE_NAME` to a freshly generated `generateCsrfToken()` using `csrfCookieOptions()` (anti-fixation after an auth event).
    4. Return the response.
13. IF a `P2002` unique-constraint error reaches `handleSignup`'s `catch`: return `409` `{ error: "An account with this email address already exists" }`.
14. ELSE rethrow any other error.
15. `POST`'s outer `catch`: `console.error("[AUTH_SIGNUP_ERROR]", error)` and return `500` `{ error: "An unexpected error occurred while creating your account" }`.

INTENDED INVARIANTS:

* Atomic account creation: user, session, and verification email job are written in one transaction; a failed create leaves no partial account.
* Credential correctness: the session cookie carries the same token that was persisted in the `Session` row, so the user is actually logged in after signup; the verification token is used only for the email-verification flow.
* Security: the password is only ever stored hashed; the session cookie is `httpOnly` and `secure` in production; the CSRF token is rotated after authentication.
* Input safety: the request body is schema-validated before any writes; invalid input and duplicate emails produce clear `400`/`409` responses.
* Abuse protection: signup attempts are IP rate-limited and the handler is idempotent.
* Consistency: a duplicate email resolves to `409`, not an unhandled `500`.
