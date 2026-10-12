import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { Kysely, SqliteDialect } from 'kysely';
import { ACTIVITY_ENTRY_DDL, WEIGHTLOG_DDL } from '@hearthlog/sdk/data';
import { createReadModelSession, type ReadModelDatabase } from '@hearthlog/sdk/testing';
import { createActivityRepository } from './activities.js';

/**
 * A synced step entry has no stored calories, so the read model estimates them
 * with the weigh-in in force on its day. Manual entries keep what they stored.
 */

const databases: Array<Kysely<ReadModelDatabase>> = [];
afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
});

function wrap(statement: StatementSync, query: string) {
    return {
        reader: /^\s*(?:PRAGMA|SELECT|WITH|EXPLAIN)\b/i.test(query),
        all: (parameters: ReadonlyArray<unknown>) => statement.all(...parameters as SQLInputValue[]),
        run: (parameters: ReadonlyArray<unknown>) => statement.run(...parameters as SQLInputValue[]),
        iterate: (parameters: ReadonlyArray<unknown>) => statement.iterate(...parameters as SQLInputValue[]),
    };
}

type Entry = { id: string; day: string; steps: number; source?: string; calories?: number; calorieSource?: string };

function repository(weights: Array<[date: string, kg: number]>, entries: Entry[]) {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(ACTIVITY_ENTRY_DDL);
    sqlite.exec(WEIGHTLOG_DDL);
    weights.forEach(([date, kg], index) => {
        sqlite.prepare('INSERT INTO weight_logs (tenant_id, log_id, id, weight, height, date) VALUES (?, ?, ?, ?, ?, ?)')
            .run('tenant-a', 'log-a', `w${index}`, kg, 180, date);
    });
    for (const entry of entries) {
        sqlite.prepare(`INSERT INTO activity_entries
            (tenant_id, log_id, id, name, kind, amount, unit, logged_at, active_calories, calorie_source, source)
            VALUES (?, ?, ?, 'Steps', 'steps', ?, 'steps', ?, ?, ?, ?)`)
            .run('tenant-a', 'log-a', entry.id, entry.steps, `${entry.day}T00:00`, entry.calories ?? 0, entry.calorieSource ?? 'none', entry.source ?? '');
    }
    const db = new Kysely<ReadModelDatabase>({
        dialect: new SqliteDialect({ database: { close: () => sqlite.close(), prepare: (query: string) => wrap(sqlite.prepare(query), query) } as never }),
    });
    databases.push(db);
    return createActivityRepository(createReadModelSession(db, {
        schema: 'main',
        scope: { tenantId: 'tenant-a', logId: 'log-a' },
        view: { effectiveNow: '2026-09-14T12:00:00.000Z' },
    }));
}

async function caloriesOn(rows: ReturnType<typeof repository>, day: string): Promise<number> {
    const trend = await rows.getActivityTrend(day, day);
    return trend.days.find((entry) => entry.date === day)?.activeCalories ?? 0;
}

describe('synced step calories', () => {
    it('estimates with the weigh-in on or before the day, else the earliest after it', async () => {
        const rows = repository([['2026-09-01', 80], ['2026-09-10', 70]], [
            { id: 'a', day: '2026-09-05', steps: 10000, source: 'iphone-steps' },
            { id: 'b', day: '2026-09-12', steps: 10000, source: 'iphone-steps' },
            { id: 'c', day: '2026-08-20', steps: 10000, source: 'iphone-steps' },
        ]);
        expect(await caloriesOn(rows, '2026-09-05')).toBe(400);
        expect(await caloriesOn(rows, '2026-09-12')).toBe(350);
        expect(await caloriesOn(rows, '2026-08-20')).toBe(400);
    });

    it('leaves manual entries and estimated entries alone and counts nothing without a weigh-in', async () => {
        const rows = repository([['2026-09-01', 80]], [
            { id: 'manual', day: '2026-09-05', steps: 10000, calories: 120, calorieSource: 'manual' },
            { id: 'logged', day: '2026-09-06', steps: 10000, calories: 90, calorieSource: 'estimated', source: '' },
        ]);
        expect(await caloriesOn(rows, '2026-09-05')).toBe(120);
        expect(await caloriesOn(rows, '2026-09-06')).toBe(90);
        const bare = repository([], [{ id: 'a', day: '2026-09-05', steps: 10000, source: 'iphone-steps' }]);
        expect(await caloriesOn(bare, '2026-09-05')).toBe(0);
    });

    it('reports the same figure per entry as in the day total', async () => {
        const rows = repository([['2026-09-01', 80]], [{ id: 'a', day: '2026-09-05', steps: 10000, source: 'iphone-steps' }]);
        const [entry] = await rows.getActivityEntriesForDate('2026-09-05');
        expect(entry?.effective_active_calories).toBe(400);
    });
});
