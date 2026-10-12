import type { ReadRepositories } from '@hearthlog/sdk/data';
import type { CalorieEntry, CalorieMealCount, CalorieMealTotals, CalorieTrend, FoodItem, NutritionGoal } from '../data/calories.js';
import { shiftLocalDate, type StoredMealSlot } from './logic.js';
import type { HealthSources, HealthWeekDay } from '../health/day.js';
import { healthSources, loadHealthWeek } from '../health/week-data.js';

export const EMPTY_CALORIE_TOTALS = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };

/** This page is the Eat domain, so its own week is always read; the strip's other pips follow the tenant. */
export function nutritionSources(features: ReadonlySet<string>): HealthSources {
    return { ...healthSources(features), meals: true };
}

/** What the Nutrition list needs besides its days, which it reads itself as they scroll into view. */
export interface NutritionPageData {
    /** The day the list opens at. */
    selectedDate: string;
    today: string;
    sources: HealthSources;
    /** The earliest day with a meal; the list reaches back to its week. */
    firstLogged: string | null;
    foodItems: FoodItem[];
    recentFoodItemIds: string[];
    mealSlots: StoredMealSlot[];
}

/** Where an entry is being dragged: which day's meal it would land in. */
export interface MealDrag {
    entryId: string | null;
    active: boolean;
    dropDate: string | null;
    dropSlotId: string | null;
}

/** One day of the Nutrition list: its meals and the sums that open it. */
export interface NutritionDayBlock {
    date: string;
    /** The day's entries, oldest first. */
    entries: CalorieEntry[];
    totals: typeof EMPTY_CALORIE_TOTALS;
    /** Per-slot sums, grouped by SQL. */
    mealTotals: CalorieMealTotals[];
    /** Entries per slot the day before, for copying a meal forward. */
    yesterdayMealCounts: CalorieMealCount[];
    /** The goal in force on this day; SQL picks the winner. */
    goal: NutritionGoal | null;
}

export async function loadNutritionDay(repositories: ReadRepositories, date: string): Promise<NutritionDayBlock> {
    const calories = repositories.calories;
    const [entries, trend, mealTotals, yesterdayMealCounts, goal] = await Promise.all([
        calories.getCalorieEntriesForDate(date),
        calories.getCalorieTrend(date, date),
        calories.getCalorieMealTotalsForDate(date),
        calories.getCalorieMealCountsForDate(shiftLocalDate(date, -1)),
        calories.getLatestNutritionGoal(date),
    ]);
    return {
        date,
        entries,
        totals: trend.days.find((day) => day.date === date) ?? EMPTY_CALORIE_TOTALS,
        mealTotals,
        yesterdayMealCounts,
        goal,
    };
}

/** The week around the day in view: the strip's pips and the week chart with its averages. */
export interface NutritionSide {
    /** The Monday of the week. */
    weekStart: string;
    /** Seven days, Monday first. */
    week: HealthWeekDay[];
    targets: { calories: number; steps: number };
    /** The week's per-day sums and SQL averages. */
    trend: CalorieTrend;
    goal: NutritionGoal | null;
}

export const EMPTY_CALORIE_TREND: CalorieTrend = { days: [], trackedDays: 0, averageCalories: 0, averageProteinG: 0, maxCalories: 0 };

export async function loadNutritionSide(repositories: ReadRepositories, features: ReadonlySet<string>, date: string): Promise<NutritionSide> {
    const weekData = await loadHealthWeek(repositories, nutritionSources(features), date);
    return {
        weekStart: weekData.week[0].date,
        week: weekData.week,
        targets: weekData.targets,
        trend: weekData.calorieWeek ?? EMPTY_CALORIE_TREND,
        goal: weekData.nutritionGoal,
    };
}
