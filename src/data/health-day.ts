import { sql, type RawBuilder } from 'kysely';
import type { ReadModelSession } from '@hearthlog/sdk/data';
import { shiftLocalDate } from '../calories/logic.js';
import { effectiveActiveCalories } from './step-calories.js';
import { withTimeout } from '@hearthlog/sdk/data';

const DB_TIMEOUT_MS = 5000;

export interface HealthTimelineRow {
    kind: 'meal' | 'activity';
    id: string;
    name: string;
    loggedAt: string;
    /** Meal slot id for meals; activity kind (steps, workout, custom) for movement. */
    detail: string;
    /** The meal slot's stored label; empty for movement and for implicit built-in slots. */
    detailLabel: string;
    /** Eaten calories for meals; active calories for movement. */
    calories: number;
    amount: number;
    unit: string;
    durationMinutes: number;
    /** Workout intensity; empty for meals and for movement without one. */
    intensity: string;
    /** Calories eaten through this row, in timeline order. */
    kcalTotal: number;
    /** Steps taken through this row, in timeline order. */
    stepsTotal: number;
}

/** The mean calories eaten by each time of day over the tracked days before a date. */
export interface UsualPace {
    /** How many earlier days it averages. */
    days: number;
    points: { time: string; kcal: number }[];
}

type TimelineSqlRow = {
    kind: string;
    id: string;
    name: string;
    logged_at: string;
    detail: string | null;
    detail_label: string | null;
    calories: number | string | null;
    amount: number | string | null;
    unit: string | null;
    duration_minutes: number | string | null;
    intensity: string | null;
    kcal_total: number | string | null;
    steps_total: number | string | null;
};

function toNumber(value: number | string | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * One day of Health as a single timeline. Meals and movement are merged and
 * ordered by SQLite; only the tables of enabled features are part of the query.
 */
export function createHealthDayRepository(session: ReadModelSession) {
    return {
        async getTimeline(date: string, sources: { meals: boolean; activity: boolean }): Promise<HealthTimelineRow[]> {
            const end = shiftLocalDate(date, 1);
            const parts: RawBuilder<unknown>[] = [];
            if (sources.meals) {
                parts.push(sql`
                    SELECT 'meal' AS kind, entry.id, entry.name, entry.logged_at, entry.meal_type AS detail,
                        COALESCE(slot.label, '') AS detail_label, entry.calories,
                        0 AS amount, '' AS unit, 0 AS duration_minutes, '' AS intensity
                    FROM ${session.table('calorie_entries')} AS entry
                    LEFT JOIN ${session.table('meal_slots')} AS slot ON slot.id = entry.meal_type
                    WHERE entry.logged_at >= ${date} AND entry.logged_at < ${end}`);
            }
            if (sources.activity) {
                parts.push(sql`
                    SELECT 'activity' AS kind, id, name, logged_at, kind AS detail, '' AS detail_label,
                        ${effectiveActiveCalories(session, 'activity_entries')} AS calories, amount, unit, duration_minutes, intensity
                    FROM ${session.table('activity_entries')} AS activity_entries
                    WHERE logged_at >= ${date} AND logged_at < ${end}`);
            }
            if (parts.length === 0) return [];
            const result = await withTimeout(
                session.execute(sql<TimelineSqlRow>`
                    SELECT timeline.*,
                        SUM(CASE WHEN kind = 'meal' THEN calories ELSE 0 END) OVER running AS kcal_total,
                        SUM(CASE WHEN kind = 'activity' AND detail = 'steps' THEN amount ELSE 0 END) OVER running AS steps_total
                    FROM (${sql.join(parts, sql` UNION ALL `)}) AS timeline
                    WINDOW running AS (
                        ORDER BY logged_at ASC, kind ASC, id ASC
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    )
                    ORDER BY logged_at ASC, kind ASC, id ASC
                `),
                DB_TIMEOUT_MS,
                'Health timeline query timed out',
            );
            return result.rows.map((row) => ({
                kind: row.kind === 'activity' ? 'activity' : 'meal',
                id: row.id,
                name: row.name,
                loggedAt: row.logged_at,
                detail: row.detail ?? '',
                detailLabel: row.detail_label ?? '',
                calories: toNumber(row.calories),
                amount: toNumber(row.amount),
                unit: row.unit ?? '',
                durationMinutes: toNumber(row.duration_minutes),
                intensity: row.intensity ?? '',
                kcalTotal: toNumber(row.kcal_total),
                stepsTotal: toNumber(row.steps_total),
            }));
        },

        /**
         * The mean calories eaten by each of `times` (`HH:mm`) over the last `days`
         * days before `date` that have meals, cut together by SQLite. Null below
         * three such days: a pace needs a few days to be usual.
         */
        async getUsualPace(date: string, times: readonly string[], days = 14): Promise<UsualPace | null> {
            if (times.length === 0) return null;
            const result = await withTimeout(
                session.execute(sql<{ time: string; kcal: number | string | null; days: number | string }>`
                    WITH tracked AS (
                        SELECT DISTINCT substr(logged_at, 1, 10) AS day
                        FROM ${session.table('calorie_entries')} AS entry
                        WHERE logged_at < ${date}
                        ORDER BY day DESC
                        LIMIT ${days}
                    ),
                    slots AS (SELECT value AS time FROM json_each(${JSON.stringify(times)})),
                    meals AS (
                        SELECT substr(logged_at, 1, 10) AS day, substr(logged_at, 12, 5) AS time, calories
                        FROM ${session.table('calorie_entries')} AS entry
                        WHERE substr(logged_at, 1, 10) IN (SELECT day FROM tracked)
                    ),
                    per_day AS (
                        SELECT tracked.day AS day, slots.time AS time, COALESCE(SUM(meals.calories), 0) AS eaten
                        FROM tracked
                        CROSS JOIN slots
                        LEFT JOIN meals ON meals.day = tracked.day AND meals.time <= slots.time
                        GROUP BY tracked.day, slots.time
                    )
                    SELECT time, AVG(eaten) AS kcal, COUNT(*) AS days
                    FROM per_day
                    GROUP BY time
                    ORDER BY time
                `),
                DB_TIMEOUT_MS,
                'Usual pace query timed out',
            );
            const tracked = toNumber(result.rows[0]?.days);
            if (tracked < 3) return null;
            return { days: tracked, points: result.rows.map((row) => ({ time: String(row.time), kcal: toNumber(row.kcal) })) };
        },

        /** The earliest day anything was logged in the given domains; null when nothing has been. */
        async getFirstLoggedDay(sources: { meals: boolean; activity: boolean; body: boolean }): Promise<string | null> {
            const parts: RawBuilder<unknown>[] = [];
            if (sources.meals) parts.push(sql`SELECT MIN(substr(trim(logged_at), 1, 10)) AS day FROM ${session.table('calorie_entries')}`);
            if (sources.activity) parts.push(sql`SELECT MIN(substr(trim(logged_at), 1, 10)) AS day FROM ${session.table('activity_entries')}`);
            if (sources.body) parts.push(sql`SELECT MIN(substr(trim(date), 1, 10)) AS day FROM ${session.table('weight_logs')}`);
            if (parts.length === 0) return null;
            const result = await withTimeout(
                session.execute(sql<{ day: string | null }>`SELECT MIN(day) AS day FROM (${sql.join(parts, sql` UNION ALL `)})`),
                DB_TIMEOUT_MS,
                'First logged day query timed out',
            );
            return result.rows[0]?.day ?? null;
        },
    };
}
