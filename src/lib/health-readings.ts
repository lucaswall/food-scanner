// Stub — real implementation provided by worker-1 in src/lib/health-readings.ts
// This file exists only to satisfy TypeScript in this worktree.
// During merge, worker-1's implementation replaces this file entirely.
import type {
  GlucoseReadingInput,
  GlucoseReading,
  BloodPressureReadingInput,
  BloodPressureReading,
} from "@/types";

export async function upsertGlucoseReadings(
  _userId: string,
  _readings: GlucoseReadingInput[]
): Promise<number> {
  throw new Error("stub");
}

export async function upsertBloodPressureReadings(
  _userId: string,
  _readings: BloodPressureReadingInput[]
): Promise<number> {
  throw new Error("stub");
}

export async function getGlucoseReadings(
  _userId: string,
  _from: string,
  _to: string
): Promise<GlucoseReading[]> {
  throw new Error("stub");
}

export async function getBloodPressureReadings(
  _userId: string,
  _from: string,
  _to: string
): Promise<BloodPressureReading[]> {
  throw new Error("stub");
}
