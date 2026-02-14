"use server";

import { hash } from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { signIn } from "./config";
import { AuthError } from "next-auth";

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
