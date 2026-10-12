import { executeLocalCommand } from '@hearthlog/sdk/data';
import { refreshPageData as invalidate } from '@hearthlog/sdk/runtime';
import type {
    AddMealSlotEvent,
    AppEvent,
    UpdateMealSlotEvent,
} from '@hearthlog/sdk/data';
import { DEFAULT_MEAL_SLOTS, type StoredMealSlot } from './logic.js';

/**
 * The four canonical meals stay implicit until the diary is customized. Any
 * slot mutation therefore prefixed with a bootstrap that materializes them,
 * so hiding or renaming a built-in sticks instead of the default reappearing.
 */
export function mealSlotBootstrapEvents(
    stored: readonly StoredMealSlot[],
): AddMealSlotEvent[] {
    if (stored.length > 0) return [];
    return DEFAULT_MEAL_SLOTS.map((slot) =>
        mealSlotAddEvent(slot.label, slot.sortOrder, slot.id));
}

export function mealSlotAddEvent(
    label: string,
    sortOrder: number,
    id: string = crypto.randomUUID(),
): AddMealSlotEvent {
    return {
        id: crypto.randomUUID(),
        type: 'MEAL_SLOT_ADDED',
        timestamp: Date.now(),
        payload: { id, label, sortOrder, archived: false },
    };
}

export function mealSlotUpdateEvent(
    id: string,
    changes: { label?: string; sortOrder?: number; archived?: boolean },
): UpdateMealSlotEvent {
    return {
        id: crypto.randomUUID(),
        type: 'MEAL_SLOT_UPDATED',
        timestamp: Date.now(),
        payload: { id, ...changes },
    };
}

/** Commits a meal-slot batch and refreshes every diary reader. */
export async function commitMealSlotEvents(events: AppEvent[]): Promise<void> {
    if (events.length === 0) return;
    await executeLocalCommand(events);
    await invalidate('app:calories');
}
