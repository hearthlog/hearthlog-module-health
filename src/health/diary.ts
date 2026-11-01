/** The diary's meals: pure, so the page and its tests share them. */

import type { CalorieEntry } from '@hearthlog/sdk/data';
import type { MealSlotView } from '../calories/logic.js';

/** One meal of the diary: its slot, its entries, and their sums. */
export interface DiaryMeal {
    slot: MealSlotView;
    entries: CalorieEntry[];
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
}

export function entrySum(entries: readonly CalorieEntry[], key: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g'): number {
    return entries.reduce((total, entry) => total + (Number(entry[key]) || 0), 0);
}

/**
 * The meals of a day in slot order. Entries whose slot was removed gather in
 * an Other meal at the end.
 */
export function diaryMeals(slots: readonly MealSlotView[], entries: readonly CalorieEntry[]): DiaryMeal[] {
    const visible = slots.filter((slot) => !slot.archived);
    const known = new Set(visible.map((slot) => slot.id));
    const meals = visible.map((slot) => entries.filter((entry) => entry.meal_type === slot.id));
    const others = entries.filter((entry) => !known.has(entry.meal_type));
    const all = visible.map((slot, index) => ({ slot, entries: meals[index] }));
    if (others.length > 0) all.push({ slot: { id: '__other__', label: 'Other', sortOrder: 999, archived: false, builtIn: false }, entries: others });
    return all.map(({ slot, entries: rows }) => ({
        slot,
        entries: rows,
        calories: Math.round(entrySum(rows, 'calories')),
        proteinG: entrySum(rows, 'protein_g'),
        carbsG: entrySum(rows, 'carbs_g'),
        fatG: entrySum(rows, 'fat_g'),
    }));
}

/**
 * The first empty meal after the last one with food: what the day is likely to
 * log next. Snacks happen at any hour, so they neither count as the last meal
 * nor get offered.
 */
export function nextMealSlot(meals: readonly DiaryMeal[]): string | null {
    const fixed = meals.filter((meal) => meal.slot.id !== 'snack' && meal.slot.id !== '__other__');
    const lastFilled = fixed.reduce((last, meal, index) => (meal.entries.length > 0 ? index : last), -1);
    return fixed.slice(lastFilled + 1).find((meal) => meal.entries.length === 0)?.slot.id ?? null;
}
