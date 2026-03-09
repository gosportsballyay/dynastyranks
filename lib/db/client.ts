import { Pool } from "@neondatabase/serverless";
import { drizzle, NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

let _db: NeonDatabase<typeof schema> | null = null;

function getDb(): NeonDatabase<typeof schema> {
  if (_db) return _db;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  _db = drizzle(pool, { schema });
  return _db;
}

export const db = new Proxy({} as NeonDatabase<typeof schema>, {
  get(_, prop) {
    return Reflect.get(getDb(), prop);
  },
});

export type Database = NeonDatabase<typeof schema>;
