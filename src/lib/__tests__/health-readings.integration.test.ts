/**
 * Integration: blood pressure heart-rate upsert semantics
 *
 * Proves against real Postgres that the (user_id, measured_at) upsert keeps a stored
 * heart rate when a re-push carries none (HealthHelper's Health Connect read-back sync
 * omits it), and overwrites it when the incoming reading does carry one.
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
import { upsertBloodPressureReadings, getBloodPressureReadings } from "@/lib/health-readings";
import type { BloodPressureReadingInput } from "@/types";

const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
if (INTEGRATION_DATABASE_URL) {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
}

// `.invalid` TLD is RFC-2606 reserved.
const EMAIL = "bp-heart-rate@health-readings-integration.invalid";
const DAY = "2026-03-01";

function reading(measuredAt: string, overrides: Partial<BloodPressureReadingInput> = {}): BloodPressureReadingInput {
  return {
    measuredAt,
    zoneOffset: null,
    systolic: 120,
    diastolic: 80,
    heartRate: null,
    bodyPosition: null,
    measurementLocation: null,
    ...overrides,
  };
}

describe.skipIf(!INTEGRATION_DATABASE_URL)(
  "health-readings: blood pressure heart rate upsert (integration)",
  () => {
    let userId = "";

    async function cleanup(): Promise<void> {
      const db = getDb();
      const stale = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, EMAIL));
      for (const { id } of stale) {
        await db.delete(schema.bloodPressureReadings).where(eq(schema.bloodPressureReadings.userId, id));
        await db.delete(schema.users).where(eq(schema.users.id, id));
      }
    }

    async function readingAt(measuredAt: string) {
      const rows = await getBloodPressureReadings(userId, DAY, DAY);
      return rows.find((r) => r.measuredAt === new Date(measuredAt).toISOString());
    }

    beforeAll(async () => {
      await cleanup();
      const [row] = await getDb()
        .insert(schema.users)
        .values({ email: EMAIL, name: "BP Heart Rate Integration" })
        .returning({ id: schema.users.id });
      userId = row!.id;
    });

    afterAll(async () => {
      await cleanup();
      await closeDb();
    });

    it("stores heartRate on insert and returns null when it was never provided", async () => {
      await upsertBloodPressureReadings(userId, [
        reading("2026-03-01T08:00:00.000Z", { heartRate: 72 }),
        reading("2026-03-01T09:00:00.000Z"),
      ]);

      expect(await readingAt("2026-03-01T08:00:00.000Z")).toEqual(expect.objectContaining({ heartRate: 72 }));
      expect(await readingAt("2026-03-01T09:00:00.000Z")).toEqual(expect.objectContaining({ heartRate: null }));
    });

    it("keeps the stored heartRate when a conflicting push carries none, while updating the other columns", async () => {
      await upsertBloodPressureReadings(userId, [
        reading("2026-03-01T10:00:00.000Z", { heartRate: 64 }),
      ]);
      await upsertBloodPressureReadings(userId, [
        reading("2026-03-01T10:00:00.000Z", { systolic: 125, diastolic: 82, bodyPosition: "sitting_down", heartRate: null }),
      ]);

      expect(await readingAt("2026-03-01T10:00:00.000Z")).toEqual(
        expect.objectContaining({ systolic: 125, diastolic: 82, bodyPosition: "sitting_down", heartRate: 64 }),
      );
    });

    it("overwrites the stored heartRate when a conflicting push carries one", async () => {
      await upsertBloodPressureReadings(userId, [
        reading("2026-03-01T11:00:00.000Z", { heartRate: 64 }),
      ]);
      await upsertBloodPressureReadings(userId, [
        reading("2026-03-01T11:00:00.000Z", { heartRate: 88 }),
      ]);

      expect(await readingAt("2026-03-01T11:00:00.000Z")).toEqual(expect.objectContaining({ heartRate: 88 }));
    });

    it("fills in heartRate on a row that previously had none", async () => {
      await upsertBloodPressureReadings(userId, [
        reading("2026-03-01T12:00:00.000Z"),
      ]);
      await upsertBloodPressureReadings(userId, [
        reading("2026-03-01T12:00:00.000Z", { heartRate: 70 }),
      ]);

      expect(await readingAt("2026-03-01T12:00:00.000Z")).toEqual(expect.objectContaining({ heartRate: 70 }));
    });
  },
);
