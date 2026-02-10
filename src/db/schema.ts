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

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const fitbitTokens = pgTable("fitbit_tokens", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id).unique(),
  fitbitUserId: text("fitbit_user_id").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const fitbitCredentials = pgTable("fitbit_credentials", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id).unique(),
  fitbitClientId: text("fitbit_client_id").notNull(),
  encryptedClientSecret: text("encrypted_client_secret").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const customFoods = pgTable("custom_foods", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  foodName: text("food_name").notNull(),
  amount: numeric("amount").notNull(),
  unitId: integer("unit_id").notNull(),
  calories: integer("calories").notNull(),
  proteinG: numeric("protein_g").notNull(),
  carbsG: numeric("carbs_g").notNull(),
  fatG: numeric("fat_g").notNull(),
  fiberG: numeric("fiber_g").notNull(),
  sodiumMg: numeric("sodium_mg").notNull(),
  saturatedFatG: numeric("saturated_fat_g"),
  transFatG: numeric("trans_fat_g"),
  sugarsG: numeric("sugars_g"),
  caloriesFromFat: numeric("calories_from_fat"),
  fitbitFoodId: bigint("fitbit_food_id", { mode: "number" }),
  confidence: text("confidence").notNull(),
  notes: text("notes"),
  description: text("description"),
  keywords: text("keywords").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const foodLogEntries = pgTable("food_log_entries", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  customFoodId: integer("custom_food_id").notNull().references(() => customFoods.id),
  fitbitLogId: bigint("fitbit_log_id", { mode: "number" }),
  mealTypeId: integer("meal_type_id").notNull(),
  amount: numeric("amount").notNull(),
  unitId: integer("unit_id").notNull(),
  date: date("date").notNull(),
  time: time("time").notNull(),
  loggedAt: timestamp("logged_at", { withTimezone: true }).defaultNow().notNull(),
});
