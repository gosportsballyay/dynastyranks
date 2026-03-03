"use server";

import { hash } from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { users, passwordResetTokens } from "@/lib/db/schema";
import { eq, and, gt, isNull, sql } from "drizzle-orm";
import { signIn } from "./config";
import { AuthError } from "next-auth";
import * as Sentry from "@sentry/nextjs";
import { sendPasswordResetEmail } from "@/lib/email/send-reset-email";

const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password is too long"),
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
});

export type SignupResult = {
  success: boolean;
  error?: string;
};

/**
 * Create a new user account
 */
export async function signup(formData: FormData): Promise<SignupResult> {
  // Parse and validate input
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid input",
    };
  }

  const { email, password, name } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  // Check if user already exists
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (existingUser) {
    return {
      success: false,
      error: "An account with this email already exists",
    };
  }

  // Hash password
  const passwordHash = await hash(password, 12);

  // Create user
  try {
    await db.insert(users).values({
      email: normalizedEmail,
      passwordHash,
      name,
    });

    return { success: true };
  } catch (error) {
    console.error("Signup error:", error);
    return {
      success: false,
      error: "Failed to create account. Please try again.",
    };
  }
}

export type LoginResult = {
  success: boolean;
  error?: string;
};

/**
 * Log in an existing user
 */
export async function login(formData: FormData): Promise<LoginResult> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
    });

    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return { success: false, error: "Invalid email or password" };
        default:
          return { success: false, error: "Something went wrong" };
      }
    }
    throw error;
  }
}

// --- Password Reset ---

const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const MAX_TOKENS_PER_USER_PER_HOUR = 3;
const MAX_REQUESTS_PER_EMAIL_PER_HOUR = 5;

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

const requestResetSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export type RequestResetResult = { success: boolean; error?: string };

/**
 * Request a password reset email.
 * Always returns success to prevent email enumeration.
 */
export async function requestPasswordReset(
  formData: FormData
): Promise<RequestResetResult> {
  const parsed = requestResetSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid input",
    };
  }

  const normalizedEmail = parsed.data.email.toLowerCase();
  const oneHourAgo = new Date(Date.now() - RESET_TOKEN_EXPIRY_MS);

  try {
    // Rate limit: max requests per email per hour (before user lookup)
    const [emailRateCheck] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(passwordResetTokens)
      .innerJoin(users, eq(passwordResetTokens.userId, users.id))
      .where(
        and(
          eq(users.email, normalizedEmail),
          gt(passwordResetTokens.createdAt, oneHourAgo)
        )
      );

    if ((emailRateCheck?.count ?? 0) >= MAX_REQUESTS_PER_EMAIL_PER_HOUR) {
      // Silent success — no email enumeration
      return { success: true };
    }

    // Look up user
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (!user) {
      // No user — silent success
      return { success: true };
    }

    // Per-user rate limit
    const [userRateCheck] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          gt(passwordResetTokens.createdAt, oneHourAgo)
        )
      );

    if ((userRateCheck?.count ?? 0) >= MAX_TOKENS_PER_USER_PER_HOUR) {
      return { success: true };
    }

    // Invalidate existing unexpired tokens for this user
    await db
      .delete(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          gt(passwordResetTokens.expiresAt, new Date()),
          isNull(passwordResetTokens.usedAt)
        )
      );

    // Generate token
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = sha256(rawToken);

    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TOKEN_EXPIRY_MS),
    });

    // Send email
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

    try {
      await sendPasswordResetEmail(normalizedEmail, resetUrl);
    } catch (emailError) {
      Sentry.captureException(emailError);
    }

    return { success: true };
  } catch (error) {
    Sentry.captureException(error);
    return {
      success: false,
      error: "Something went wrong. Please try again.",
    };
  }
}

const resetPasswordSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, "Invalid reset token"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password is too long"),
});

export type ResetPasswordResult = { success: boolean; error?: string };

/**
 * Reset password using a valid reset token.
 */
export async function resetPassword(
  formData: FormData
): Promise<ResetPasswordResult> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      success: false,
      error: "This reset link is invalid or has expired.",
    };
  }

  const { token, password } = parsed.data;
  const tokenHash = sha256(token);

  try {
    // Find valid token
    const [resetToken] = await db
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
      })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          gt(passwordResetTokens.expiresAt, new Date()),
          isNull(passwordResetTokens.usedAt)
        )
      )
      .limit(1);

    if (!resetToken) {
      return {
        success: false,
        error: "This reset link is invalid or has expired.",
      };
    }

    // Step 1: Mark token as used (invalidate first for safety)
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, resetToken.id));

    // Step 2: Update password
    const passwordHash = await hash(password, 12);
    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, resetToken.userId));

    return { success: true };
  } catch (error) {
    Sentry.captureException(error);
    return {
      success: false,
      error: "Something went wrong. Please try again.",
    };
  }
}
