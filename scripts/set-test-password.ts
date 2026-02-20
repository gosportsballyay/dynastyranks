#!/usr/bin/env tsx
import { hash } from "bcryptjs";
import { db } from "../lib/db/client";
import { users } from "../lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const passwordHash = await hash("test1234", 12);
  await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.email, "test02@dynastyranks.dev"));
  console.log("Password updated for test02@dynastyranks.dev");
}

main();
