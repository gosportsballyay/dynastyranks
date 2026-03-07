/**
 * Shared league fetcher with admin bypass.
 *
 * Each league page re-verifies ownership defensively. This helper
 * centralizes that check and allows admins to view any league.
 */

import { db } from "@/lib/db/client";
import { leagues } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { isAdmin } from "./admin";

export async function getLeagueForUser(
  leagueId: string,
  userId: string,
  userEmail: string | null | undefined,
) {
  const where = isAdmin(userEmail)
    ? eq(leagues.id, leagueId)
    : and(eq(leagues.id, leagueId), eq(leagues.userId, userId));

  const [league] = await db
    .select()
    .from(leagues)
    .where(where)
    .limit(1);

  return league ?? null;
}
