import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { signupSchema } from "@/lib/validation/auth";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import {
  generateSecureToken,
  generateVerificationCode,
  SESSION_COOKIE_NAME,
  SESSION_EXPIRATION_DAYS,
  SESSION_EXPIRATION_MS,
} from "@/lib/auth/session";
import { processEmailJobs } from "@/lib/email/processor";
import { getRequiredIdempotencyKey, withIdempotency } from "@/lib/idempotency";
import { CSRF_COOKIE_NAME, csrfCookieOptions, generateCsrfToken } from "@/lib/auth/csrf";
import {
  consumeRateLimit,
  getClientIp,
  formatRetryAfter,
  RATE_LIMIT_SCOPES,
  rateLimitResponse,
} from "@/lib/auth/rateLimit";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

interface CreateUserInput {
  email: string;
  passwordHash: string;
  name?: string | null;
  timezone?: string;
  verificationToken: string;
  verificationExpires: Date;
  sessionToken: string;
}

async function createAccountAtomically(input: CreateUserInput) {
  const withRetry = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        await sleep(100);
        return fn();
      }
      throw error;
    }
  };

  return withRetry(() =>
    prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          name: input.name ?? null,
          timezone: input.timezone || "UTC",
          authProvider: "credentials",
          emailVerified: false,
          emailVerificationToken: input.verificationToken,
          emailVerificationExpires: input.verificationExpires,
        },
        select: {
          id: true,
          email: true,
          name: true,
          timezone: true,
          emailVerified: true,
          createdAtUtc: true,
        },
      });

      await tx.session.create({
        data: {
          userId: user.id,
          token: input.sessionToken,
          expiresAtUtc: new Date(Date.now() + SESSION_EXPIRATION_MS),
        },
      });

      await tx.emailJob.create({
        data: {
          userId: user.id,
          type: "verification",
          status: "pending",
          payload: JSON.stringify({
            to: user.email,
            token: input.verificationToken,
            userName: user.name ?? undefined,
          }),
          scheduledAt: new Date(),
        },
      });

      return user;
    })
  );
}

function buildSignupSuccessResponse(user: {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  emailVerified: boolean;
  createdAtUtc: Date;
}, sessionToken: string): NextResponse {
  const response = NextResponse.json(
    { message: "Account created successfully", user },
    { status: 201 }
  );

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_EXPIRATION_DAYS * 24 * 60 * 60,
    path: "/",
  });

  // Signup auto-logs the user in, so rotate the CSRF token post-auth
  // (same anti-fixation behavior as login).
  response.cookies.set(CSRF_COOKIE_NAME, generateCsrfToken(), csrfCookieOptions());

  return response;
}

async function handleSignup(body: unknown): Promise<NextResponse> {
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = signupSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { email, password, name, timezone } = parseResult.data;

  const [passwordHash, verificationToken, sessionToken] = await Promise.all([
    hashPassword(password),
    Promise.resolve(generateVerificationCode()),
    Promise.resolve(generateSecureToken()),
  ]);

  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  try {
    const user = await createAccountAtomically({
      email,
      passwordHash,
      name: name ?? null,
      timezone: timezone || "UTC",
      verificationToken,
      verificationExpires,
      sessionToken,
    });

    await processEmailJobs();

    return buildSignupSuccessResponse(user, verificationToken);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "An account with this email address already exists" },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function POST(req: NextRequest) {
  const rateLimit = await consumeRateLimit(RATE_LIMIT_SCOPES.SIGNUP_IP, getClientIp(req));

  if (!rateLimit.ok) {
    return rateLimitResponse(
      rateLimit.retryAfterSeconds,
      `Too many sign-up attempts from this address. Please try again in ${formatRetryAfter(rateLimit.retryAfterSeconds)}.`
    );
  }

  const idempotencyKey = getRequiredIdempotencyKey(req);
  if (!idempotencyKey.ok) return idempotencyKey.response;

  const body = await req.json().catch(() => null);

  try {
    return await withIdempotency({
      key: idempotencyKey.value,
      method: req.method,
      path: new URL(req.url).pathname,
      body,
      handler: () => handleSignup(body),
    });
  } catch (error) {
    console.error("[AUTH_SIGNUP_ERROR]", error);
    return NextResponse.json(
      { error: "An unexpected error occurred while creating your account" },
      { status: 500 }
    );
  }
}
