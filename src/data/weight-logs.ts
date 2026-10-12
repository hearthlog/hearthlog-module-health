import type { Weightlog } from '@hearthlog/sdk/data';
import type { ReadModelSession } from '@hearthlog/sdk/data';
import { withTimeout } from '@hearthlog/sdk/data';
import { sql } from 'kysely';

export type { Weightlog };

const DB_TIMEOUT_MS = 5000;

/** One weigh-in on its local date. */
export interface WeightPoint {
    date: string;
    weight: number;
}

/** The mean of every weigh-in in the seven days ending on `date`. */
export interface WeightMeanPoint {
    date: string;
    mean: number;
}

export interface WeightTrend {
    weighIns: WeightPoint[];
    mean: WeightMeanPoint[];
}

/** The columns the weigh-in list sorts by. */
export type WeighInSortColumn = 'date' | 'weight' | 'change' | 'bmi';

export interface WeighInSort {
    column: WeighInSortColumn;
    desc: boolean;
}

/** One line of the weigh-in list: the change is against the weigh-in before it. */
export interface WeighInRow {
    id: string;
    date: string;
    weight: number;
    height: number;
    /** Null without a height. */
    bmi: number | null;
    /** Null for the first weigh-in ever. */
    change: number | null;
}

function toNumber(value: number | string | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function createWeightLogRepository(session: ReadModelSession) {
    return {
        /** The newest weigh-in, optionally at or before a local date. */
        async getLatestWeightLog(throughDate?: string): Promise<Weightlog | null> {
            let query = session.selectFrom('weight_logs')
                .selectAll();
            if (throughDate !== undefined) {
                query = query.where(sql<boolean>`substr(trim(date), 1, 10) <= ${throughDate}`);
            }
            const row = await withTimeout(
                query
                    .orderBy('date', 'desc')
                    .orderBy('created_at', 'desc')
                    .orderBy('id', 'desc')
                    .limit(1)
                    .executeTakeFirst(),
                DB_TIMEOUT_MS,
                'Latest weight log query timed out',
            );
            return row ?? null;
        },

        /** The earliest weigh-in at or after a local date, excluding one id. */
        async getFirstWeightLogSince(date: string, excludeId?: string): Promise<Weightlog | null> {
            let query = session.selectFrom('weight_logs')
                .selectAll()
                .where(sql<boolean>`substr(trim(date), 1, 10) >= ${date}`);
            if (excludeId !== undefined) {
                query = query.where('id', '!=', excludeId);
            }
            const row = await withTimeout(
                query
                    .orderBy('date', 'asc')
                    .orderBy('created_at', 'asc')
                    .orderBy('id', 'asc')
                    .limit(1)
                    .executeTakeFirst(),
                DB_TIMEOUT_MS,
                'Weight baseline query timed out',
            );
            return row ?? null;
        },

        /** Local dates in a range that hold at least one weigh-in, oldest first. */
        async getWeighInDates(startDate: string, endDate: string): Promise<string[]> {
            const result = await withTimeout(
                session.execute(sql<{ day: string }>`
                    SELECT DISTINCT substr(trim(date), 1, 10) AS day
                    FROM ${session.table('weight_logs')} AS weigh_ins
                    WHERE substr(trim(date), 1, 10) >= ${startDate}
                        AND substr(trim(date), 1, 10) <= ${endDate}
                    ORDER BY day
                `),
                DB_TIMEOUT_MS,
                'Weigh-in date query timed out',
            );
            return result.rows.map((row) => String(row.day));
        },

        /**
         * Weigh-ins in a range plus their seven-day mean. SQLite computes the
         * mean over every weigh-in first, so the first days of the range still
         * average the days before it.
         */
        async getWeightTrend(startDate: string, endDate: string): Promise<WeightTrend> {
            const [weighIns, mean] = await Promise.all([
                withTimeout(
                    session.execute(sql<{ day: string; weight: number | string }>`
                        SELECT substr(trim(date), 1, 10) AS day, weight
                        FROM ${session.table('weight_logs')} AS weigh_ins
                        WHERE substr(trim(date), 1, 10) >= ${startDate}
                            AND substr(trim(date), 1, 10) <= ${endDate}
                        ORDER BY day, created_at, id
                    `),
                    DB_TIMEOUT_MS,
                    'Weight range query timed out',
                ),
                withTimeout(
                    session.execute(sql<{ day: string; mean: number | string }>`
                        WITH windowed AS (
                            SELECT substr(trim(date), 1, 10) AS day,
                                AVG(weight) OVER (
                                    ORDER BY julianday(substr(trim(date), 1, 10))
                                    RANGE BETWEEN 6 PRECEDING AND CURRENT ROW
                                ) AS mean
                            FROM ${session.table('weight_logs')} AS weigh_ins
                        )
                        SELECT DISTINCT day, mean FROM windowed
                        WHERE day >= ${startDate} AND day <= ${endDate}
                        ORDER BY day
                    `),
                    DB_TIMEOUT_MS,
                    'Weight mean query timed out',
                ),
            ]);
            return {
                weighIns: weighIns.rows.map((row) => ({ date: String(row.day), weight: toNumber(row.weight) })),
                mean: mean.rows.map((row) => ({ date: String(row.day), mean: toNumber(row.mean) })),
            };
        },

        /** Weigh-ins on record, counted in SQL. */
        async countWeightLogs(): Promise<number> {
            const row = await withTimeout(
                session.selectFrom('weight_logs')
                    .select(({ fn }) => fn.countAll<number>().as('count'))
                    .executeTakeFirst(),
                DB_TIMEOUT_MS,
                'Weight count query timed out',
            );
            return Number(row?.count ?? 0);
        },

        /**
         * Kilograms per week: the slope of a straight line through the weigh-ins
         * in a range, fitted by SQLite. Null below three weigh-ins.
         */
        async getWeightPace(startDate: string, endDate: string): Promise<number | null> {
            const result = await withTimeout(
                session.execute(sql<{ n: number | string; slope: number | string | null }>`
                    WITH points AS (
                        SELECT julianday(substr(trim(date), 1, 10)) - julianday(${startDate}) AS x, weight AS y
                        FROM ${session.table('weight_logs')} AS weigh_ins
                        WHERE substr(trim(date), 1, 10) >= ${startDate}
                            AND substr(trim(date), 1, 10) <= ${endDate}
                    )
                    SELECT COUNT(*) AS n,
                        (COUNT(*) * SUM(x * y) - SUM(x) * SUM(y))
                            / NULLIF(COUNT(*) * SUM(x * x) - SUM(x) * SUM(x), 0) * 7 AS slope
                    FROM points
                `),
                DB_TIMEOUT_MS,
                'Weight pace query timed out',
            );
            const row = result.rows[0];
            return row && toNumber(row.n) >= 3 && row.slope !== null ? toNumber(row.slope) : null;
        },

        /**
         * One page of the weigh-in list, each with its change against the weigh-in
         * before it. SQLite orders the whole history to find that neighbour, sorts
         * by the chosen column, then pages.
         */
        async getWeighInPage(options: { limit: number; offset: number; sort: WeighInSort }): Promise<WeighInRow[]> {
            const { limit, offset, sort } = options;
            const direction = sql.raw(sort.desc ? 'DESC' : 'ASC');
            // The column comes from a fixed set, never from the caller's text.
            const order = sort.column === 'date'
                ? sql`date ${direction}, created_at ${direction}, id ${direction}`
                : sql`${sql.ref(sort.column)} ${direction}, date DESC, created_at DESC, id DESC`;
            const result = await withTimeout(
                session.execute(sql<{
                    id: string;
                    day: string;
                    weight: number | string;
                    height: number | string;
                    change: number | string | null;
                    bmi: number | string | null;
                }>`
                    WITH ordered AS (
                        SELECT id, date, created_at, substr(trim(date), 1, 10) AS day, weight, height,
                            weight - LAG(weight) OVER (ORDER BY date, created_at, id) AS change,
                            CASE WHEN height > 0 THEN weight / ((height / 100.0) * (height / 100.0)) END AS bmi
                        FROM ${session.table('weight_logs')} AS weigh_ins
                    )
                    SELECT id, day, weight, height, change, bmi FROM ordered
                    ORDER BY ${order}
                    LIMIT ${limit} OFFSET ${offset}
                `),
                DB_TIMEOUT_MS,
                'Weigh-in page query timed out',
            );
            return result.rows.map((row) => ({
                id: String(row.id),
                date: String(row.day),
                weight: toNumber(row.weight),
                height: toNumber(row.height),
                bmi: row.bmi === null ? null : toNumber(row.bmi),
                change: row.change === null ? null : toNumber(row.change),
            }));
        },
    };
}
