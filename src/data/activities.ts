import type { ActivityEntry, ActivityGoal } from '@hearthlog/sdk/data';
import { shiftLocalDate } from '../calories/logic.js';
import { effectiveActiveCalories } from './step-calories.js';
import type { ReadModelSession } from '@hearthlog/sdk/data';
import { withTimeout } from '@hearthlog/sdk/data';
import { sql } from 'kysely';

export type { ActivityEntry, ActivityGoal };

/** A diary entry with the active calories it counts for (see `effectiveActiveCalories`). */
export type ActivityEntryRow = ActivityEntry & { effective_active_calories: number };

const DB_TIMEOUT_MS = 5000;

/** One day's activity sums, aggregated in SQLite. */
export interface ActivityDailyTotals {
    date: string;
    steps: number;
    exerciseMinutes: number;
    workoutSessions: number;
    activeCalories: number;
}

/** Range sums for the weekly header. */
export interface ActivityTotals {
    steps: number;
    exerciseMinutes: number;
    workoutSessions: number;
    activeCalories: number;
}

/** Seven-day trend rows plus the aggregates the diary header renders. */
export interface ActivityTrend {
    /** Only days that have entries; callers fill the empty days for display. */
    days: ActivityDailyTotals[];
    weekTotals: ActivityTotals;
    /** Days whose step total is above zero. */
    trackedDays: number;
    /** Days whose steps reach the target the trend was read with; zero without a target. */
    daysAtGoal: number;
    averageSteps: number;
    maxSteps: number;
}

/** One logged workout, for the week's exercise ladder. */
export interface ActivitySession {
    id: string;
    date: string;
    name: string;
    minutes: number;
}

function toNumber(value: number | string | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function createActivityRepository(session: ReadModelSession) {
    return {
        /** One day's entries; SQL owns the ordering. */
        getActivityEntriesForDate(date: string): Promise<ActivityEntryRow[]> {
        const endExclusive = shiftLocalDate(date, 1);
        return withTimeout(
            session.selectFrom('activity_entries')
                .selectAll()
                .select(effectiveActiveCalories(session, 'activity_entries').as('effective_active_calories'))
                .where('logged_at', '>=', date)
                .where('logged_at', '<', endExclusive)
                .orderBy('logged_at', 'asc')
                .orderBy('id', 'asc')
                .execute(),
            DB_TIMEOUT_MS,
            'Activity entry query timed out',
        );
    },

    /**
     * Per-day activity sums for a date range plus weekly and tracked-day
     * aggregates, all computed by SQLite in one query. With a steps target the
     * same query counts the days that reached it.
     */
    async getActivityTrend(startDate: string, endDate: string, stepsTarget = 0): Promise<ActivityTrend> {
        const endExclusive = shiftLocalDate(endDate, 1);
        const result = await withTimeout(
            session.execute(sql<{
                date: string;
                steps: number | string | null;
                exercise_minutes: number | string | null;
                workout_sessions: number | string | null;
                active_calories: number | string | null;
                week_steps: number | string | null;
                week_exercise_minutes: number | string | null;
                week_workout_sessions: number | string | null;
                week_active_calories: number | string | null;
                tracked_days: number | string | null;
                days_at_goal: number | string | null;
                average_steps: number | string | null;
                max_steps: number | string | null;
            }>`
                WITH daily AS (
                    SELECT substr(trim(logged_at), 1, 10) AS date,
                        SUM(CASE WHEN kind = 'steps' THEN COALESCE(amount, 0) ELSE 0 END) AS steps,
                        SUM(CASE WHEN kind = 'workout' THEN COALESCE(duration_minutes, 0) ELSE 0 END) AS exercise_minutes,
                        SUM(CASE WHEN kind = 'workout' THEN 1 ELSE 0 END) AS workout_sessions,
                        SUM(${effectiveActiveCalories(session, 'activity_entries')}) AS active_calories
                    FROM ${session.table('activity_entries')} AS activity_entries
                    WHERE logged_at >= ${startDate}
                        AND logged_at < ${endExclusive}
                    GROUP BY date
                )
                SELECT date, steps, exercise_minutes, workout_sessions, active_calories,
                    SUM(steps) OVER () AS week_steps,
                    SUM(exercise_minutes) OVER () AS week_exercise_minutes,
                    SUM(workout_sessions) OVER () AS week_workout_sessions,
                    SUM(active_calories) OVER () AS week_active_calories,
                    COUNT(CASE WHEN steps > 0 THEN 1 END) OVER () AS tracked_days,
                    COUNT(CASE WHEN ${stepsTarget} > 0 AND steps >= ${stepsTarget} THEN 1 END) OVER () AS days_at_goal,
                    AVG(CASE WHEN steps > 0 THEN steps END) OVER () AS average_steps,
                    MAX(steps) OVER () AS max_steps
                FROM daily
                ORDER BY date
            `),
            DB_TIMEOUT_MS,
            'Activity trend query timed out',
        );
        const first = result.rows[0];
        return {
            days: result.rows.map((row) => ({
                date: String(row.date),
                steps: toNumber(row.steps),
                exerciseMinutes: toNumber(row.exercise_minutes),
                workoutSessions: toNumber(row.workout_sessions),
                activeCalories: toNumber(row.active_calories),
            })),
            weekTotals: {
                steps: toNumber(first?.week_steps),
                exerciseMinutes: toNumber(first?.week_exercise_minutes),
                workoutSessions: toNumber(first?.week_workout_sessions),
                activeCalories: toNumber(first?.week_active_calories),
            },
            trackedDays: toNumber(first?.tracked_days),
            daysAtGoal: toNumber(first?.days_at_goal),
            averageSteps: toNumber(first?.average_steps),
            maxSteps: toNumber(first?.max_steps),
        };
    },

    /** Each workout with minutes in a date range, oldest first; SQL owns the filter and the order. */
    async getWorkoutSessions(startDate: string, endDate: string): Promise<ActivitySession[]> {
        const rows = await withTimeout(
            session.selectFrom('activity_entries')
                .select(['id', 'name', 'logged_at', 'duration_minutes'])
                .where('kind', '=', 'workout')
                .where('duration_minutes', '>', 0)
                .where('logged_at', '>=', startDate)
                .where('logged_at', '<', shiftLocalDate(endDate, 1))
                .orderBy('logged_at', 'asc')
                .orderBy('id', 'asc')
                .execute(),
            DB_TIMEOUT_MS,
            'Workout session query timed out',
        );
        return rows.map((row) => ({
            id: row.id,
            date: String(row.logged_at).trim().slice(0, 10),
            name: row.name,
            minutes: toNumber(row.duration_minutes),
        }));
    },

    /** The goal effective on or before a date; SQL picks the winner. */
    async getLatestActivityGoal(selectedDate: string): Promise<ActivityGoal | null> {
        const row = await withTimeout(
            session.selectFrom('activity_goals')
                .selectAll()
                .where('effective_from', '<', shiftLocalDate(selectedDate, 1))
                .orderBy('effective_from', 'desc')
                .orderBy('updated_at', 'desc')
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
            DB_TIMEOUT_MS,
            'Activity goal query timed out',
        );
        return row ?? null;
    },

    /** The goal saved for exactly one effective date, if any. */
    async getActivityGoalForDate(date: string): Promise<ActivityGoal | null> {
        const row = await withTimeout(
            session.selectFrom('activity_goals')
                .selectAll()
                .where('effective_from', '>=', date)
                .where('effective_from', '<', shiftLocalDate(date, 1))
                .orderBy('updated_at', 'desc')
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
            DB_TIMEOUT_MS,
            'Activity goal query timed out',
        );
        return row ?? null;
    },
    };
}
