import type { CalorieEntry, FoodItem, MealSlot, NutritionGoal } from '@hearthlog/sdk/data';
import { shiftLocalDate } from '../calories/logic.js';
import type { FoodSort } from '../calories/food-logic.js';
import type { ReadModelSession } from '@hearthlog/sdk/data';
import { withTimeout } from '@hearthlog/sdk/data';
import { sql, type RawBuilder } from 'kysely';

export type { CalorieEntry, FoodItem, MealSlot, NutritionGoal };

const DB_TIMEOUT_MS = 5000;

// SQLite's built-in lower() and LIKE only case-fold ASCII. Fold the common
// Latin accents inside the query so food search keeps its previous behavior
// without moving filtering into the component.
function foldedFoodText(expression: RawBuilder<string>): RawBuilder<string> {
    let folded = expression;
    const accented = 'áàâäãåāąčćďđéèêëěēęíìîïīłńňóòôöõøōřśššťúùûüůūýÿžźż';
    for (const character of accented) {
        const plain = character.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace('ł', 'l').replace('đ', 'd').replace('ø', 'o');
        folded = sql<string>`replace(replace(${folded}, ${character}, ${plain}), ${character.toUpperCase()}, ${plain})`;
    }
    return sql<string>`lower(${folded})`;
}

/** A search term folded the way the query folds names: lower case, accents and a few letters flattened. */
function foodSearchTerm(search: string): string {
    return search.trim().toLocaleLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[ł]/g, 'l').replace(/[đ]/g, 'd').replace(/[ø]/g, 'o');
}

/** A day's summed nutrition values, aggregated in SQLite. */
export interface CalorieDailyTotals {
    date: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
}

/** Seven-day trend rows plus the aggregates the diary header renders. */
export interface CalorieTrend {
    /** Only days that have entries; callers fill the empty days for display. */
    days: CalorieDailyTotals[];
    trackedDays: number;
    averageCalories: number;
    averageProteinG: number;
    maxCalories: number;
}

export interface CalorieMealCount {
    mealType: string;
    count: number;
}

export interface CalorieMealTotals {
    mealType: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
}

function toNumber(value: number | string | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function createCalorieRepository(session: ReadModelSession) {
    /** The foods whose name or brand contains the term, and the favorites among them when asked. */
    function foodMatches(search: string, favoritesOnly: boolean) {
        const term = foodSearchTerm(search);
        const escaped = term.replace(/[\\%_]/g, (character) => `\\${character}`);
        const fullName = foldedFoodText(sql<string>`${sql.ref('name')} || ' ' || ${sql.ref('brand')}`);
        let query = session.selectFrom('food_items').selectAll();
        if (term) query = query.where(sql<boolean>`${fullName} LIKE ${`%${escaped}%`} ESCAPE '\\'`);
        if (favoritesOnly) query = query.where('favorite', '=', true);
        return { term, escaped, query };
    }

    return {
        getFoodItems(): Promise<FoodItem[]> {
            return withTimeout(
                session.selectFrom('food_items')
                    .selectAll()
                    .orderBy('favorite', 'desc')
                    .orderBy('name', 'asc')
                    .orderBy('brand', 'asc')
                    .execute(),
                DB_TIMEOUT_MS,
                'Food library query timed out',
            );
        },

        /** The library food that was imported from a source, if it already is one. */
        async getFoodItemBySource(provider: string, sourceId: string): Promise<FoodItem | null> {
            const row = await withTimeout(
                session.selectFrom('food_items')
                    .selectAll()
                    .where('source_provider', '=', provider)
                    .where('source_id', '=', sourceId)
                    .limit(1)
                    .executeTakeFirst(),
                DB_TIMEOUT_MS,
                'Food lookup timed out',
            );
            return row ?? null;
        },

        /**
         * One page of the foods matching a search term, ordered in SQLite. Without a
         * chosen column favorites come first by name, and a name that starts with the
         * term leads. A chosen column sorts by name, by calories, or by protein per
         * calorie, in either direction.
         */
        searchFoodItems(options: { search: string; favoritesOnly: boolean; sort: FoodSort; limit: number; offset: number }): Promise<FoodItem[]> {
            const { search, favoritesOnly, sort, limit, offset } = options;
            const { term, escaped, query } = foodMatches(search, favoritesOnly);
            const direction = sort.desc ? 'desc' : 'asc';
            const name = foldedFoodText(sql.ref('name'));
            const prefix = `${escaped}%`;
            const ordered = sort.column === 'calories'
                ? query.orderBy('calories_per_100g', direction)
                : sort.column === 'protein'
                    ? query.orderBy(sql<number>`CASE WHEN calories_per_100g > 0 THEN protein_per_100g * 1.0 / calories_per_100g ELSE 0 END`, direction)
                    : sort.column === 'name'
                        ? query.orderBy('name', direction)
                        // A bare constant would read as a column position, so a search term adds the prefix rule and none adds nothing.
                        : (term ? query.orderBy(sql<number>`CASE WHEN ${name} LIKE ${prefix} ESCAPE '\\' THEN 0 ELSE 1 END`, 'asc') : query)
                            .orderBy('favorite', 'desc');
            return withTimeout(
                ordered
                    .orderBy('name', sort.column === 'name' ? direction : 'asc')
                    .orderBy('brand', sort.column === 'name' ? direction : 'asc')
                    .limit(limit)
                    .offset(offset)
                    .execute(),
                DB_TIMEOUT_MS,
                'Food search timed out',
            );
        },

        /** How many foods match a search term, counted in SQLite. */
        async countFoodItems(search: string, favoritesOnly: boolean): Promise<number> {
            const { query } = foodMatches(search, favoritesOnly);
            const row = await withTimeout(
                query.clearSelect().select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirst(),
                DB_TIMEOUT_MS,
                'Food count timed out',
            );
            return toNumber(row?.count);
        },

        async getRecentFoodItemIds(limit = 8): Promise<string[]> {
            const rows = await withTimeout(
                session.selectFrom('calorie_entries')
                    .select(({ fn }) => ['food_item_id', fn.max('logged_at').as('last_used_at')])
                    .where('food_item_id', '!=', '')
                    .groupBy('food_item_id')
                    .orderBy('last_used_at', 'desc')
                    .limit(limit)
                    .execute(),
                DB_TIMEOUT_MS,
                'Recent food query timed out',
            );
            return rows.map((row) => row.food_item_id);
        },

        /**
         * The latest entry of each food logged before, newest first, optionally
         * narrowed by name in SQL. The phone log sheet offers them to fill its form.
         */
        async getRecentEntries(search = '', limit = 6): Promise<CalorieEntry[]> {
            const pattern = `%${search.trim().toLowerCase()}%`;
            const result = await withTimeout(
                session.execute(sql<CalorieEntry>`
                    SELECT * FROM (
                        SELECT entries.*, ROW_NUMBER() OVER (
                            PARTITION BY lower(trim(entries.name)) ORDER BY entries.logged_at DESC, entries.id DESC
                        ) AS recency
                        FROM ${session.table('calorie_entries')} AS entries
                        WHERE trim(entries.name) != '' AND lower(entries.name) LIKE ${pattern}
                    ) AS ranked
                    WHERE ranked.recency = 1
                    ORDER BY ranked.logged_at DESC, ranked.id DESC
                    LIMIT ${limit}`),
                DB_TIMEOUT_MS,
                'Recent calorie entries query timed out',
            );
            return result.rows;
        },

        /** Meal slots in display order; SQL owns the ordering. */
        getMealSlots(): Promise<MealSlot[]> {
            return withTimeout(
                session.selectFrom('meal_slots')
                    .selectAll()
                    .orderBy('sort_order', 'asc')
                    .orderBy('id', 'asc')
                    .execute(),
                DB_TIMEOUT_MS,
                'Meal slot query timed out',
            );
        },

        async getMaxMealSlotSortOrder(): Promise<number> {
            const row = await withTimeout(
                session.selectFrom('meal_slots')
                    .select(({ fn }) => fn.max('sort_order').as('max_order'))
                    .executeTakeFirst(),
                DB_TIMEOUT_MS,
                'Meal slot order query timed out',
            );
            return toNumber(row?.max_order);
        },

        /** One day's entries, optionally narrowed to one meal slot in SQL. */
        getCalorieEntriesForDate(date: string, mealType?: string): Promise<CalorieEntry[]> {
            const endExclusive = shiftLocalDate(date, 1);
            let query = session.selectFrom('calorie_entries')
                .selectAll()
                .where('logged_at', '>=', date)
                .where('logged_at', '<', endExclusive)
                .orderBy('logged_at', 'asc')
                .orderBy('id', 'asc');
            if (mealType !== undefined) {
                query = query.where('meal_type', '=', mealType);
            }
            return withTimeout(
                query.execute(),
                DB_TIMEOUT_MS,
                'Calorie entry query timed out',
            );
        },

        /**
         * Per-day sums for a date range, plus tracked-day count and calorie
         * average/maximum, all computed by SQLite in one query.
         */
        async getCalorieTrend(startDate: string, endDate: string): Promise<CalorieTrend> {
            const endExclusive = shiftLocalDate(endDate, 1);
            const result = await withTimeout(
                session.execute(sql<{
                    date: string;
                    calories: number | string | null;
                    protein_g: number | string | null;
                    carbs_g: number | string | null;
                    fat_g: number | string | null;
                    tracked_days: number | string | null;
                    average_calories: number | string | null;
                    average_protein_g: number | string | null;
                    max_calories: number | string | null;
                }>`
                    WITH daily AS (
                        SELECT substr(trim(logged_at), 1, 10) AS date,
                            SUM(COALESCE(calories, 0)) AS calories,
                            SUM(COALESCE(protein_g, 0)) AS protein_g,
                            SUM(COALESCE(carbs_g, 0)) AS carbs_g,
                            SUM(COALESCE(fat_g, 0)) AS fat_g
                        FROM ${session.table('calorie_entries')} AS calorie_entries
                        WHERE logged_at >= ${startDate}
                            AND logged_at < ${endExclusive}
                        GROUP BY date
                    )
                    SELECT date, calories, protein_g, carbs_g, fat_g,
                        COUNT(*) OVER () AS tracked_days,
                        AVG(calories) OVER () AS average_calories,
                        AVG(protein_g) OVER () AS average_protein_g,
                        MAX(calories) OVER () AS max_calories
                    FROM daily
                    ORDER BY date
                `),
                DB_TIMEOUT_MS,
                'Calorie trend query timed out',
            );
            const first = result.rows[0];
            return {
                days: result.rows.map((row) => ({
                    date: String(row.date),
                    calories: toNumber(row.calories),
                    proteinG: toNumber(row.protein_g),
                    carbsG: toNumber(row.carbs_g),
                    fatG: toNumber(row.fat_g),
                })),
                trackedDays: toNumber(first?.tracked_days),
                averageCalories: toNumber(first?.average_calories),
                averageProteinG: toNumber(first?.average_protein_g),
                maxCalories: toNumber(first?.max_calories),
            };
        },

        /** Entry counts per meal slot for one day, grouped by SQLite. */
        async getCalorieMealCountsForDate(date: string): Promise<CalorieMealCount[]> {
            const endExclusive = shiftLocalDate(date, 1);
            const rows = await withTimeout(
                session.selectFrom('calorie_entries')
                    .select(({ fn }) => ['meal_type', fn.countAll<number>().as('count')])
                    .where('logged_at', '>=', date)
                    .where('logged_at', '<', endExclusive)
                    .groupBy('meal_type')
                    .execute(),
                DB_TIMEOUT_MS,
                'Calorie meal count query timed out',
            );
            return rows.map((row) => ({ mealType: row.meal_type, count: toNumber(row.count) }));
        },

        /** Per-slot nutrition sums for one day, grouped by SQLite. */
        async getCalorieMealTotalsForDate(date: string): Promise<CalorieMealTotals[]> {
            const endExclusive = shiftLocalDate(date, 1);
            const rows = await withTimeout(
                session.selectFrom('calorie_entries')
                    .select(({ fn }) => [
                        'meal_type',
                        fn.sum<number>('calories').as('calories'),
                        fn.sum<number>('protein_g').as('protein_g'),
                        fn.sum<number>('carbs_g').as('carbs_g'),
                        fn.sum<number>('fat_g').as('fat_g'),
                    ])
                    .where('logged_at', '>=', date)
                    .where('logged_at', '<', endExclusive)
                    .groupBy('meal_type')
                    .execute(),
                DB_TIMEOUT_MS,
                'Calorie meal total query timed out',
            );
            return rows.map((row) => ({
                mealType: row.meal_type,
                calories: toNumber(row.calories),
                proteinG: toNumber(row.protein_g),
                carbsG: toNumber(row.carbs_g),
                fatG: toNumber(row.fat_g),
            }));
        },

        /** The goal effective on or before a date; SQL picks the winner. */
        async getLatestNutritionGoal(selectedDate: string): Promise<NutritionGoal | null> {
            const row = await withTimeout(
                session.selectFrom('nutrition_goals')
                    .selectAll()
                    .where('effective_from', '<', shiftLocalDate(selectedDate, 1))
                    .orderBy('effective_from', 'desc')
                    .orderBy('updated_at', 'desc')
                    .orderBy('id', 'desc')
                    .limit(1)
                    .executeTakeFirst(),
                DB_TIMEOUT_MS,
                'Nutrition goal query timed out',
            );
            return row ?? null;
        },

        /** The goal saved for exactly one effective date, if any. */
        async getNutritionGoalForDate(date: string): Promise<NutritionGoal | null> {
            const row = await withTimeout(
                session.selectFrom('nutrition_goals')
                    .selectAll()
                    .where('effective_from', '>=', date)
                    .where('effective_from', '<', shiftLocalDate(date, 1))
                    .orderBy('updated_at', 'desc')
                    .orderBy('id', 'desc')
                    .limit(1)
                    .executeTakeFirst(),
                DB_TIMEOUT_MS,
                'Nutrition goal query timed out',
            );
            return row ?? null;
        },
    };
}
