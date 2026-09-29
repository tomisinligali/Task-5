# Bug Analysis — `app/api/auth/signup/route.ts`

Single planted behavioral difference between actual and intended behavior.

## 1. What the actual behavior does

In `handleSignup`, after the account is created, the code calls:

`buildSignupSuccessResponse(user, verificationToken)`

So the second argument is the email verification code. Inside `buildSignupSuccessResponse`, that argument is written into the session cookie:

`response.cookies.set({ name: SESSION_COOKIE_NAME, value: sessionToken, ... })`

where the parameter named `sessionToken` actually holds the verification token. The session row in the database was created with a different value (`input.sessionToken`, produced by `generateSecureToken()`).

Result: the session cookie contains the verification code, not the token stored on the `Session` row, so the cookie does not authenticate the session that was just created.

## 2. What the intended behavior should do

The signup flow should pass the session token it persisted, so the call should be:

`buildSignupSuccessResponse(user, sessionToken)`

The session cookie value must equal the `Session.token` created in the transaction. That is what actually logs the new user in. The verification token belongs only to the verification-email flow and must not be used as the session credential.

## 3. The exact difference

* Actual: `buildSignupSuccessResponse(user, verificationToken)` → cookie value = verification token.
* Intended: `buildSignupSuccessResponse(user, sessionToken)` → cookie value = session token (matches the persisted `Session` row).

Only the argument passed to `buildSignupSuccessResponse` differs. The variable supplied is `verificationToken` instead of `sessionToken`.

## 4. Bug name/type

**Wrong argument / credential mix-up.** The function passes the wrong token variable, causing the session cookie to be set to the email verification code instead of the session token. This is a session-management / authentication bug (broken session binding after signup) and also exposes the verification token in a cookie.
