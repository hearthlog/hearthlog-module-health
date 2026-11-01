/**
 * The day's budget and the goal maths behind it. Pure functions: the pages
 * read sums from SQL and pass them in.
 *
 * The budget is the nutrition goal plus what the day's steps burned. A day
 * reads as over only past a tolerance, so a normal day never turns red.
 */

import { shiftLocalDate } from '../calories/logic.js';

/** A day more than this share over its budget reads as over. */
export const OVER_TOLERANCE = 0.05;

/** Energy in one kilogram of body weight change, the usual rule of thumb. */
export const KCAL_PER_KG = 7700;

export interface DayBudget {
    goal: number;
    steps: number;
    /** Goal plus steps; zero without a goal. */
    budget: number;
    eaten: number;
    /** Negative once over. */
    left: number;
}

export function dayBudget(goal: number, stepsCalories: number, eaten: number): DayBudget {
    const steps = goal > 0 ? Math.max(0, Math.round(stepsCalories)) : 0;
    const budget = goal > 0 ? goal + steps : 0;
    return { goal, steps, budget, eaten: Math.round(eaten), left: budget - Math.round(eaten) };
}

export type DayStatus = 'none' | 'under' | 'near' | 'over';

/** `over` only past the tolerance; `near` within it either side. */
export function dayStatus(eaten: number, budget: number): DayStatus {
    if (!(budget > 0) || !(eaten > 0)) return 'none';
    if (eaten > budget * (1 + OVER_TOLERANCE)) return 'over';
    if (eaten >= budget * (1 - OVER_TOLERANCE)) return 'near';
    return 'under';
}

/** One part of the budget bar, as a share of its whole. */
export interface BarPart {
    key: string;
    label: string;
    value: number;
    kind: 'eaten' | 'next' | 'over' | 'steps' | 'rest';
}

/**
 * The bar from left to right: what was eaten by meal, the usual next meal
 * waiting dashed, then what is still free, with the steps' share last. Past
 * the budget the bar grows by the excess instead.
 */
export function budgetBar(
    meals: readonly { key: string; label: string; calories: number }[],
    next: number,
    budget: DayBudget,
): { parts: BarPart[]; whole: number } {
    const eaten = meals.filter((meal) => meal.calories > 0).map((meal): BarPart => ({ key: meal.key, label: meal.label, value: meal.calories, kind: 'eaten' }));
    const sum = eaten.reduce((total, part) => total + part.value, 0);
    if (!(budget.budget > 0)) return { parts: eaten, whole: sum };
    if (sum >= budget.budget) {
        return { parts: [...eaten, { key: 'over', label: 'Over', value: 0, kind: 'over' }], whole: Math.max(sum, budget.budget) };
    }
    const free = budget.budget - sum;
    const waiting = Math.min(Math.max(0, next), free);
    const stepsShare = Math.min(budget.steps, free - waiting);
    const rest = free - waiting - stepsShare;
    const parts: BarPart[] = [...eaten];
    if (waiting > 0) parts.push({ key: 'next', label: 'Next meal', value: waiting, kind: 'next' });
    if (rest > 0) parts.push({ key: 'rest', label: 'Left', value: rest, kind: 'rest' });
    if (stepsShare > 0) parts.push({ key: 'steps', label: 'Steps', value: stepsShare, kind: 'steps' });
    return { parts, whole: budget.budget };
}

// ------------------------------------------------------------------ goal and pace

export const PACES = [
    { id: 'gentle', label: 'Gentle', kgPerWeek: 0.25 },
    { id: 'steady', label: 'Steady', kgPerWeek: 0.5 },
    { id: 'faster', label: 'Faster', kgPerWeek: 0.75 },
] as const;

export type PaceId = (typeof PACES)[number]['id'];

/** The daily-life choices map onto the calculator's activity levels; synced steps are added on top. */
export const DAILY_LIFE = [
    { level: 'inactive', label: 'Mostly sitting', detail: 'Desk work, little walking' },
    { level: 'low_active', label: 'Some walking', detail: 'Errands, stairs, a walk most days' },
    { level: 'active', label: 'On my feet', detail: 'Shop floor, teaching, care work' },
] as const;

/** The date a goal is reached at a steady pace; null when the pace leads away from it. */
export function arrivalDate(from: string, currentKg: number, goalKg: number, kgPerWeek: number): string | null {
    const toGo = currentKg - goalKg;
    if (Math.abs(toGo) < 0.05) return from;
    // A loss pace is negative; it must point toward the goal.
    if (!(kgPerWeek !== 0) || Math.sign(-kgPerWeek) !== Math.sign(toGo)) return null;
    const days = Math.ceil((Math.abs(toGo) / Math.abs(kgPerWeek)) * 7);
    return days > 3650 ? null : shiftLocalDate(from, days);
}

const round5 = (value: number) => Math.round(value / 5) * 5;

/**
 * Targets for a budget: protein by goal weight (1.6 g/kg, at least 60 g),
 * fat at 30 % of energy, carbs the rest. Rounded to 5 g.
 */
export function macroTargets(budget: number, goalKg: number): { proteinG: number; carbsG: number; fatG: number } {
    if (!(budget > 0)) return { proteinG: 0, carbsG: 0, fatG: 0 };
    const proteinG = round5(Math.max(60, goalKg * 1.6));
    const fatG = round5((budget * 0.3) / 9);
    const carbsG = Math.max(0, round5((budget - proteinG * 4 - fatG * 9) / 4));
    return { proteinG, carbsG, fatG };
}

/** Below this a daily budget needs care; the Goal page says so. */
export function lowBudgetFloor(sex: string): number {
    return sex === 'female' ? 1400 : 1700;
}

// ------------------------------------------------------------------ calibration

export interface Calibration {
    /** Kilograms per week the logged deficit predicts (negative is a loss). */
    expectedKgPerWeek: number;
    /** Kilograms per week the scale shows. */
    actualKgPerWeek: number;
    /** Energy a day that the estimate does not account for; positive means the days burn less than estimated. */
    gap: number;
    /** The goal that would have matched the scale, rounded to 10 kcal. */
    suggestedGoal: number;
}

/**
 * Compares what was logged with what the scale did. Needs three weeks of
 * logging and a weight pace; small gaps are noise and return null.
 */
export function calibration(input: {
    trackedDays: number;
    averageEaten: number;
    averageBudget: number;
    goal: number;
    actualKgPerWeek: number | null;
}): Calibration | null {
    const { trackedDays, averageEaten, averageBudget, goal, actualKgPerWeek } = input;
    if (trackedDays < 21 || actualKgPerWeek === null || !(averageBudget > 0) || !(goal > 0)) return null;
    // The budget is what the estimate says the days burn, steps included.
    const expectedKgPerWeek = ((averageEaten - averageBudget) * 7) / KCAL_PER_KG;
    const gap = Math.round(((actualKgPerWeek - expectedKgPerWeek) * KCAL_PER_KG) / 7);
    if (Math.abs(gap) < 100) return null;
    return { expectedKgPerWeek, actualKgPerWeek, gap, suggestedGoal: Math.round((goal - gap) / 10) * 10 };
}
