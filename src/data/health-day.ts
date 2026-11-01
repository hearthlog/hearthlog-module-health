import { sql, type RawBuilder } from 'kysely';
import type { ReadModelSession } from '@hearthlog/sdk/data';
import { shiftLocalDate } from '../calories/logic.js';
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

function toNumber(value: number | string | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

/** Health across its domains: day totals and the first day with anything logged. */
export function createHealthDayRepository(session: ReadModelSession) {
    return {
        /** Calories eaten and steps taken on `date`, summed by SQLite; a disabled source counts zero. */
        async getDayTotals(date: string, sources: { meals: boolean; activity: boolean }): Promise<{ kcal: number; steps: number }> {
            if (!sources.meals && !sources.activity) return { kcal: 0, steps: 0 };
            const end = shiftLocalDate(date, 1);
            const kcal = sources.meals
                ? sql`(SELECT COALESCE(SUM(calories), 0) FROM ${session.table('calorie_entries')}
                    WHERE logged_at >= ${date} AND logged_at < ${end})`
                : sql`0`;
            const steps = sources.activity
                ? sql`(SELECT COALESCE(SUM(amount), 0) FROM ${session.table('activity_entries')}
                    WHERE kind = 'steps' AND logged_at >= ${date} AND logged_at < ${end})`
                : sql`0`;
            const result = await withTimeout(
                session.execute(sql<{ kcal: number | string | null; steps: number | string | null }>`SELECT ${kcal} AS kcal, ${steps} AS steps`),
                DB_TIMEOUT_MS,
                'Health day totals query timed out',
            );
            return { kcal: toNumber(result.rows[0]?.kcal), steps: toNumber(result.rows[0]?.steps) };
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
