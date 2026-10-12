import { shiftDay, weekStartOf } from '@hearthlog/sdk/endless';
import type { ReadRepositories } from '@hearthlog/sdk/data';
import type { ActivityGoal, ActivityTrend } from '../data/activities.js';
import type { CalorieTrend, NutritionGoal } from '../data/calories.js';
import { weekOf, type HealthSources, type HealthWeekDay } from './day.js';

/** Which Health domains the tenant has; each is one source of the week strip's pips. */
export function healthSources(features: ReadonlySet<string>): HealthSources {
    return { meals: features.has('calories'), activity: features.has('activities'), body: features.has('bmi') };
}

/** The strip before its data arrives: seven quiet days. */
export function emptyHealthWeek(date: string): HealthWeekDay[] {
    return weekOf(date).map((day) => ({ date: day, calories: 0, proteinG: 0, steps: 0, exerciseMinutes: 0, weighed: false }));
}

export interface HealthWeekData {
    /** Seven days, Monday first, for the strip and the week panels. */
    week: HealthWeekDay[];
    /** The goals in force on the selected date; zero without one. */
    targets: { calories: number; steps: number };
    /** The week's per-day sums and SQL averages, when the tenant has the domain. */
    calorieWeek: CalorieTrend | null;
    activityWeek: ActivityTrend | null;
    nutritionGoal: NutritionGoal | null;
    activityGoal: ActivityGoal | null;
}

/** The steps goal comes first because the same query counts the days that reached it. */
async function readActivityWeek(repositories: ReadRepositories, date: string, weekStart: string, weekEnd: string) {
    const goal = await repositories.activities.getLatestActivityGoal(date);
    const trend = await repositories.activities.getActivityTrend(weekStart, weekEnd, Number(goal?.steps_target ?? 0));
    return { goal, trend };
}

/**
 * The Monday-first week around `date`, shared by every day-based Health page.
 * Sums, averages, and goal lookups are SQL aggregates from the owning
 * repositories; this only lays them out by day.
 */
export async function loadHealthWeek(
    repositories: ReadRepositories,
    sources: HealthSources,
    date: string,
): Promise<HealthWeekData> {
    const weekStart = weekStartOf(date);
    const weekEnd = shiftDay(weekStart, 6);
    const [calorieWeek, nutritionGoal, activityRead, weighInDates] = await Promise.all([
        sources.meals ? repositories.calories.getCalorieTrend(weekStart, weekEnd) : null,
        sources.meals ? repositories.calories.getLatestNutritionGoal(date) : null,
        sources.activity ? readActivityWeek(repositories, date, weekStart, weekEnd) : null,
        sources.body ? repositories.weightLogs.getWeighInDates(weekStart, weekEnd) : [],
    ]);
    const activityWeek = activityRead?.trend ?? null;
    const activityGoal = activityRead?.goal ?? null;
    const calorieByDate = new Map((calorieWeek?.days ?? []).map((day) => [day.date, day]));
    const activityByDate = new Map((activityWeek?.days ?? []).map((day) => [day.date, day]));
    const weighed = new Set(weighInDates);
    return {
        week: weekOf(date).map((day): HealthWeekDay => ({
            date: day,
            calories: calorieByDate.get(day)?.calories ?? 0,
            proteinG: calorieByDate.get(day)?.proteinG ?? 0,
            steps: activityByDate.get(day)?.steps ?? 0,
            exerciseMinutes: activityByDate.get(day)?.exerciseMinutes ?? 0,
            weighed: weighed.has(day),
        })),
        targets: {
            calories: Number(nutritionGoal?.calories_target ?? 0),
            steps: Number(activityGoal?.steps_target ?? 0),
        },
        calorieWeek,
        activityWeek,
        nutritionGoal,
        activityGoal,
    };
}
