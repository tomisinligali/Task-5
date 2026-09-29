# Actual-Behavior Pseudocode — `app/api/auth/signup/route.ts`

FUNCTION: `handleSignup` (invoked by the exported `POST` route handler)

INPUTS:

* `req`: `NextRequest` — the incoming HTTP request. Used for the client IP, the idempotency key header, the HTTP method, the URL pathname, and the raw JSON body.
* `body`: `unknown` — the value of `await req.json()`, or `null` if JSON parsing throws. Passed into `handleSignup` and validated with `signupSchema`.

OUTPUT:

* `Promise<NextResponse>`. On the success path it resolves to a `201` JSON response with body `{ message: "Account created successfully", user }` and two `Set-Cookie` headers (session cookie and CSRF cookie). On handled error paths it resolves to a `400`, `409`, `429`, or `500` JSON response. Unexpected errors are caught and converted to a `500` rather than being thrown out of `POST`.

SIDE EFFECTS:

* Reads `process.env.NODE_ENV`.
* Consumes a rate-limit bucket for scope `RATE_LIMIT_SCOPES.SIGNUP_IP`, keyed by the client IP.
* Runs the handler through `withIdempotency` (idempotency lookup/replay/caching for the key, method, path, and body).
* Database writes inside a single Prisma transaction: inserts a `User` row, inserts a `Session` row, and inserts an `EmailJob` row.
* Calls `processEmailJobs()` after the transaction commits.
* Calls `hashPassword(password)`, `generateVerificationCode()`, `generateSecureToken()`, and `generateCsrfToken()`.
* On unexpected errors, writes `[AUTH_SIGNUP_ERROR]` plus the error object to the console via `console.error`.
* Sets the session cookie and the CSRF cookie on the returned response.
* `createAccountAtomically` may sleep for 100 ms and run its transaction a second time.

FAILS WHEN (error / early-return paths):

* Rate limit is exhausted (`rateLimit.ok` is false) → returns the `rateLimitResponse` early.
* Idempotency key is absent/invalid (`idempotencyKey.ok` is false) → returns `idempotencyKey.response` early.
* If `req.json()` rejects, `body` becomes `null`.
* `body` is falsy or not an `object` → returns `400` "Invalid JSON body".
* `signupSchema.safeParse(body)` fails → returns `400` "Validation failed" with flattened field errors.
* The unique-constraint retry cannot insert the user → the error propagates to the `handleSignup` catch, and if it is a `P2002` it returns `409`; otherwise it is rethrown.
* `processEmailJobs()` rejects → the error propagates to the `handleSignup` catch; non-`P2002` errors are rethrown.
* Any error inside the `POST` `try` (including from `withIdempotency` or a rethrown error from `handleSignup`) → returns `500` "An unexpected error occurred while creating your account".

STEPS:

1. `POST` is called with `req`.

2. `rateLimit = await consumeRateLimit(RATE_LIMIT_SCOPES.SIGNUP_IP, getClientIp(req))`.

3. IF `!rateLimit.ok`:
   * Return `rateLimitResponse(rateLimit.retryAfterSeconds, <message>)` where the message contains `formatRetryAfter(rateLimit.retryAfterSeconds)`.
   * Early return.

4. `idempotencyKey = getRequiredIdempotencyKey(req)`.

5. IF `!idempotencyKey.ok`:
   * Return `idempotencyKey.response`.
   * Early return.

6. `body = await req.json().catch(() => null)` (so `body` is the parsed JSON, or `null` on parse failure).

7. Begin `POST`'s `try`.

8. Return `await withIdempotency({ key: idempotencyKey.value, method: req.method, path: new URL(req.url).pathname, body, handler: () => handleSignup(body) })`.
   * The `handler` passed in is `() => handleSignup(body)`. Its result (or a replayed stored result) is what `POST` returns.

9. Inside `handleSignup(body)`:

10. IF `!body || typeof body !== "object"`:
    * Return `NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })`.
    * Early return.

11. `parseResult = signupSchema.safeParse(body)`.

12. IF `!parseResult.success`:
    * Return `400` with `{ error: "Validation failed", details: parseResult.error.flatten().fieldErrors }`.
    * Early return.

13. Destructure `{ email, password, name, timezone }` from `parseResult.data`.

14. `await Promise.all([ hashPassword(password), Promise.resolve(generateVerificationCode()), Promise.resolve(generateSecureToken()) ])` and assign the results in order to `passwordHash`, `verificationToken`, `sessionToken`.

15. `verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000)`.

16. Begin `handleSignup`'s `try`.

17. `user = await createAccountAtomically({ email, passwordHash, name: name ?? null, timezone: timezone || "UTC", verificationToken, verificationExpires, sessionToken })`.

18. `createAccountAtomically` defines `withRetry(fn)`:
    * `try { return await fn() }`
    * `catch (error)`: IF `isUniqueConstraintError(error)` is true → `await sleep(100)` then `return fn()` (runs `fn` exactly one more time); ELSE `throw error`.

19. `createAccountAtomically` returns `withRetry(() => prisma.$transaction(async (tx) => { ... }))`, and the transaction performs, in order:
    1. `tx.user.create(...)` with data `email`, `passwordHash`, `name: input.name ?? null`, `timezone: input.timezone || "UTC"`, `authProvider: "credentials"`, `emailVerified: false`, `emailVerificationToken: input.verificationToken`, `emailVerificationExpires: input.verificationExpires`, and `select` of `id, email, name, timezone, emailVerified, createdAtUtc`. Result assigned to `user`.
    2. `tx.session.create(...)` with data `userId: user.id`, `token: input.sessionToken`, `expiresAtUtc: new Date(Date.now() + SESSION_EXPIRATION_MS)`.
    3. `tx.emailJob.create(...)` with data `userId: user.id`, `type: "verification"`, `status: "pending"`, `payload: JSON.stringify({ to: user.email, token: input.verificationToken, userName: user.name ?? undefined })`, `scheduledAt: new Date()`.
    4. Return `user`.
    * IF the transaction throws a `P2002` unique-constraint error, `withRetry` catches it, sleeps 100 ms, and executes the whole transaction again. If that second run throws, the error propagates.

20. IF `createAccountAtomically` succeeds, `await processEmailJobs()`.

21. Return `buildSignupSuccessResponse(user, verificationToken)`. Note the second argument passed here is `verificationToken`, while the function's parameter is named `sessionToken`.

22. Inside `buildSignupSuccessResponse(user, sessionToken)`:
    1. `response = NextResponse.json({ message: "Account created successfully", user }, { status: 201 })`.
    2. `response.cookies.set({ name: SESSION_COOKIE_NAME, value: sessionToken, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: SESSION_EXPIRATION_DAYS * 24 * 60 * 60, path: "/" })`, so the cookie value is the value that was passed as the second argument (`verificationToken` at the current call site).
    3. `response.cookies.set(CSRF_COOKIE_NAME, generateCsrfToken(), csrfCookieOptions())`.
    4. Return `response`.

23. IF an error is thrown inside `handleSignup`'s `try` (steps 17–21), its `catch (error)` runs:
    * IF `isUniqueConstraintError(error)` is true: return `NextResponse.json({ error: "An account with this email address already exists" }, { status: 409 })`.
    * ELSE: `throw error`, which propagates out of `handleSignup`.

24. IF an error propagates out of `withIdempotency` (including a rethrown `handleSignup` error), `POST`'s `catch (error)` runs:
    * `console.error("[AUTH_SIGNUP_ERROR]", error)`.
    * Return `NextResponse.json({ error: "An unexpected error occurred while creating your account" }, { status: 500 })`.

25. On success, the `201` response built in step 22 is returned from `handleSignup`, passed back through `withIdempotency`, and returned by `POST`.

HELPER — `isUniqueConstraintError(error)`:

* Returns `true` only when `error instanceof Prisma.PrismaClientKnownRequestError` and `error.code === "P2002"`; otherwise returns `false`.
