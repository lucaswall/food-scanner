import { getDb } from "@/db/index";
import { glucoseReadings, bloodPressureReadings } from "@/db/schema";
import { eq, and, between, asc } from "drizzle-orm";
import { logger } from "@/lib/logger";
import type { GlucoseReading, GlucoseReadingInput, BloodPressureReading, BloodPressureReadingInput } from "@/types";

export async function upsertGlucoseReadings(
  userId: string,
  readings: GlucoseReadingInput[]
): Promise<number> {
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
        zoneOffset: glucoseReadings.zoneOffset,
        valueMgDl: glucoseReadings.valueMgDl,
        relationToMeal: glucoseReadings.relationToMeal,
        mealType: glucoseReadings.mealType,
        specimenSource: glucoseReadings.specimenSource,
      },
    });

  logger.debug({ action: "upsert_glucose_readings", userId, count: readings.length }, "glucose readings upserted");
  return readings.length;
}

export async function upsertBloodPressureReadings(
  userId: string,
  readings: BloodPressureReadingInput[]
): Promise<number> {
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
        bodyPosition: r.bodyPosition,
        measurementLocation: r.measurementLocation,
      }))
    )
    .onConflictDoUpdate({
      target: [bloodPressureReadings.userId, bloodPressureReadings.measuredAt],
      set: {
        zoneOffset: bloodPressureReadings.zoneOffset,
        systolic: bloodPressureReadings.systolic,
        diastolic: bloodPressureReadings.diastolic,
        bodyPosition: bloodPressureReadings.bodyPosition,
        measurementLocation: bloodPressureReadings.measurementLocation,
      },
    });

  logger.debug({ action: "upsert_blood_pressure_readings", userId, count: readings.length }, "blood pressure readings upserted");
  return readings.length;
}

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
    .orderBy(asc(glucoseReadings.measuredAt));

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
    .orderBy(asc(bloodPressureReadings.measuredAt));

  logger.debug({ action: "get_blood_pressure_readings", userId, from, to, count: rows.length }, "blood pressure readings fetched");

  return rows.map((row) => ({
    id: row.id,
    measuredAt: row.measuredAt instanceof Date ? row.measuredAt.toISOString() : String(row.measuredAt),
    zoneOffset: row.zoneOffset ?? null,
    systolic: row.systolic,
    diastolic: row.diastolic,
    bodyPosition: row.bodyPosition ?? null,
    measurementLocation: row.measurementLocation ?? null,
  }));
}
