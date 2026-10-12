import { sql, type RawBuilder } from 'kysely';
import type { ReadModelSession } from '@hearthlog/sdk/data';
import { STEP_CALORIES_PER_KG } from '../activities/logic.js';
import { tenant } from '@hearthlog/sdk/runtime';

/**
 * The active calories one activity entry counts for, as a SQL expression over
 * the `activity_entries` row aliased `alias`.
 *
 * A manual entry stores its own estimate. A synced step entry has none, because
 * the service that wrote it has no body weight, so the read model estimates it
 * with the weigh-in in force on the entry's day (the latest one on or before
 * it, else the earliest after it). Without a weigh-in, or on a site without the
 * body-weight entity, the stored value stands.
 */
export function effectiveActiveCalories(session: ReadModelSession, alias: string): RawBuilder<number> {
    const stored = sql<number>`COALESCE(${sql.ref(`${alias}.active_calories`)}, 0)`;
    if (!tenant.approvedEntities.tables.has('weight_logs')) return stored;
    const day = sql`substr(trim(${sql.ref(`${alias}.logged_at`)}), 1, 10)`;
    return sql<number>`CASE
        WHEN ${sql.ref(`${alias}.source`)} <> '' AND ${sql.ref(`${alias}.kind`)} = 'steps' AND ${sql.ref(`${alias}.calorie_source`)} = 'none'
        THEN COALESCE(
            ROUND(COALESCE(${sql.ref(`${alias}.amount`)}, 0) * (
                SELECT weigh_ins.weight FROM ${session.table('weight_logs')} AS weigh_ins
                ORDER BY (substr(trim(weigh_ins.date), 1, 10) <= ${day}) DESC,
                    CASE WHEN substr(trim(weigh_ins.date), 1, 10) <= ${day} THEN substr(trim(weigh_ins.date), 1, 10) END DESC,
                    substr(trim(weigh_ins.date), 1, 10) ASC,
                    weigh_ins.created_at DESC, weigh_ins.id DESC
                LIMIT 1
            ) * ${STEP_CALORIES_PER_KG}),
            ${stored}
        )
        ELSE ${stored}
    END`;
}
