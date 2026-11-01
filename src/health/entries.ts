/**
 * Writing diary entries: from a food and a portion, from a number with a
 * name, or as a copy of earlier entries. Deleting keeps Undo instead of
 * asking first.
 */

import type { AddCalorieEntryEvent, AddFoodItemEvent, AppEvent, CalorieEntry, FoodItem, RemoveCalorieEntryEvent, UpdateCalorieEntryEvent } from '@hearthlog/sdk/data';
import { executeLocalCommand } from '@hearthlog/sdk/data';
import { notify, refreshPageData } from '@hearthlog/sdk/runtime';
import { formatNumber } from '@hearthlog/sdk/format';
import { calculateNutritionForQuantity, specificServingLabel } from '../calories/food-logic.js';
import { normalizeLocalDateTime } from '../calories/logic.js';
import { parseStoredServings, selectableServings, servingLabel } from '../calories/servings.js';
import type { ExternalFoodImport } from '../calories/external-food.js';

/** One portion a food can be logged in. */
export interface PortionChoice {
    /** `piece`, `slice`, or `g` for plain grams. */
    label: string;
    grams: number;
}

/** A food's named portions, then grams. The default serving leads when it is a named one. */
export function foodPortions(food: FoodItem): PortionChoice[] {
    const choices: PortionChoice[] = [];
    const named = specificServingLabel(food);
    if (named && food.default_serving_g > 0) choices.push({ label: named, grams: Number(food.default_serving_g) });
    for (const serving of selectableServings(parseStoredServings(food.source_servings_json))) {
        const label = servingLabel(serving);
        if (label && serving.unit !== 'ml' && !choices.some((choice) => choice.label === label)) choices.push({ label, grams: serving.amount });
    }
    choices.push({ label: 'g', grams: 1 });
    return choices;
}

/** `2 × rohlík` for pieces, `150 g` for grams. */
export function portionText(amount: number, choice: PortionChoice): string {
    const rounded = Number(amount.toFixed(choice.label === 'g' ? 0 : 2));
    return choice.label === 'g' ? `${formatNumber(rounded)} g` : `${formatNumber(rounded)} × ${choice.label}`;
}

/** What a logged entry carries before it gets an id. */
export interface EntryDraft {
    name: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    foodItemId: string;
    quantityG: number;
    portionLabel: string;
    notes?: string;
}

export function draftFromFood(food: FoodItem, amount: number, choice: PortionChoice): EntryDraft {
    const grams = amount * choice.grams;
    const totals = calculateNutritionForQuantity(food, grams);
    return {
        name: food.name,
        calories: Math.round(totals.calories),
        proteinG: totals.proteinG,
        carbsG: totals.carbsG,
        fatG: totals.fatG,
        foodItemId: food.id,
        quantityG: Number(grams.toFixed(1)),
        portionLabel: portionText(amount, choice),
    };
}

/** An earlier entry as a new draft, optionally times a number of portions. */
export function draftFromEntry(entry: CalorieEntry, times = 1): EntryDraft {
    const scale = (value: number) => Number(((Number(value) || 0) * times).toFixed(1));
    const quantity = scale(entry.quantity_g);
    return {
        name: entry.name,
        calories: Math.round((Number(entry.calories) || 0) * times),
        proteinG: scale(entry.protein_g),
        carbsG: scale(entry.carbs_g),
        fatG: scale(entry.fat_g),
        foodItemId: entry.food_item_id ?? '',
        quantityG: quantity,
        portionLabel: times === 1 ? entry.portion_label ?? '' : quantity > 0 ? `${formatNumber(quantity)} g` : '',
    };
}

/** The portion a recent entry used, so a food comes back the way it was last eaten. */
export function lastPortion(food: FoodItem, last: CalorieEntry | undefined): { amount: number; choice: PortionChoice } {
    const choices = foodPortions(food);
    const grams = Number(last?.quantity_g) || 0;
    if (grams > 0) {
        const named = choices.find((choice) => choice.label !== 'g' && last?.portion_label?.includes(choice.label));
        if (named) return { amount: Number((grams / named.grams).toFixed(2)), choice: named };
        return { amount: grams, choice: choices[choices.length - 1] };
    }
    const first = choices[0];
    return first.label === 'g' ? { amount: Number(food.default_serving_g) || 100, choice: first } : { amount: 1, choice: first };
}

export function addEntryEvent(draft: EntryDraft, mealType: string, loggedAt: string): AddCalorieEntryEvent {
    return {
        id: crypto.randomUUID(),
        type: 'CALORIE_ENTRY_ADDED',
        timestamp: Date.now(),
        payload: {
            id: crypto.randomUUID(),
            name: draft.name.trim(),
            calories: draft.calories,
            proteinG: draft.proteinG,
            carbsG: draft.carbsG,
            fatG: draft.fatG,
            mealType,
            loggedAt: normalizeLocalDateTime(loggedAt),
            foodItemId: draft.foodItemId,
            quantityG: draft.quantityG,
            portionLabel: draft.portionLabel,
            notes: draft.notes ?? '',
        },
    };
}

export function importFoodEvent(food: ExternalFoodImport): AddFoodItemEvent {
    return { id: crypto.randomUUID(), type: 'FOOD_ITEM_ADDED', timestamp: Date.now(), payload: { ...food } };
}

function removeEvent(id: string): RemoveCalorieEntryEvent {
    return { id: crypto.randomUUID(), type: 'CALORIE_ENTRY_REMOVED', timestamp: Date.now(), payload: { id } };
}

/** The time an entry logged now gets: the clock today, noon on another day. */
export function entryTime(date: string, today: string, now: Date): string {
    if (date !== today) return `${date}T12:00`;
    return `${date}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Writes entries (and any catalog foods they came from) in one command. The
 * shell then names the change and offers Undo, which removes exactly these.
 */
export async function logEntries(events: AppEvent[], submissionId?: string): Promise<void> {
    await executeLocalCommand(events, submissionId ? { submissionId } : undefined);
    // Saved is saved: a sheet can close while the day reads again.
    void refreshPageData('app:calories');
}

/** Removes an entry at once; Undo writes it back with the same values. */
export async function removeEntry(entry: CalorieEntry): Promise<void> {
    await executeLocalCommand(removeEvent(entry.id));
    await refreshPageData('app:calories');
    notify.success(`Removed ${entry.name} · ${formatNumber(Math.round(Number(entry.calories)))}`, {
        label: 'Undo',
        run: async () => {
            try {
                await executeLocalCommand(addEntryEvent(draftFromEntry(entry), entry.meal_type, String(entry.logged_at)));
                await refreshPageData('app:calories');
            } catch {
                notify.error('Could not undo');
            }
        },
    });
}

/** Changes some fields of an entry; Undo puts the old values back. */
export async function updateEntry(entry: CalorieEntry, changes: Partial<UpdateCalorieEntryEvent['payload']>, message: string): Promise<void> {
    const event: UpdateCalorieEntryEvent = { id: crypto.randomUUID(), type: 'CALORIE_ENTRY_UPDATED', timestamp: Date.now(), payload: { id: entry.id, ...changes } };
    const previous: Partial<UpdateCalorieEntryEvent['payload']> = {
        calories: Number(entry.calories),
        proteinG: Number(entry.protein_g),
        carbsG: Number(entry.carbs_g),
        fatG: Number(entry.fat_g),
        quantityG: Number(entry.quantity_g),
        portionLabel: entry.portion_label ?? '',
        mealType: entry.meal_type,
        loggedAt: String(entry.logged_at),
    };
    await executeLocalCommand(event);
    await refreshPageData('app:calories');
    notify.success(message, {
        label: 'Undo',
        run: async () => {
            try {
                await executeLocalCommand({ id: crypto.randomUUID(), type: 'CALORIE_ENTRY_UPDATED', timestamp: Date.now(), payload: { id: entry.id, ...previous } } satisfies UpdateCalorieEntryEvent);
                await refreshPageData('app:calories');
            } catch {
                notify.error('Could not undo');
            }
        },
    });
}

/** A new amount for an entry measured in grams: every value scales with it. */
export function scaledEntry(entry: CalorieEntry, grams: number): Partial<UpdateCalorieEntryEvent['payload']> {
    const before = Number(entry.quantity_g) || 0;
    if (!(before > 0) || !(grams > 0)) return {};
    const factor = grams / before;
    const scale = (value: number) => Number(((Number(value) || 0) * factor).toFixed(1));
    return {
        calories: Math.round((Number(entry.calories) || 0) * factor),
        proteinG: scale(entry.protein_g),
        carbsG: scale(entry.carbs_g),
        fatG: scale(entry.fat_g),
        quantityG: Number(grams.toFixed(1)),
        portionLabel: `${formatNumber(Number(grams.toFixed(0)))} g`,
    };
}
