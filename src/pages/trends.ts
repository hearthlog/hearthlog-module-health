import type { ModuleLoadEvent } from "@hearthlog/sdk/runtime";
import { appClock, deferPage, tenant } from '@hearthlog/sdk/runtime';
import { queryDatabase } from '@hearthlog/sdk/data';
import { weekStartOf } from '@hearthlog/sdk/endless';
import { effectiveMealSlots, shiftLocalDate, toLocalDateString, type MealSlotView } from '../calories/logic.js';
import type { MealHabit, Staple } from '../data/calories.js';
import { calibration, dayStatus, OVER_TOLERANCE, type Calibration, type DayStatus } from '../health/budget.js';

export interface TrendDay {
    date: string;
    eaten: number;
    budget: number;
    status: DayStatus;
    proteinMet: boolean;
    logged: boolean;
}

export interface TrendWeek {
    start: string;
    /** Averages over the days with food logged. */
    eaten: number;
    budget: number;
    days: number;
    /** The seven-day mean at the week's last weigh-in. */
    weight: number | null;
}

export interface TrendsPageData {
    today: string;
    /** `2026-10`. */
    month: string;
    /** Mondays-first weeks covering the month. */
    grid: TrendDay[];
    summary: {
        averageEaten: number;
        averageBudget: number;
        logged: number;
        within: number;
        over: { date: string; by: number }[];
        proteinMet: number;
        weighIns: number;
        weightFrom: number | null;
        weightTo: number | null;
    };
    weeks: TrendWeek[];
    habits: (MealHabit & { label: string })[];
    staples: Staple[];
    calibration: Calibration | null;
    goal: number;
}

/** The month a visit opens on: the one that holds yesterday, the last whole day. */
export function defaultMonth(today: string): string {
    return shiftLocalDate(today, -1).slice(0, 7);
}

function monthEnd(month: string): string {
    const [year, number] = month.split('-').map(Number);
    const last = new Date(year, number, 0).getDate();
    return `${month}-${String(last).padStart(2, '0')}`;
}

function parseMonth(value: string | null, fallback: string): string {
    return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : fallback;
}

const EMPTY: Omit<TrendsPageData, 'today' | 'month'> = {
    grid: [],
    summary: { averageEaten: 0, averageBudget: 0, logged: 0, within: 0, over: [], proteinMet: 0, weighIns: 0, weightFrom: null, weightTo: null },
    weeks: [],
    habits: [],
    staples: [],
    calibration: null,
    goal: 0,
};

export const load = (event: ModuleLoadEvent) => {
    event.depends('app:calories');
    const activity = tenant.features.has('activities');
    const body = tenant.features.has('bmi');
    if (activity) event.depends('app:activities');
    if (body) event.depends('app:weight-logs');
    const fallbackToday = toLocalDateString();
    const initial: TrendsPageData = { today: fallbackToday, month: parseMonth(event.url.searchParams.get('month'), defaultMonth(fallbackToday)), ...EMPTY };
    return deferPage(event, initial, async (): Promise<TrendsPageData> => {
        const today = toLocalDateString(await appClock.ready());
        const month = parseMonth(event.url.searchParams.get('month'), defaultMonth(today));
        const first = `${month}-01`;
        const last = monthEnd(month);
        const gridStart = weekStartOf(first);
        const gridEnd = shiftLocalDate(weekStartOf(last), 6);
        // Eight weeks back from the month's last week, and four weeks of calibration up to yesterday.
        const weeksStart = shiftLocalDate(weekStartOf(last), -49);
        const calibrationEnd = last < today ? last : shiftLocalDate(today, -1);
        const calibrationStart = shiftLocalDate(calibrationEnd, -27);
        const rangeStart = [gridStart, weeksStart, calibrationStart].sort()[0];

        return queryDatabase(async (repositories) => {
            const [budgets, steps, weights, habits, staples, slots, pace, goal] = await Promise.all([
                repositories.calories.getDailyBudgets(rangeStart, gridEnd),
                activity ? repositories.activities.getActivityTrend(rangeStart, gridEnd) : null,
                body ? repositories.weightLogs.getWeightTrend(rangeStart, gridEnd) : null,
                repositories.calories.getMealHabits(first, last),
                repositories.calories.getStaples(first, last, 6),
                repositories.calories.getMealSlots(),
                body ? repositories.weightLogs.getWeightPace(calibrationStart, calibrationEnd) : null,
                repositories.calories.getLatestNutritionGoal(today),
            ]);
            const stepsKcal = new Map(steps?.days.map((day) => [day.date, day.activeCalories]) ?? []);
            const days = budgets.map((row): TrendDay => {
                const budget = row.goal > 0 ? row.goal + Math.round(stepsKcal.get(row.date) ?? 0) : 0;
                const eaten = Math.round(row.calories);
                return {
                    date: row.date,
                    eaten,
                    budget,
                    status: dayStatus(eaten, budget),
                    proteinMet: row.proteinTargetG > 0 && row.proteinG >= row.proteinTargetG,
                    logged: row.entries > 0,
                };
            });
            const inMonth = days.filter((day) => day.date >= first && day.date <= last && day.date < today && day.logged);
            const average = (values: number[]) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
            const meansInMonth = weights?.mean.filter((point) => point.date >= first && point.date <= last) ?? [];

            const weeks: TrendWeek[] = [];
            for (let start = weeksStart; start <= weekStartOf(last); start = shiftLocalDate(start, 7)) {
                const end = shiftLocalDate(start, 6);
                const logged = days.filter((day) => day.date >= start && day.date <= end && day.date < today && day.logged);
                const mean = weights?.mean.filter((point) => point.date >= start && point.date <= end).at(-1)?.mean ?? null;
                weeks.push({ start, eaten: average(logged.map((day) => day.eaten)), budget: average(logged.map((day) => day.budget).filter((value) => value > 0)), days: logged.length, weight: mean });
            }

            const calibrationDays = days.filter((day) => day.date >= calibrationStart && day.date <= calibrationEnd && day.logged && day.budget > 0);
            const slotViews: MealSlotView[] = effectiveMealSlots(slots);
            return {
                today,
                month,
                grid: days.filter((day) => day.date >= gridStart && day.date <= gridEnd),
                summary: {
                    averageEaten: average(inMonth.map((day) => day.eaten)),
                    averageBudget: average(inMonth.map((day) => day.budget).filter((value) => value > 0)),
                    logged: inMonth.length,
                    within: inMonth.filter((day) => day.budget > 0 && Math.abs(day.eaten - day.budget) <= day.budget * OVER_TOLERANCE).length,
                    over: inMonth.filter((day) => day.status === 'over').map((day) => ({ date: day.date, by: day.eaten - day.budget })),
                    proteinMet: inMonth.filter((day) => day.proteinMet).length,
                    weighIns: weights?.weighIns.filter((point) => point.date >= first && point.date <= last).length ?? 0,
                    weightFrom: meansInMonth[0]?.mean ?? null,
                    weightTo: meansInMonth.at(-1)?.mean ?? null,
                },
                weeks,
                habits: habits.map((habit) => ({ ...habit, label: slotViews.find((slot) => slot.id === habit.mealType)?.label ?? habit.mealType })),
                staples,
                calibration: calibration({
                    trackedDays: calibrationDays.length,
                    averageEaten: average(calibrationDays.map((day) => day.eaten)),
                    averageBudget: average(calibrationDays.map((day) => day.budget)),
                    goal: Number(goal?.calories_target ?? 0),
                    actualKgPerWeek: pace,
                }),
                goal: Number(goal?.calories_target ?? 0),
            };
        });
    });
};
