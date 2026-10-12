import type { FoodItem } from '@hearthlog/sdk/data';
import type { NutritionTotals } from './logic.js';

export interface FoodItemDraft {
    name: string;
    brand: string;
    caloriesPer100g: number | null;
    proteinPer100g: number | null;
    carbsPer100g: number | null;
    fatPer100g: number | null;
    defaultServingG: number | null;
    servingLabel: string;
    favorite: boolean;
}

/**
 * The columns the food library sorts by: name, energy per 100 g, or how much
 * of that energy is protein. With none chosen it lists favorites first, by name.
 */
export const FOOD_SORT_COLUMNS = ['name', 'calories', 'protein'] as const;
export type FoodSortColumn = (typeof FOOD_SORT_COLUMNS)[number];

export interface FoodSort {
    column: FoodSortColumn | null;
    desc: boolean;
}

export const DEFAULT_FOOD_SORT: FoodSort = { column: null, desc: false };

/** `calories-desc` or `name-asc`; the older `calories` and `protein` read as highest first. */
export function parseFoodSort(value: string | null): FoodSort {
    const [column, direction] = (value ?? '').split('-');
    if (!(FOOD_SORT_COLUMNS as readonly string[]).includes(column)) return DEFAULT_FOOD_SORT;
    if (direction === 'asc' || direction === 'desc') return { column: column as FoodSortColumn, desc: direction === 'desc' };
    return column === 'name' ? DEFAULT_FOOD_SORT : { column: column as FoodSortColumn, desc: true };
}

/** The address value of a sort; null for the default order. */
export function foodSortValue(sort: FoodSort): string | null {
    return sort.column === null ? null : `${sort.column}-${sort.desc ? 'desc' : 'asc'}`;
}

/** Foods per page of the library. */
export const FOOD_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_FOOD_PAGE_SIZE = FOOD_PAGE_SIZES[0];

export interface EnergyShares {
    protein: number;
    carbs: number;
    fat: number;
}

/**
 * Where a food's energy comes from, as shares that add up to 1 (4 kcal per gram
 * of protein and carbs, 9 per gram of fat); all zero for a food without macros.
 */
export function energyShares(
    food: Pick<FoodItem, 'protein_per_100g' | 'carbs_per_100g' | 'fat_per_100g'>,
): EnergyShares {
    const protein = Math.max(0, food.protein_per_100g) * 4;
    const carbs = Math.max(0, food.carbs_per_100g) * 4;
    const fat = Math.max(0, food.fat_per_100g) * 9;
    const total = protein + carbs + fat;
    return total > 0 ? { protein: protein / total, carbs: carbs / total, fat: fat / total } : { protein: 0, carbs: 0, fat: 0 };
}

function normalizeSearch(value: string): string {
    return value.trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function roundNutrition(value: number): number {
    return Number(value.toFixed(1));
}

export function calculateNutritionForQuantity(
    food: FoodItem,
    quantityG: number,
): NutritionTotals {
    const factor = Math.max(0, quantityG) / 100;
    return {
        calories: roundNutrition(food.calories_per_100g * factor),
        proteinG: roundNutrition(food.protein_per_100g * factor),
        carbsG: roundNutrition(food.carbs_per_100g * factor),
        fatG: roundNutrition(food.fat_per_100g * factor),
    };
}

export function calculatePer100gFromEntry(
    totals: NutritionTotals,
    quantityG: number,
): NutritionTotals {
    if (!Number.isFinite(quantityG) || quantityG <= 0) {
        return { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    }
    const factor = 100 / quantityG;
    return {
        calories: roundNutrition(totals.calories * factor),
        proteinG: roundNutrition(totals.proteinG * factor),
        carbsG: roundNutrition(totals.carbsG * factor),
        fatG: roundNutrition(totals.fatG * factor),
    };
}

/**
 * Return the food's configured serving label when it represents a named
 * portion. Imported catalog foods can carry real serving labels (`kus`,
 * `porce`, …); the generic "100 g" label written by older imports is a
 * quantity rather than a serving.
 */
export function specificServingLabel(
    food: Pick<FoodItem, 'serving_label' | 'source_provider'>,
): string | null {
    const label = food.serving_label.trim();
    if (!label) return null;
    if (food.source_provider === 'kal-api' && /^100\s*g$/i.test(label)) return null;
    return label;
}

export function rankFoodItems(
    foods: FoodItem[],
    query: string,
    recentFoodIds: string[] = [],
): FoodItem[] {
    const normalizedQuery = normalizeSearch(query);
    const recentRank = new Map(recentFoodIds.map((id, index) => [id, index]));

    return foods
        .filter((food) => {
            if (!normalizedQuery) return true;
            return normalizeSearch(`${food.name} ${food.brand}`).includes(normalizedQuery);
        })
        .sort((left, right) => {
            if (normalizedQuery) {
                const leftStarts = normalizeSearch(left.name).startsWith(normalizedQuery);
                const rightStarts = normalizeSearch(right.name).startsWith(normalizedQuery);
                if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
            }
            if (left.favorite !== right.favorite) return Number(right.favorite) - Number(left.favorite);
            const leftRecent = recentRank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
            const rightRecent = recentRank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
            if (leftRecent !== rightRecent) return leftRecent - rightRecent;
            return left.name.localeCompare(right.name) || left.brand.localeCompare(right.brand);
        });
}

export function validateFoodItemDraft(draft: FoodItemDraft): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!draft.name.trim()) errors.name = 'Enter a food name.';
    if (
        draft.caloriesPer100g === null ||
        !Number.isFinite(draft.caloriesPer100g) ||
        draft.caloriesPer100g < 0
    ) {
        errors.caloriesPer100g = 'Calories per 100 g cannot be negative.';
    }
    for (const [key, value, label] of [
        ['proteinPer100g', draft.proteinPer100g, 'Protein'],
        ['carbsPer100g', draft.carbsPer100g, 'Carbohydrates'],
        ['fatPer100g', draft.fatPer100g, 'Fat'],
    ] as const) {
        if (value !== null && (!Number.isFinite(value) || value < 0)) {
            errors[key] = `${label} cannot be negative.`;
        }
    }
    if (
        draft.defaultServingG === null ||
        !Number.isFinite(draft.defaultServingG) ||
        draft.defaultServingG <= 0
    ) {
        errors.defaultServingG = 'Default serving must be greater than zero.';
    }
    return errors;
}
