/**
 * Lightweight per-user rate limiting backed by Postgres.
 *
 * Uses a sliding window counter per (userId, key) pair.
 * No external libraries — just a DB row per active window.
 */

import { db } from "@/lib/db/client";
import { apiRateLimits } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

interface RateLimitResult {
  allowed: boolean;
}

/**
 * Check and increment the rate limit counter for a user+key.
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
    // Window expired — reset
    await db
      .update(apiRateLimits)
      .set({ windowStart: now, count: 1, updatedAt: now })
      .where(eq(apiRateLimits.id, existing.id));
    return { allowed: true };
  }

  if (existing.count >= limit) {
    return { allowed: false };
  }

  // Increment within current window
  await db
    .update(apiRateLimits)
    .set({ count: existing.count + 1, updatedAt: now })
    .where(eq(apiRateLimits.id, existing.id));

  return { allowed: true };
}
