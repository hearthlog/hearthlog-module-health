import type { ReadRepositories } from '@hearthlog/sdk/data';
import type { CalorieEntry } from '../data/calories.js';
import { effectiveMealSlots, shiftLocalDate, type StoredMealSlot } from '../calories/logic.js';
import { diaryMeals, entrySum, nextMealSlot, type DiaryMeal } from './diary.js';
import type { HealthSources } from './day.js';
import { weekOf } from './day.js';
import { dayBudget, dayStatus, type DayBudget, type DayStatus } from './budget.js';

export type { DiaryMeal };

export interface WeekStripDay {
    date: string;
    eaten: number;
    budget: number;
    status: DayStatus;
}

/** An earlier meal offered again for the next empty slot. */
export interface MealSuggestion {
    slotId: string;
    /** The day it comes from. */
    from: string;
    entries: CalorieEntry[];
    calories: number;
    proteinG: number;
}

export interface DayWeight {
    latest: { weight: number; height: number; date: string } | null;
    /** Seven-day mean at the latest weigh-in. */
    trend: number | null;
    /** Kilograms a week over the last 30 days; null below three weigh-ins. */
    pace: number | null;
    /** Seven-day means over the last 30 days, oldest first. */
    means: { date: string; mean: number }[];
    weighIns30: number;
}

export interface DayView {
    date: string;
    meals: DiaryMeal[];
    budget: DayBudget;
    targets: { proteinG: number; carbsG: number; fatG: number };
    totals: { calories: number; proteinG: number; carbsG: number; fatG: number };
    steps: { steps: number; target: number } | null;
    week: WeekStripDay[];
    next: MealSuggestion | null;
    weight: DayWeight | null;
}

export async function loadDayView(
    repositories: ReadRepositories,
    sources: HealthSources,
    storedSlots: StoredMealSlot[],
    date: string,
): Promise<DayView> {
    const week = weekOf(date);
    const slots = effectiveMealSlots(storedSlots);
    const [entries, goal, budgets, activity, stepsGoal, latest] = await Promise.all([
        sources.meals ? repositories.calories.getCalorieEntriesForDate(date) : [],
        sources.meals ? repositories.calories.getLatestNutritionGoal(date) : null,
        sources.meals ? repositories.calories.getDailyBudgets(week[0], week[6]) : [],
        sources.activity ? repositories.activities.getActivityTrend(week[0], week[6]) : null,
        sources.activity ? repositories.activities.getLatestActivityGoal(date) : null,
        sources.body ? repositories.weightLogs.getLatestWeightLog(date) : null,
    ]);
    const meals = diaryMeals(slots, entries);
    const stepsKcal = new Map(activity?.days.map((day) => [day.date, day.activeCalories]) ?? []);
    const today = activity?.days.find((day) => day.date === date);
    const goalCalories = Number(goal?.calories_target ?? 0);
    const totals = {
        calories: meals.reduce((total, meal) => total + meal.calories, 0),
        proteinG: meals.reduce((total, meal) => total + meal.proteinG, 0),
        carbsG: meals.reduce((total, meal) => total + meal.carbsG, 0),
        fatG: meals.reduce((total, meal) => total + meal.fatG, 0),
    };

    const nextSlot = sources.meals ? nextMealSlot(meals) : null;
    const latestDate = latest ? String(latest.date).slice(0, 10) : null;
    const [earlier, trend, pace] = await Promise.all([
        nextSlot ? repositories.calories.getLastMealLike(date, nextSlot) : null,
        latestDate ? repositories.weightLogs.getWeightTrend(shiftLocalDate(latestDate, -30), latestDate) : null,
        latestDate ? repositories.weightLogs.getWeightPace(shiftLocalDate(latestDate, -30), latestDate) : null,
    ]);

    return {
        date,
        meals,
        budget: dayBudget(goalCalories, stepsKcal.get(date) ?? 0, totals.calories),
        targets: {
            proteinG: Number(goal?.protein_target_g ?? 0),
            carbsG: Number(goal?.carbs_target_g ?? 0),
            fatG: Number(goal?.fat_target_g ?? 0),
        },
        totals,
        steps: sources.activity ? { steps: today?.steps ?? 0, target: Number(stepsGoal?.steps_target ?? 0) } : null,
        week: week.map((day) => {
            const row = budgets.find((candidate) => candidate.date === day);
            const budget = row && row.goal > 0 ? row.goal + Math.round(stepsKcal.get(day) ?? 0) : 0;
            const eaten = Math.round(row?.calories ?? 0);
            return { date: day, eaten, budget, status: dayStatus(eaten, budget) };
        }),
        next: nextSlot && earlier && earlier.entries.length > 0 ? {
            slotId: nextSlot,
            from: earlier.date,
            entries: earlier.entries,
            calories: Math.round(entrySum(earlier.entries, 'calories')),
            proteinG: entrySum(earlier.entries, 'protein_g'),
        } : null,
        weight: sources.body ? {
            latest: latest ? { weight: Number(latest.weight), height: Number(latest.height), date: latestDate ?? '' } : null,
            trend: trend?.mean.at(-1)?.mean ?? null,
            pace,
            means: trend?.mean ?? [],
            weighIns30: trend?.weighIns.length ?? 0,
        } : null,
    };
}
