import {
  pgTable,
  uuid,
  text,
  timestamp,
  serial,
  numeric,
  integer,
  bigint,
  date,
  time,
} from "drizzle-orm/pg-core";

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const fitbitTokens = pgTable("fitbit_tokens", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  fitbitUserId: text("fitbit_user_id").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const customFoods = pgTable("custom_foods", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  foodName: text("food_name").notNull(),
  amount: numeric("amount").notNull(),
  unitId: integer("unit_id").notNull(),
  calories: integer("calories").notNull(),
  proteinG: numeric("protein_g").notNull(),
  carbsG: numeric("carbs_g").notNull(),
  fatG: numeric("fat_g").notNull(),
  fiberG: numeric("fiber_g").notNull(),
  sodiumMg: numeric("sodium_mg").notNull(),
  fitbitFoodId: bigint("fitbit_food_id", { mode: "number" }),
  confidence: text("confidence").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const foodLogEntries = pgTable("food_log_entries", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  customFoodId: integer("custom_food_id").notNull().references(() => customFoods.id),
  fitbitLogId: bigint("fitbit_log_id", { mode: "number" }),
  mealTypeId: integer("meal_type_id").notNull(),
  amount: numeric("amount").notNull(),
  unitId: integer("unit_id").notNull(),
  date: date("date").notNull(),
  time: time("time"),
  loggedAt: timestamp("logged_at", { withTimezone: true }).defaultNow().notNull(),
});
