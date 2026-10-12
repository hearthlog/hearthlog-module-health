import type { ReadRepositories } from '@hearthlog/sdk/data';
import type { ActivityDailyTotals, ActivityEntryRow, ActivityGoal, ActivitySession, ActivityTrend } from '../data/activities.js';
import type { HealthSources, HealthWeekDay } from '../health/day.js';
import { healthSources, loadHealthWeek } from '../health/week-data.js';
import { shiftDay, weekStartOf } from '@hearthlog/sdk/endless';

export const EMPTY_ACTIVITY_TREND: ActivityTrend = {
    days: [],
    weekTotals: { steps: 0, exerciseMinutes: 0, workoutSessions: 0, activeCalories: 0 },
    trackedDays: 0,
    daysAtGoal: 0,
    averageSteps: 0,
    maxSteps: 0,
};

/** This page is the Move domain, so its own week is always read; the strip's other pips follow the tenant. */
export function activitySources(features: ReadonlySet<string>): HealthSources {
    return { ...healthSources(features), activity: true };
}

/** What the Activity list needs besides its days, which it reads itself as they scroll into view. */
export interface ActivityPageData {
    /** The day the list opens at. */
    selectedDate: string;
    today: string;
    sources: HealthSources;
    /** The earliest day with an activity; the list reaches back to its week. */
    firstLogged: string | null;
    /** The latest weigh-in, for estimating the calories of a workout. */
    latestWeightLog: { weight: number } | null;
}

/** One day of the Activity list: its diary and the sums that open it. */
export interface ActivityDayBlock {
    date: string;
    /** The day's entries, oldest first. */
    entries: ActivityEntryRow[];
    totals: ActivityDailyTotals;
    /** The goal in force on this day; SQL picks the winner. */
    goal: ActivityGoal | null;
}

export async function loadActivityDay(repositories: ReadRepositories, date: string): Promise<ActivityDayBlock> {
    const [entries, trend, goal] = await Promise.all([
        repositories.activities.getActivityEntriesForDate(date),
        repositories.activities.getActivityTrend(date, date),
        repositories.activities.getLatestActivityGoal(date),
    ]);
    return {
        date,
        entries,
        totals: trend.days.find((day) => day.date === date) ?? { date, steps: 0, exerciseMinutes: 0, workoutSessions: 0, activeCalories: 0 },
        goal,
    };
}

/** The week around the day in view: the strip's pips, the week chart, and the exercise ladder. */
export interface ActivitySide {
    /** The Monday of the week. */
    weekStart: string;
    /** Seven days, Monday first. */
    week: HealthWeekDay[];
    targets: { calories: number; steps: number };
    /** The week's sums, averages and days at goal, all from SQL. */
    trend: ActivityTrend;
    /** The week's workouts, oldest first, for the exercise ladder. */
    sessions: ActivitySession[];
    goal: ActivityGoal | null;
}

export async function loadActivitySide(repositories: ReadRepositories, features: ReadonlySet<string>, date: string): Promise<ActivitySide> {
    const weekStart = weekStartOf(date);
    const [weekData, sessions] = await Promise.all([
        loadHealthWeek(repositories, activitySources(features), date),
        repositories.activities.getWorkoutSessions(weekStart, shiftDay(weekStart, 6)),
    ]);
    return {
        weekStart,
        week: weekData.week,
        targets: weekData.targets,
        trend: weekData.activityWeek ?? EMPTY_ACTIVITY_TREND,
        sessions,
        goal: weekData.activityGoal,
    };
}
