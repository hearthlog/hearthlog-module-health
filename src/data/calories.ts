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

/** A food logged before in a meal, with how often and the portion it had last time. */
export type UsualFood = CalorieEntry & { uses: number };

/** One day of a range: what was eaten against the goal in force that day. */
export interface DailyBudgetRow {
    date: string;
    calories: number;
    proteinG: number;
    entries: number;
    /** Zero without a goal. */
    goal: number;
    proteinTargetG: number;
}

/** How a meal usually goes over a range. */
export interface MealHabit {
    mealType: string;
    days: number;
    averageCalories: number;
    /** Minutes after midnight of the meal's first entry, averaged. */
    averageMinutes: number;
}

export interface Staple {
    name: string;
    foodItemId: string;
    uses: number;
    averageCalories: number;
}

export interface FoodUsage {
    uses: number;
    lastUsed: string | null;
    byMeal: { mealType: string; uses: number }[];
    /** The latest entry of the food, for its usual portion. */
    last: CalorieEntry | null;
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

        /** Library foods by id, in no particular order. */
        getFoodItemsByIds(ids: readonly string[]): Promise<FoodItem[]> {
            if (ids.length === 0) return Promise.resolve([]);
            return withTimeout(
                session.selectFrom('food_items').selectAll().where('id', 'in', [...ids]).execute(),
                DB_TIMEOUT_MS,
                'Food lookup timed out',
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

        /**
         * The entries of an earlier meal to offer again: the latest day in the last
         * five weeks with something in this slot, the same weekday first.
         */
        async getLastMealLike(date: string, mealType: string): Promise<{ date: string; entries: CalorieEntry[] } | null> {
            const result = await withTimeout(
                session.execute(sql<{ day: string }>`
                    SELECT substr(trim(logged_at), 1, 10) AS day
                    FROM ${session.table('calorie_entries')} AS entries
                    WHERE meal_type = ${mealType} AND logged_at >= ${shiftLocalDate(date, -35)} AND logged_at < ${date}
                    GROUP BY day
                    ORDER BY strftime('%w', day) = strftime('%w', ${date}) DESC, day DESC
                    LIMIT 1
                `),
                DB_TIMEOUT_MS,
                'Earlier meal query timed out',
            );
            const day = result.rows[0]?.day;
            if (!day) return null;
            const endExclusive = shiftLocalDate(day, 1);
            const entries = await withTimeout(
                session.selectFrom('calorie_entries').selectAll()
                    .where('meal_type', '=', mealType)
                    .where('logged_at', '>=', day)
                    .where('logged_at', '<', endExclusive)
                    .orderBy('logged_at', 'asc').orderBy('id', 'asc')
                    .execute(),
                DB_TIMEOUT_MS,
                'Earlier meal query timed out',
            );
            return { date: String(day), entries };
        },

        /**
         * The foods most often logged in a meal over the last 60 days before a date,
         * each as its latest entry; a food counts by its library id, else by name.
         */
        async getUsualFoods(mealType: string, before: string, limit = 8): Promise<UsualFood[]> {
            const result = await withTimeout(
                session.execute(sql<UsualFood>`
                    SELECT * FROM (
                        SELECT entries.*,
                            COUNT(*) OVER (PARTITION BY usual_key) AS uses,
                            ROW_NUMBER() OVER (PARTITION BY usual_key ORDER BY entries.logged_at DESC, entries.id DESC) AS recency
                        FROM (
                            SELECT calorie_entries.*, CASE WHEN food_item_id != '' THEN food_item_id ELSE lower(trim(name)) END AS usual_key
                            FROM ${session.table('calorie_entries')} AS calorie_entries
                            WHERE meal_type = ${mealType} AND trim(name) != ''
                                AND logged_at >= ${shiftLocalDate(before, -60)} AND logged_at < ${shiftLocalDate(before, 1)}
                        ) AS entries
                    ) AS ranked
                    WHERE ranked.recency = 1
                    ORDER BY ranked.uses DESC, ranked.logged_at DESC
                    LIMIT ${limit}
                `),
                DB_TIMEOUT_MS,
                'Usual foods query timed out',
            );
            return result.rows.map((row) => ({ ...row, uses: toNumber(row.uses) }));
        },

        /** The latest entry of each of the given library foods, for their last portion. */
        async getLastEntriesForFoods(foodItemIds: readonly string[]): Promise<CalorieEntry[]> {
            if (foodItemIds.length === 0) return [];
            const result = await withTimeout(
                session.execute(sql<CalorieEntry>`
                    SELECT * FROM (
                        SELECT entries.*, ROW_NUMBER() OVER (PARTITION BY food_item_id ORDER BY logged_at DESC, id DESC) AS recency
                        FROM ${session.table('calorie_entries')} AS entries
                        WHERE food_item_id IN (${sql.join([...foodItemIds])})
                    ) AS ranked
                    WHERE ranked.recency = 1
                `),
                DB_TIMEOUT_MS,
                'Last portion query timed out',
            );
            return result.rows;
        },

        /**
         * Every day of a range with what was eaten and the goal in force, in one
         * query: SQLite walks the dates and picks each day's goal.
         */
        async getDailyBudgets(startDate: string, endDate: string): Promise<DailyBudgetRow[]> {
            const result = await withTimeout(
                session.execute(sql<{
                    day: string;
                    calories: number | string | null;
                    protein_g: number | string | null;
                    entries: number | string | null;
                    goal: number | string | null;
                    protein_target_g: number | string | null;
                }>`
                    WITH RECURSIVE dates(day) AS (
                        SELECT ${startDate}
                        UNION ALL SELECT date(day, '+1 day') FROM dates WHERE day < ${endDate}
                    ),
                    eaten AS (
                        SELECT substr(trim(logged_at), 1, 10) AS day,
                            SUM(COALESCE(calories, 0)) AS calories,
                            SUM(COALESCE(protein_g, 0)) AS protein_g,
                            COUNT(*) AS entries
                        FROM ${session.table('calorie_entries')} AS calorie_entries
                        WHERE logged_at >= ${startDate} AND logged_at < ${shiftLocalDate(endDate, 1)}
                        GROUP BY day
                    ),
                    goals AS (
                        SELECT dates.day, (
                            SELECT goals.id FROM ${session.table('nutrition_goals')} AS goals
                            WHERE goals.effective_from < date(dates.day, '+1 day')
                            ORDER BY goals.effective_from DESC, goals.updated_at DESC, goals.id DESC
                            LIMIT 1
                        ) AS goal_id
                        FROM dates
                    )
                    SELECT dates.day, eaten.calories, eaten.protein_g, eaten.entries,
                        chosen.calories_target AS goal, chosen.protein_target_g
                    FROM dates
                    LEFT JOIN eaten ON eaten.day = dates.day
                    LEFT JOIN goals ON goals.day = dates.day
                    LEFT JOIN ${session.table('nutrition_goals')} AS chosen ON chosen.id = goals.goal_id
                    ORDER BY dates.day
                `),
                DB_TIMEOUT_MS,
                'Daily budget query timed out',
            );
            return result.rows.map((row) => ({
                date: String(row.day),
                calories: toNumber(row.calories),
                proteinG: toNumber(row.protein_g),
                entries: toNumber(row.entries),
                goal: toNumber(row.goal),
                proteinTargetG: toNumber(row.protein_target_g),
            }));
        },

        /** Per meal over a range: on how many days, how much, and at what time it usually starts. */
        async getMealHabits(startDate: string, endDate: string): Promise<MealHabit[]> {
            const result = await withTimeout(
                session.execute(sql<{ meal_type: string; days: number | string; average_calories: number | string; average_minutes: number | string }>`
                    WITH per_day AS (
                        SELECT meal_type, substr(trim(logged_at), 1, 10) AS day,
                            SUM(COALESCE(calories, 0)) AS calories,
                            MIN(substr(trim(logged_at), 12, 5)) AS first_at
                        FROM ${session.table('calorie_entries')} AS calorie_entries
                        WHERE logged_at >= ${startDate} AND logged_at < ${shiftLocalDate(endDate, 1)}
                        GROUP BY meal_type, day
                    )
                    SELECT meal_type, COUNT(*) AS days, AVG(calories) AS average_calories,
                        AVG(CAST(substr(first_at, 1, 2) AS INTEGER) * 60 + CAST(substr(first_at, 4, 2) AS INTEGER)) AS average_minutes
                    FROM per_day
                    GROUP BY meal_type
                    ORDER BY average_minutes
                `),
                DB_TIMEOUT_MS,
                'Meal habits query timed out',
            );
            return result.rows.map((row) => ({
                mealType: String(row.meal_type),
                days: toNumber(row.days),
                averageCalories: toNumber(row.average_calories),
                averageMinutes: toNumber(row.average_minutes),
            }));
        },

        /** The foods logged most often in a range. */
        async getStaples(startDate: string, endDate: string, limit = 6): Promise<Staple[]> {
            const result = await withTimeout(
                session.execute(sql<{ name: string; food_item_id: string; uses: number | string; average_calories: number | string }>`
                    SELECT MAX(name) AS name, MAX(food_item_id) AS food_item_id, COUNT(*) AS uses, AVG(calories) AS average_calories
                    FROM ${session.table('calorie_entries')} AS calorie_entries
                    WHERE trim(name) != '' AND logged_at >= ${startDate} AND logged_at < ${shiftLocalDate(endDate, 1)}
                    GROUP BY CASE WHEN food_item_id != '' THEN food_item_id ELSE lower(trim(name)) END
                    ORDER BY uses DESC, name
                    LIMIT ${limit}
                `),
                DB_TIMEOUT_MS,
                'Staples query timed out',
            );
            return result.rows.map((row) => ({
                name: String(row.name),
                foodItemId: String(row.food_item_id ?? ''),
                uses: toNumber(row.uses),
                averageCalories: toNumber(row.average_calories),
            }));
        },

        /** How a library food has been used over the last 30 days, and its latest entry ever. */
        async getFoodUsage(foodItemId: string, through: string): Promise<FoodUsage> {
            const since = shiftLocalDate(through, -30);
            const [byMeal, last] = await Promise.all([
                withTimeout(
                    session.selectFrom('calorie_entries')
                        .select(({ fn }) => ['meal_type', fn.countAll<number>().as('uses')])
                        .where('food_item_id', '=', foodItemId)
                        .where('logged_at', '>=', since)
                        .where('logged_at', '<', shiftLocalDate(through, 1))
                        .groupBy('meal_type')
                        .orderBy('uses', 'desc')
                        .execute(),
                    DB_TIMEOUT_MS,
                    'Food usage query timed out',
                ),
                withTimeout(
                    session.selectFrom('calorie_entries').selectAll()
                        .where('food_item_id', '=', foodItemId)
                        .orderBy('logged_at', 'desc').orderBy('id', 'desc')
                        .limit(1)
                        .executeTakeFirst(),
                    DB_TIMEOUT_MS,
                    'Food usage query timed out',
                ),
            ]);
            const meals = byMeal.map((row) => ({ mealType: row.meal_type, uses: toNumber(row.uses) }));
            return {
                uses: meals.reduce((total, meal) => total + meal.uses, 0),
                lastUsed: last ? String(last.logged_at).slice(0, 10) : null,
                byMeal: meals,
                last: last ?? null,
            };
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
