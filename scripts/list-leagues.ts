#!/usr/bin/env npx tsx
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../lib/db/schema";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL not set");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  const rows = await db.select().from(schema.leagues);
  console.log("Available leagues:");
  for (const l of rows) {
    console.log(`  ${l.externalLeagueId.padEnd(12)} ${l.id}  ${l.name} (${l.provider}, ${l.season})`);
  }
}

main().catch(console.error);
