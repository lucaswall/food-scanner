import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getRequiredEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import * as schema from "@/db/schema";

let db: NodePgDatabase<typeof schema> | null = null;
let pool: Pool | null = null;

export function getDb(): NodePgDatabase<typeof schema> {
  if (!db) {
    pool = new Pool({
      connectionString: getRequiredEnv("DATABASE_URL"),
      max: 5,
      idleTimeoutMillis: 30000,
      // 5s was too tight for a cold TLS connect to Railway Postgres after an idle
      // period — checkout raced the handshake and threw "timeout exceeded when
      // trying to connect" (FOOD-SCANNER-11/12/13/V).
      connectionTimeoutMillis: 10000,
      // Keep idle sockets alive so an intermediary can't silently drop them and
      // leave the pool holding dead connections that only fail at checkout.
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    // REQUIRED: pg.Pool emits "error" on IDLE clients when the backend closes the
    // connection (Postgres restart, network blip, Railway maintenance). Node's
    // EventEmitter throws when an "error" event has no listener, so without this the
    // process died with an uncaught exception — level:fatal,
    // mechanism:auto.node.onuncaughtexception (FOOD-SCANNER-14). The pool discards the
    // broken client on its own; our job is only to observe it, never to rethrow.
    pool.on("error", (err) => {
      logger.error(
        { action: "db_pool_idle_client_error", err },
        "postgres idle client error (connection dropped; pool will recycle it)",
      );
    });

    db = drizzle(pool, { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
