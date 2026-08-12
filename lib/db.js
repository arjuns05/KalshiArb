import pg from "pg";

let pool;

export function getPool() {
  if (!process.env.DATABASE_URL) return null;

  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false,
    });
  }

  return pool;
}

export async function saveScan(result) {
  const db = getPool();
  if (!db) return;

  await db.query(
    `insert into scans (best_title, best_edge, kalshi_count, polymarket_count, match_count)
     values ($1, $2, $3, $4, $5)`,
    [
      result.best?.title || null,
      result.best?.edge || null,
      result.stats.kalshi,
      result.stats.polymarket,
      result.stats.matches,
    ],
  );
}
