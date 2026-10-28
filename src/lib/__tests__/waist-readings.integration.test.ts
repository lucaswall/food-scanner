/**
 * Integration: waist circumference readings round-trip
 *
 * Proves against real Postgres that waist readings are stored at 0.1 cm precision in a
 * `numeric` column, come back as JS numbers (not numeric strings), are ordered ascending
 * within UTC-day bounds, and that the (user_id, measured_at) upsert overwrites both
 * value_cm and zone_offset.
 *
 * PRE-CONDITIONS (lead must complete before running):
 *   1. Start a throwaway Postgres instance (e.g. Docker).
 *   2. Apply the current schema: `DATABASE_URL="$INTEGRATION_DATABASE_URL" npx drizzle-kit push`
 *   3. Run: `INTEGRATION_DATABASE_URL=<url> npm run test:integration`
 *
 * IMPORTANT: INTEGRATION_DATABASE_URL must point at a DEDICATED throwaway DB —
 * never at DATABASE_URL (dev/prod). This file overrides DATABASE_URL for the
 * entire process so getDb() connects to the integration instance.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb, closeDb } from "@/db/index";
import { upsertWaistReadings, getWaistReadings } from "@/lib/health-readings";

const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
if (INTEGRATION_DATABASE_URL) {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
}

// `.invalid` TLD is RFC-2606 reserved.
const EMAIL = "waist@health-readings-integration.invalid";

describe.skipIf(!INTEGRATION_DATABASE_URL)(
  "health-readings: waist readings (integration)",
  () => {
    let userId = "";

    async function cleanup(): Promise<void> {
      const db = getDb();
      const stale = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, EMAIL));
      for (const { id } of stale) {
        await db.delete(schema.waistReadings).where(eq(schema.waistReadings.userId, id));
        await db.delete(schema.users).where(eq(schema.users.id, id));
      }
    }

    beforeAll(async () => {
      await cleanup();
      const [row] = await getDb()
        .insert(schema.users)
        .values({ email: EMAIL, name: "Waist Integration" })
        .returning({ id: schema.users.id });
      userId = row!.id;
    });

    afterAll(async () => {
      await cleanup();
      await closeDb();
    });

    it("stores values rounded to 0.1 cm and returns them as numbers with null zoneOffset when absent", async () => {
      await upsertWaistReadings(userId, [
        { measuredAt: "2026-10-01T11:05:00.000Z", zoneOffset: "-03:00", valueCm: 104.55 },
        { measuredAt: "2026-10-02T11:05:00.000Z", zoneOffset: null, valueCm: 104 },
      ]);

      const rows = await getWaistReadings(userId, "2026-10-01", "2026-10-02");

      expect(rows).toEqual([
        { id: expect.any(Number), measuredAt: "2026-10-01T11:05:00.000Z", zoneOffset: "-03:00", valueCm: 104.6 },
        { id: expect.any(Number), measuredAt: "2026-10-02T11:05:00.000Z", zoneOffset: null, valueCm: 104 },
      ]);

      const [raw] = await getDb()
        .select({ valueCm: schema.waistReadings.valueCm })
        .from(schema.waistReadings)
        .where(eq(schema.waistReadings.measuredAt, new Date("2026-10-01T11:05:00.000Z")));
      expect(raw!.valueCm).toBe("104.6");
    });

    it("overwrites value_cm and zone_offset on a conflicting (user_id, measured_at) push", async () => {
      await upsertWaistReadings(userId, [
        { measuredAt: "2026-10-10T11:05:00.000Z", zoneOffset: "-03:00", valueCm: 105.2 },
      ]);
      // Same instant spelled with a different offset.
      await upsertWaistReadings(userId, [
        { measuredAt: "2026-10-10T08:05:00-03:00", zoneOffset: null, valueCm: 103.8 },
      ]);

      const rows = await getWaistReadings(userId, "2026-10-10", "2026-10-10");

      expect(rows).toEqual([
        { id: expect.any(Number), measuredAt: "2026-10-10T11:05:00.000Z", zoneOffset: null, valueCm: 103.8 },
      ]);
    });

    it("returns readings ordered ascending within inclusive UTC-day bounds", async () => {
      await upsertWaistReadings(userId, [
        { measuredAt: "2026-10-21T00:00:00.000Z", zoneOffset: null, valueCm: 102 },
        { measuredAt: "2026-10-20T23:59:59.999Z", zoneOffset: null, valueCm: 101 },
        { measuredAt: "2026-10-20T00:00:00.000Z", zoneOffset: null, valueCm: 100.5 },
        { measuredAt: "2026-10-19T23:59:59.999Z", zoneOffset: null, valueCm: 99 },
      ]);

      const rows = await getWaistReadings(userId, "2026-10-20", "2026-10-20");

      expect(rows.map((r) => [r.measuredAt, r.valueCm])).toEqual([
        ["2026-10-20T00:00:00.000Z", 100.5],
        ["2026-10-20T23:59:59.999Z", 101],
      ]);
    });
  },
);
