import type { BucketLoader } from '@hearthlog/sdk/endless';
import { queryDatabase, type ReadRepositories } from '@hearthlog/sdk/data';
import type { HealthTimelineRow, UsualPace } from '../data/health-day.js';
import { shiftLocalDate } from '../calories/logic.js';
import type { HealthBody, HealthSources, HealthWeekDay } from './day.js';
import { loadHealthWeek } from './week-data.js';

/**
 * Reads a batch of days in one session. Every day is one block of an endless
 * Health list; the days of a batch are read side by side.
 */
export function dayBlocks<T>(read: (repositories: ReadRepositories, date: string) => Promise<T>): BucketLoader<T> {
    return (keys) => queryDatabase(async (repositories) => new Map(
        await Promise.all(keys.map(async (date) => [date, await read(repositories, date)] as const)),
    ));
}

/** One day of the Health list: its log and the three numbers that open it. */
export interface HealthDayBlock {
    date: string;
    timeline: HealthTimelineRow[];
    /** The goals in force on this day; zero without one. */
    targets: { calories: number; steps: number };
    eat: { calories: number; proteinG: number; carbsG: number; fatG: number; target: number } | null;
    move: { steps: number; stepsTarget: number; exerciseMinutes: number; activeCalories: number } | null;
    /** The latest weigh-in through this day, with its change against 30 days before it. */
    body: Omit<HealthBody, 'trend'> | null;
    /** What earlier days looked like by each time of day; null when off or without enough tracked days. */
    usualPace: UsualPace | null;
}

const USUAL_HOURS = Array.from({ length: 19 }, (_, index) => `${String(index + 5).padStart(2, '0')}:00`);

/**
 * The usual pace is sampled at every entry, at now, and on the hour, so the
 * gutters and the phone charts each find a value where they draw.
 */
function usualPaceTimes(timeline: readonly HealthTimelineRow[], nowTime: string | null): string[] {
    return [...new Set([
        ...timeline.map((row) => row.loggedAt.slice(11, 16)),
        ...(nowTime ? [nowTime] : []),
        ...USUAL_HOURS,
    ])].sort();
}

export async function loadHealthDayBlock(
    repositories: ReadRepositories,
    sources: HealthSources,
    date: string,
    options: { now: Date; today: string; usualPace: boolean },
): Promise<HealthDayBlock> {
    const [timeline, nutritionGoal, activityGoal, eatTrend, moveTrend, weightLog] = await Promise.all([
        repositories.healthDay.getTimeline(date, { meals: sources.meals, activity: sources.activity }),
        sources.meals ? repositories.calories.getLatestNutritionGoal(date) : null,
        sources.activity ? repositories.activities.getLatestActivityGoal(date) : null,
        sources.meals ? repositories.calories.getCalorieTrend(date, date) : null,
        sources.activity ? repositories.activities.getActivityTrend(date, date) : null,
        sources.body ? repositories.weightLogs.getLatestWeightLog(date) : null,
    ]);
    // The change hangs off the latest weigh-in's own date.
    const latestDate = weightLog ? String(weightLog.date).slice(0, 10) : null;
    const nowTime = date === options.today ? options.now.toTimeString().slice(0, 5) : null;
    const [baseline, usualPace] = await Promise.all([
        latestDate && weightLog ? repositories.weightLogs.getFirstWeightLogSince(shiftLocalDate(latestDate, -30), weightLog.id) : null,
        sources.meals && options.usualPace ? repositories.healthDay.getUsualPace(date, usualPaceTimes(timeline, nowTime)) : null,
    ]);
    const eatDay = eatTrend?.days.find((day) => day.date === date);
    const moveDay = moveTrend?.days.find((day) => day.date === date);
    const targets = { calories: Number(nutritionGoal?.calories_target ?? 0), steps: Number(activityGoal?.steps_target ?? 0) };
    return {
        date,
        timeline,
        targets,
        eat: sources.meals ? {
            calories: eatDay?.calories ?? 0,
            proteinG: eatDay?.proteinG ?? 0,
            carbsG: eatDay?.carbsG ?? 0,
            fatG: eatDay?.fatG ?? 0,
            target: targets.calories,
        } : null,
        move: sources.activity ? {
            steps: moveDay?.steps ?? 0,
            stepsTarget: targets.steps,
            exerciseMinutes: moveDay?.exerciseMinutes ?? 0,
            activeCalories: moveDay?.activeCalories ?? 0,
        } : null,
        body: weightLog ? {
            weight: Number(weightLog.weight),
            height: Number(weightLog.height),
            date: latestDate ?? '',
            delta: baseline ? Number(weightLog.weight) - Number(baseline.weight) : null,
        } : null,
        usualPace,
    };
}

/** The week around the day in view: the strip's pips and the side panel's charts. */
export interface HealthSide {
    /** The Monday of the week. */
    weekStart: string;
    /** Seven days, Monday first. */
    week: HealthWeekDay[];
    targets: { calories: number; steps: number };
    /** SQL averages over the days of the week that have something logged. */
    averages: { calories: number; steps: number };
    body: HealthBody | null;
}

export async function loadHealthSide(repositories: ReadRepositories, sources: HealthSources, date: string): Promise<HealthSide> {
    const [weekData, weightLog] = await Promise.all([
        loadHealthWeek(repositories, sources, date),
        sources.body ? repositories.weightLogs.getLatestWeightLog(date) : null,
    ]);
    // The trend and its 30-day baseline hang off the latest weigh-in's own date.
    const latestDate = weightLog ? String(weightLog.date).slice(0, 10) : null;
    const [baseline, trend] = latestDate && weightLog
        ? await Promise.all([
            repositories.weightLogs.getFirstWeightLogSince(shiftLocalDate(latestDate, -30), weightLog.id),
            repositories.weightLogs.getWeightTrend(shiftLocalDate(latestDate, -30), latestDate),
        ])
        : [null, null];
    return {
        weekStart: weekData.week[0].date,
        week: weekData.week,
        targets: weekData.targets,
        averages: {
            calories: weekData.calorieWeek?.averageCalories ?? 0,
            steps: weekData.activityWeek?.averageSteps ?? 0,
        },
        body: sources.body && weightLog ? {
            weight: Number(weightLog.weight),
            height: Number(weightLog.height),
            date: latestDate ?? '',
            delta: baseline ? Number(weightLog.weight) - Number(baseline.weight) : null,
            trend: trend?.mean ?? [],
        } : null,
    };
}
