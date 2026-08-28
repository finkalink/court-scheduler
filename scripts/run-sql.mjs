// One-off runner for applying a SQL file (typically a supabase/migrations/*.sql
// file) directly against the live database. Requires DATABASE_URL, which is
// not committed -- see .env.local.
//
// Usage: node --env-file=.env.local scripts/run-sql.mjs supabase/migrations/0009_whatever.sql
import { readFileSync } from "node:fs";
import { Client } from "pg";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node --env-file=.env.local scripts/run-sql.mjs <path-to-sql-file>");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to .env.local.");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");
const client = new Client({ connectionString });

await client.connect();
try {
  await client.query(sql);
  console.log(`Applied ${file}`);
} finally {
  await client.end();
}
