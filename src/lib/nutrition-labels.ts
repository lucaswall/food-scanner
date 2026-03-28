import { eq, and, or, ilike, desc, sql, type Column } from "drizzle-orm";
import { getDb } from "@/db/index";
import { nutritionLabels } from "@/db/schema";
import type { NutritionLabel, NutritionLabelInput } from "@/types";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

const ACCENT_FROM = "áéíóúñüÁÉÍÓÚÑÜàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛãõÃÕ";
const ACCENT_TO   = "aeiounuAEIOUNUaeiouAEIOUaeiouAEIOUaoAO";

function unaccentIlike(column: Column, term: string) {
  const normalized = term.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return sql`translate(lower(${column}), ${ACCENT_FROM}, ${ACCENT_TO}) like ${"%" + normalized.toLowerCase() + "%"}`
}

function mapRow(row: Record<string, unknown>): NutritionLabel {
  return {
    id: row.id as number,
    userId: row.userId as string,
    brand: row.brand as string,
    productName: row.productName as string,
    variant: (row.variant as string | null) ?? null,
    servingSizeG: parseFloat(row.servingSizeG as string),
    servingSizeLabel: row.servingSizeLabel as string,
    calories: row.calories as number,
    proteinG: parseFloat(row.proteinG as string),
    carbsG: parseFloat(row.carbsG as string),
    fatG: parseFloat(row.fatG as string),
    fiberG: parseFloat(row.fiberG as string),
    sodiumMg: parseFloat(row.sodiumMg as string),
    saturatedFatG: row.saturatedFatG != null ? parseFloat(row.saturatedFatG as string) : null,
    transFatG: row.transFatG != null ? parseFloat(row.transFatG as string) : null,
    sugarsG: row.sugarsG != null ? parseFloat(row.sugarsG as string) : null,
    extraNutrients: (row.extraNutrients as Record<string, number> | null) ?? null,
    source: row.source as string,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

export async function searchLabels(
  userId: string,
  searchTerms: string[],
  log?: Logger,
): Promise<NutritionLabel[]> {
  const l = log ?? logger;
  const db = getDb();

  const termConditions = searchTerms.map((term) =>
    or(
      unaccentIlike(nutritionLabels.brand, term),
      unaccentIlike(nutritionLabels.productName, term),
      unaccentIlike(nutritionLabels.variant, term),
      unaccentIlike(nutritionLabels.notes, term),
    )
  );

  const rows = await db
    .select()
    .from(nutritionLabels)
    .where(and(eq(nutritionLabels.userId, userId), or(...termConditions)))
    .orderBy(desc(nutritionLabels.updatedAt))
    .limit(10);

  l.debug({ action: "search_labels", userId, searchTerms, count: rows.length }, "searched nutrition labels");
  return rows.map(mapRow);
}

export async function insertLabel(
  userId: string,
  data: NutritionLabelInput,
  log?: Logger,
): Promise<{ id: number; createdAt: Date }> {
  const l = log ?? logger;
  const db = getDb();

  const rows = await db
    .insert(nutritionLabels)
    .values({
      userId,
      brand: data.brand,
      productName: data.productName,
      variant: data.variant,
      servingSizeG: String(data.servingSizeG),
      servingSizeLabel: data.servingSizeLabel,
      calories: data.calories,
      proteinG: String(data.proteinG),
      carbsG: String(data.carbsG),
      fatG: String(data.fatG),
      fiberG: String(data.fiberG),
      sodiumMg: String(data.sodiumMg),
      saturatedFatG: data.saturatedFatG != null ? String(data.saturatedFatG) : null,
      transFatG: data.transFatG != null ? String(data.transFatG) : null,
      sugarsG: data.sugarsG != null ? String(data.sugarsG) : null,
      extraNutrients: data.extraNutrients,
      source: data.source,
      notes: data.notes,
    })
    .returning({ id: nutritionLabels.id, createdAt: nutritionLabels.createdAt });

  const row = rows[0];
  if (!row) throw new Error("Failed to insert nutrition label");

  l.info({ action: "insert_label", userId, labelId: row.id }, "inserted nutrition label");
  return { id: row.id, createdAt: row.createdAt };
}

export async function updateLabel(
  userId: string,
  labelId: number,
  data: Partial<NutritionLabelInput>,
  log?: Logger,
): Promise<NutritionLabel> {
  const l = log ?? logger;
  const db = getDb();

  const updateValues: Record<string, unknown> = { updatedAt: new Date() };
  if (data.brand !== undefined) updateValues.brand = data.brand;
  if (data.productName !== undefined) updateValues.productName = data.productName;
  if (data.variant !== undefined) updateValues.variant = data.variant;
  if (data.servingSizeG !== undefined) updateValues.servingSizeG = String(data.servingSizeG);
  if (data.servingSizeLabel !== undefined) updateValues.servingSizeLabel = data.servingSizeLabel;
  if (data.calories !== undefined) updateValues.calories = data.calories;
  if (data.proteinG !== undefined) updateValues.proteinG = String(data.proteinG);
  if (data.carbsG !== undefined) updateValues.carbsG = String(data.carbsG);
  if (data.fatG !== undefined) updateValues.fatG = String(data.fatG);
  if (data.fiberG !== undefined) updateValues.fiberG = String(data.fiberG);
  if (data.sodiumMg !== undefined) updateValues.sodiumMg = String(data.sodiumMg);
  if (data.saturatedFatG !== undefined) updateValues.saturatedFatG = data.saturatedFatG != null ? String(data.saturatedFatG) : null;
  if (data.transFatG !== undefined) updateValues.transFatG = data.transFatG != null ? String(data.transFatG) : null;
  if (data.sugarsG !== undefined) updateValues.sugarsG = data.sugarsG != null ? String(data.sugarsG) : null;
  if (data.extraNutrients !== undefined) updateValues.extraNutrients = data.extraNutrients;
  if (data.source !== undefined) updateValues.source = data.source;
  if (data.notes !== undefined) updateValues.notes = data.notes;

  const rows = await db
    .update(nutritionLabels)
    .set(updateValues)
    .where(and(eq(nutritionLabels.id, labelId), eq(nutritionLabels.userId, userId)))
    .returning();

  const row = rows[0];
  if (!row) throw new Error("Label not found");

  l.info({ action: "update_label", userId, labelId }, "updated nutrition label");
  return mapRow(row as Record<string, unknown>);
}

export async function deleteLabel(
  userId: string,
  labelId: number,
  log?: Logger,
): Promise<boolean> {
  const l = log ?? logger;
  const db = getDb();

  const rows = await db
    .delete(nutritionLabels)
    .where(and(eq(nutritionLabels.id, labelId), eq(nutritionLabels.userId, userId)))
    .returning({ id: nutritionLabels.id });

  if (rows.length === 0) {
    l.debug({ action: "delete_label_not_found", userId, labelId }, "label not found for deletion");
    return false;
  }

  l.info({ action: "delete_label", userId, labelId }, "deleted nutrition label");
  return true;
}

export async function getLabelById(
  userId: string,
  labelId: number,
  log?: Logger,
): Promise<NutritionLabel | null> {
  const l = log ?? logger;
  const db = getDb();

  const rows = await db
    .select()
    .from(nutritionLabels)
    .where(and(eq(nutritionLabels.id, labelId), eq(nutritionLabels.userId, userId)))
    .limit(1);

  if (rows.length === 0) {
    l.debug({ action: "get_label_by_id_not_found", userId, labelId }, "label not found");
    return null;
  }

  return mapRow(rows[0] as Record<string, unknown>);
}

export async function getAllLabels(
  userId: string,
  query?: string,
  log?: Logger,
): Promise<NutritionLabel[]> {
  const l = log ?? logger;
  const db = getDb();

  let whereClause;
  if (query) {
    whereClause = and(
      eq(nutritionLabels.userId, userId),
      or(
        unaccentIlike(nutritionLabels.brand, query),
        unaccentIlike(nutritionLabels.productName, query),
        unaccentIlike(nutritionLabels.variant, query),
        unaccentIlike(nutritionLabels.notes, query),
      ),
    );
  } else {
    whereClause = eq(nutritionLabels.userId, userId);
  }

  const rows = await db
    .select()
    .from(nutritionLabels)
    .where(whereClause)
    .orderBy(desc(nutritionLabels.updatedAt));

  l.debug({ action: "get_all_labels", userId, count: rows.length }, "fetched all nutrition labels");
  return rows.map(mapRow);
}

export async function findDuplicateLabel(
  userId: string,
  brand: string,
  productName: string,
  variant?: string | null,
  log?: Logger,
): Promise<NutritionLabel[]> {
  const l = log ?? logger;
  const db = getDb();

  const rows = await db
    .select()
    .from(nutritionLabels)
    .where(
      and(
        eq(nutritionLabels.userId, userId),
        ilike(nutritionLabels.brand, brand),
        ilike(nutritionLabels.productName, productName),
      ),
    )
    .orderBy(desc(nutritionLabels.updatedAt));

  l.debug({ action: "find_duplicate_label", userId, brand, productName, variant, count: rows.length }, "searched for duplicate labels");
  return rows.map(mapRow);
}
