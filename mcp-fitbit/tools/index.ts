import { schema as authenticateSchema, authenticate } from './authenticate.js';
import { schema as getProfileSchema, getProfile } from './get_profile.js';
import { schema as getFoodLogSchema, getFoodLog } from './get_food_log.js';
import { schema as getWaterLogSchema, getWaterLog } from './get_water_log.js';
import {
  schema as getActivitySummarySchema,
  getActivitySummary,
} from './get_activity_summary.js';
import { schema as getSleepLogSchema, getSleepLog } from './get_sleep_log.js';
import { schema as getDevicesSchema, getDevices } from './get_devices.js';
import {
  schema as getTimeSeriesSchema,
  getTimeSeries,
} from './get_time_series.js';
import { schema as getFoodUnitsSchema, getFoodUnits } from './get_food_units.js';
import { schema as getFoodGoalsSchema, getFoodGoals } from './get_food_goals.js';
import { schema as getWaterGoalSchema, getWaterGoal } from './get_water_goal.js';
import { schema as getFavoriteFoodsSchema, getFavoriteFoods } from './get_favorite_foods.js';
import { schema as getFrequentFoodsSchema, getFrequentFoods } from './get_frequent_foods.js';
import { schema as getRecentFoodsSchema, getRecentFoods } from './get_recent_foods.js';
import { schema as getMealsSchema, getMeals } from './get_meals.js';
import { schema as getFoodLocalesSchema, getFoodLocales } from './get_food_locales.js';
import { schema as getWeightLogSchema, getWeightLog } from './get_weight_log.js';
import { schema as getBodyFatLogSchema, getBodyFatLog } from './get_body_fat_log.js';
import { schema as getBodyGoalsSchema, getBodyGoals } from './get_body_goals.js';
import { schema as getBreathingRateSchema, getBreathingRate } from './get_breathing_rate.js';
import { schema as getSpO2Schema, getSpO2 } from './get_spo2.js';
import { schema as getCardioScoreSchema, getCardioScore } from './get_cardio_score.js';
import { schema as getHrvSchema, getHrv } from './get_hrv.js';
import { schema as getTemperatureSchema, getTemperature } from './get_temperature.js';
import type { Tool } from './types.js';

// Handler casts needed: each tool handler has a specific input type,
// but the Tool interface uses unknown for the registry array
export const tools: Tool[] = [
  { ...authenticateSchema, handler: authenticate as Tool['handler'] },
  { ...getProfileSchema, handler: getProfile as Tool['handler'] },
  { ...getFoodLogSchema, handler: getFoodLog as Tool['handler'] },
  { ...getWaterLogSchema, handler: getWaterLog as Tool['handler'] },
  { ...getActivitySummarySchema, handler: getActivitySummary as Tool['handler'] },
  { ...getSleepLogSchema, handler: getSleepLog as Tool['handler'] },
  { ...getDevicesSchema, handler: getDevices as Tool['handler'] },
  { ...getTimeSeriesSchema, handler: getTimeSeries as Tool['handler'] },
  // Nutrition
  { ...getFoodUnitsSchema, handler: getFoodUnits as Tool['handler'] },
  { ...getFoodGoalsSchema, handler: getFoodGoals as Tool['handler'] },
  { ...getWaterGoalSchema, handler: getWaterGoal as Tool['handler'] },
  { ...getFavoriteFoodsSchema, handler: getFavoriteFoods as Tool['handler'] },
  { ...getFrequentFoodsSchema, handler: getFrequentFoods as Tool['handler'] },
  { ...getRecentFoodsSchema, handler: getRecentFoods as Tool['handler'] },
  { ...getMealsSchema, handler: getMeals as Tool['handler'] },
  { ...getFoodLocalesSchema, handler: getFoodLocales as Tool['handler'] },
  // Body
  { ...getWeightLogSchema, handler: getWeightLog as Tool['handler'] },
  { ...getBodyFatLogSchema, handler: getBodyFatLog as Tool['handler'] },
  { ...getBodyGoalsSchema, handler: getBodyGoals as Tool['handler'] },
  // Health metrics
  { ...getBreathingRateSchema, handler: getBreathingRate as Tool['handler'] },
  { ...getSpO2Schema, handler: getSpO2 as Tool['handler'] },
  { ...getCardioScoreSchema, handler: getCardioScore as Tool['handler'] },
  { ...getHrvSchema, handler: getHrv as Tool['handler'] },
  { ...getTemperatureSchema, handler: getTemperature as Tool['handler'] },
];
