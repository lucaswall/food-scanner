import { getDb } from "@/db/index";
import { glucoseReadings, bloodPressureReadings, hydrationReadings, waistReadings } from "@/db/schema";
import { eq, and, between, asc, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { MAX_READINGS_ROWS, READINGS_LIMIT_EXCEEDED_MESSAGE } from "@/lib/reading-validation";
import type { GlucoseReading, GlucoseReadingInput, BloodPressureReading, BloodPressureReadingInput, HydrationReading, HydrationReadingInput, WaistReading, WaistReadingInput } from "@/types";

/**
 * Collapses readings that share the same instant (last one wins). A single INSERT ... ON CONFLICT
 * DO UPDATE cannot touch the same conflict target twice ("cannot affect row a second time").
 */
function dedupeByMeasuredAt<T extends { measuredAt: string }>(readings: T[]): T[] {
  const byInstant = new Map<number, T>();
  for (const r of readings) {
    const key = new Date(r.measuredAt).getTime();
    byInstant.delete(key); // re-insert so ordering follows the last occurrence
    byInstant.set(key, r);
  }
  return [...byInstant.values()];
}

/** Throws when the range holds more rows than a single response may carry (never truncates silently). */
function assertWithinRowLimit(rows: unknown[]): void {
  if (rows.length > MAX_READINGS_ROWS) throw new Error(READINGS_LIMIT_EXCEEDED_MESSAGE);
}

export async function upsertGlucoseReadings(
  userId: string,
  input: GlucoseReadingInput[]
): Promise<number> {
  const readings = dedupeByMeasuredAt(input);
  if (readings.length === 0) return 0;

  await getDb()
    .insert(glucoseReadings)
    .values(
      readings.map((r) => ({
        userId,
        measuredAt: new Date(r.measuredAt),
        zoneOffset: r.zoneOffset,
        valueMgDl: String(r.valueMgDl),
        relationToMeal: r.relationToMeal,
        mealType: r.mealType,
        specimenSource: r.specimenSource,
      }))
    )
    .onConflictDoUpdate({
      target: [glucoseReadings.userId, glucoseReadings.measuredAt],
      set: {
        zoneOffset: sql`excluded.zone_offset`,
        valueMgDl: sql`excluded.value_mg_dl`,
        relationToMeal: sql`excluded.relation_to_meal`,
        mealType: sql`excluded.meal_type`,
        specimenSource: sql`excluded.specimen_source`,
      },
    });

  logger.debug({ action: "upsert_glucose_readings", userId, count: readings.length }, "glucose readings upserted");
  return readings.length;
}

export async function upsertBloodPressureReadings(
  userId: string,
  input: BloodPressureReadingInput[]
): Promise<number> {
  const readings = dedupeByMeasuredAt(input);
  if (readings.length === 0) return 0;

  await getDb()
    .insert(bloodPressureReadings)
    .values(
      readings.map((r) => ({
        userId,
        measuredAt: new Date(r.measuredAt),
        zoneOffset: r.zoneOffset,
        systolic: r.systolic,
        diastolic: r.diastolic,
        heartRate: r.heartRate,
        bodyPosition: r.bodyPosition,
        measurementLocation: r.measurementLocation,
      }))
    )
    .onConflictDoUpdate({
      target: [bloodPressureReadings.userId, bloodPressureReadings.measuredAt],
      set: {
        zoneOffset: sql`excluded.zone_offset`,
        systolic: sql`excluded.systolic`,
        diastolic: sql`excluded.diastolic`,
        // Health Connect read-back re-pushes carry no heart rate: never let them wipe a stored one.
        heartRate: sql`coalesce(excluded.heart_rate, ${bloodPressureReadings.heartRate})`,
        bodyPosition: sql`excluded.body_position`,
        measurementLocation: sql`excluded.measurement_location`,
      },
    });

  logger.debug({ action: "upsert_blood_pressure_readings", userId, count: readings.length }, "blood pressure readings upserted");
  return readings.length;
}

/** Query glucose readings by date range. Dates are interpreted as UTC calendar days. */
export async function getGlucoseReadings(
  userId: string,
  from: string,
  to: string
): Promise<GlucoseReading[]> {
  const fromTs = new Date(`${from}T00:00:00.000Z`);
  const toTs = new Date(`${to}T23:59:59.999Z`);

  const rows = await getDb()
    .select()
    .from(glucoseReadings)
    .where(
      and(
        eq(glucoseReadings.userId, userId),
        between(glucoseReadings.measuredAt, fromTs, toTs)
      )
    )
    .orderBy(asc(glucoseReadings.measuredAt))
    .limit(MAX_READINGS_ROWS + 1);
  assertWithinRowLimit(rows);

  logger.debug({ action: "get_glucose_readings", userId, from, to, count: rows.length }, "glucose readings fetched");

  return rows.map((row) => ({
    id: row.id,
    measuredAt: row.measuredAt instanceof Date ? row.measuredAt.toISOString() : String(row.measuredAt),
    zoneOffset: row.zoneOffset ?? null,
    valueMgDl: Number(row.valueMgDl),
    relationToMeal: row.relationToMeal ?? null,
    mealType: row.mealType ?? null,
    specimenSource: row.specimenSource ?? null,
  }));
}

export async function upsertHydrationReadings(
  userId: string,
  input: HydrationReadingInput[]
): Promise<number> {
  const readings = dedupeByMeasuredAt(input);
  if (readings.length === 0) return 0;

  await getDb()
    .insert(hydrationReadings)
    .values(
      readings.map((r) => ({
        userId,
        measuredAt: new Date(r.measuredAt),
        zoneOffset: r.zoneOffset,
        volumeMl: r.volumeMl,
      }))
    )
    .onConflictDoUpdate({
      target: [hydrationReadings.userId, hydrationReadings.measuredAt],
      set: {
        zoneOffset: sql`excluded.zone_offset`,
        volumeMl: sql`excluded.volume_ml`,
      },
    });

  logger.debug({ action: "upsert_hydration_readings", userId, count: readings.length }, "hydration readings upserted");
  return readings.length;
}

/** Query blood pressure readings by date range. Dates are interpreted as UTC calendar days. */
export async function getBloodPressureReadings(
  userId: string,
  from: string,
  to: string
): Promise<BloodPressureReading[]> {
  const fromTs = new Date(`${from}T00:00:00.000Z`);
  const toTs = new Date(`${to}T23:59:59.999Z`);

  const rows = await getDb()
    .select()
    .from(bloodPressureReadings)
    .where(
      and(
        eq(bloodPressureReadings.userId, userId),
        between(bloodPressureReadings.measuredAt, fromTs, toTs)
      )
    )
    .orderBy(asc(bloodPressureReadings.measuredAt))
    .limit(MAX_READINGS_ROWS + 1);
  assertWithinRowLimit(rows);

  logger.debug({ action: "get_blood_pressure_readings", userId, from, to, count: rows.length }, "blood pressure readings fetched");

  return rows.map((row) => ({
    id: row.id,
    measuredAt: row.measuredAt instanceof Date ? row.measuredAt.toISOString() : String(row.measuredAt),
    zoneOffset: row.zoneOffset ?? null,
    systolic: row.systolic,
    diastolic: row.diastolic,
    heartRate: row.heartRate ?? null,
    bodyPosition: row.bodyPosition ?? null,
    measurementLocation: row.measurementLocation ?? null,
  }));
}

/** Query hydration readings by date range. Dates are interpreted as UTC calendar days. */
export async function getHydrationReadings(
  userId: string,
  from: string,
  to: string
): Promise<HydrationReading[]> {
  const fromTs = new Date(`${from}T00:00:00.000Z`);
  const toTs = new Date(`${to}T23:59:59.999Z`);

  const rows = await getDb()
    .select()
    .from(hydrationReadings)
    .where(
      and(
        eq(hydrationReadings.userId, userId),
        between(hydrationReadings.measuredAt, fromTs, toTs)
      )
    )
    .orderBy(asc(hydrationReadings.measuredAt))
    .limit(MAX_READINGS_ROWS + 1);
  assertWithinRowLimit(rows);

  logger.debug({ action: "get_hydration_readings", userId, from, to, count: rows.length }, "hydration readings fetched");

  return rows.map((row) => ({
    id: row.id,
    measuredAt: row.measuredAt instanceof Date ? row.measuredAt.toISOString() : String(row.measuredAt),
    zoneOffset: row.zoneOffset ?? null,
    volumeMl: row.volumeMl,
  }));
}

/** Waist circumference is stored at 0.1 cm precision. */
function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function upsertWaistReadings(
  userId: string,
  input: WaistReadingInput[]
): Promise<number> {
  const readings = dedupeByMeasuredAt(input);
  if (readings.length === 0) return 0;

  await getDb()
    .insert(waistReadings)
    .values(
      readings.map((r) => ({
        userId,
        measuredAt: new Date(r.measuredAt),
        zoneOffset: r.zoneOffset,
        valueCm: String(roundToTenth(r.valueCm)),
      }))
    )
    .onConflictDoUpdate({
      target: [waistReadings.userId, waistReadings.measuredAt],
      set: {
        zoneOffset: sql`excluded.zone_offset`,
        valueCm: sql`excluded.value_cm`,
      },
    });

  logger.debug({ action: "upsert_waist_readings", userId, count: readings.length }, "waist readings upserted");
  return readings.length;
}

/** Query waist readings by date range. Dates are interpreted as UTC calendar days. */
export async function getWaistReadings(
  userId: string,
  from: string,
  to: string
): Promise<WaistReading[]> {
  const fromTs = new Date(`${from}T00:00:00.000Z`);
  const toTs = new Date(`${to}T23:59:59.999Z`);

  const rows = await getDb()
    .select()
    .from(waistReadings)
    .where(
      and(
        eq(waistReadings.userId, userId),
        between(waistReadings.measuredAt, fromTs, toTs)
      )
    )
    .orderBy(asc(waistReadings.measuredAt))
    .limit(MAX_READINGS_ROWS + 1);
  assertWithinRowLimit(rows);

  logger.debug({ action: "get_waist_readings", userId, from, to, count: rows.length }, "waist readings fetched");

  return rows.map((row) => ({
    id: row.id,
    measuredAt: row.measuredAt instanceof Date ? row.measuredAt.toISOString() : String(row.measuredAt),
    zoneOffset: row.zoneOffset ?? null,
    valueCm: Number(row.valueCm),
  }));
}
