/**
 * Apply db/migrations/*.sql (in order, once each) and db/seed.sql to the
 * Neon database in DATABASE_URL_UNPOOLED (direct connection — DDL should not
 * go through the pooler).
 *
 *   npm run db:migrate            # apply pending migrations + seed
 *   npm run db:migrate -- --status
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED is not set (run `neon env pull`).");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });

async function main() {
  await pool.query(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const applied = new Set(
    (await pool.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name),
  );
  const files = readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).sort();
  const pending = files.filter((f) => !applied.has(f));

  if (process.argv.includes("--status")) {
    for (const f of files) console.log(`${applied.has(f) ? "applied " : "pending "} ${f}`);
    const { rows } = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    console.log(`public tables: ${rows.map((r) => r.table_name).join(", ") || "(none)"}`);
    return;
  }

  for (const file of pending) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(readFileSync(`db/migrations/${file}`, "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`${file}: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  if (!pending.length) console.log("migrations up to date");

  await pool.query(readFileSync("db/seed.sql", "utf8"));
  console.log("seed applied");
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
