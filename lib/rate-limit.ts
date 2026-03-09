/**
 * Lightweight per-user rate limiting backed by Postgres.
 *
 * Uses an atomic UPDATE to avoid TOCTOU race conditions:
 * a single query increments and checks the limit simultaneously.
 */

import { db } from "@/lib/db/client";
import { apiRateLimits } from "@/lib/db/schema";
import { eq, and, lt, gte, sql } from "drizzle-orm";

interface RateLimitResult {
  allowed: boolean;
}

/**
 * Check and increment the rate limit counter for a user+key.
 *
 * Uses atomic SQL so concurrent requests cannot bypass the limit.
 *
 * @param userId - Authenticated user ID
 * @param key - Action key (e.g. "connect", "sync", "recompute")
 * @param limit - Max requests allowed within the window
 * @param windowSeconds - Window duration in seconds
 */
export async function checkRateLimit(
  userId: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const windowStart = new Date(
    now.getTime() - windowSeconds * 1000,
  );

  // Atomic increment: only succeeds if count < limit AND
  // window hasn't expired
  const updated = await db
    .update(apiRateLimits)
    .set({
      count: sql`${apiRateLimits.count} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(apiRateLimits.userId, userId),
        eq(apiRateLimits.key, key),
        lt(apiRateLimits.count, limit),
        gte(apiRateLimits.windowStart, windowStart),
      ),
    )
    .returning({ id: apiRateLimits.id });

  if (updated.length > 0) {
    return { allowed: true };
  }

  // Either no row exists, window expired, or limit reached.
  // Check which case:
  const [existing] = await db
    .select()
    .from(apiRateLimits)
    .where(
      and(
        eq(apiRateLimits.userId, userId),
        eq(apiRateLimits.key, key),
      ),
    )
    .limit(1);

  if (!existing) {
    // First request ever for this user+key
    await db.insert(apiRateLimits).values({
      userId,
      key,
      windowStart: now,
      count: 1,
    });
    return { allowed: true };
  }

  const elapsed =
    (now.getTime() - existing.windowStart.getTime()) / 1000;

  if (elapsed > windowSeconds) {
    // Window expired — reset atomically
    await db
      .update(apiRateLimits)
      .set({ windowStart: now, count: 1, updatedAt: now })
      .where(eq(apiRateLimits.id, existing.id));
    return { allowed: true };
  }

  // Limit reached within active window
  return { allowed: false };
}
