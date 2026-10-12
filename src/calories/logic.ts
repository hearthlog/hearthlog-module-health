import type { CalorieEntry } from '@hearthlog/sdk/data';
import {
    CALORIE_CALCULATION_METHOD,
    validateCalorieGoalCalculationInput,
    type CalorieActivityLevel,
    type CalorieCalculationSelection,
    type CalorieCalculationSex,
    type CalorieTargetSource,
} from './goal-calculator.js';

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

/** Row shape of a persisted meal slot; kept structural so logic stays DB-free. */
export interface StoredMealSlot {
    id: string;
    label: string;
    sort_order: number;
    archived: boolean;
}

/** A meal slot as the diary renders and edits it. */
export interface MealSlotView {
    id: string;
    label: string;
    sortOrder: number;
    archived: boolean;
    builtIn: boolean;
}

/**
 * The four canonical meals exist without persisted rows so an untouched diary
 * works exactly as before. Any customization materializes every one of them as
 * an entity first, which is what makes hiding a built-in meal possible.
 */
export const DEFAULT_MEAL_SLOTS: readonly MealSlotView[] = MEAL_TYPES.map(
    (id, index) => ({
        id,
        label: id.charAt(0).toUpperCase() + id.slice(1),
        sortOrder: index,
        archived: false,
        builtIn: true,
    }),
);

/** Groups entries whose stored meal value no longer matches any slot. */
export const OTHER_MEAL_SLOT: MealSlotView = {
    id: '__other__',
    label: 'Other',
    sortOrder: Number.MAX_SAFE_INTEGER,
    archived: false,
    builtIn: false,
};

/**
 * Persisted slots replace the canonical defaults wholesale once any exist:
 * a missing built-in then means the user removed it, not that it is implicit.
 * Callers pass rows in SQL order (`sort_order`, `id`); this only maps them.
 */
export function effectiveMealSlots(stored: readonly StoredMealSlot[]): MealSlotView[] {
    if (stored.length === 0) return DEFAULT_MEAL_SLOTS.map((slot) => ({ ...slot }));
    return stored.map((slot): MealSlotView => ({
        id: slot.id,
        label: slot.label.trim() || slot.id,
        sortOrder: Number(slot.sort_order) || 0,
        archived: Boolean(slot.archived),
        builtIn: (MEAL_TYPES as readonly string[]).includes(slot.id),
    }));
}

function minutesIntoDay(value: string | Date): number {
    if (value instanceof Date) return value.getHours() * 60 + value.getMinutes();
    const match = value.match(/[T ](\d{2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : 12 * 60;
}

/** The canonical meal a time of day usually belongs to. */
export function mealForTime(value: string | Date = new Date()): MealType {
    const minutes = minutesIntoDay(value);
    if (minutes < 4 * 60) return 'snack';
    if (minutes < 10 * 60 + 30) return 'breakfast';
    if (minutes < 15 * 60) return 'lunch';
    if (minutes < 21 * 60 + 30) return 'dinner';
    return 'snack';
}

/**
 * The slot a new entry should start in: the canonical meal for the time when
 * it exists, a renamed slot carrying that name, otherwise the first visible
 * slot so custom-only diaries still land somewhere sensible.
 */
export function resolveDefaultMeal(
    slots: readonly MealSlotView[],
    value: string | Date = new Date(),
): string {
    const active = slots.filter((slot) => !slot.archived);
    const preferred = mealForTime(value);
    if (active.some((slot) => slot.id === preferred)) return preferred;
    const renamed = active.find(
        (slot) => slot.label.trim().toLowerCase() === preferred,
    );
    if (renamed) return renamed.id;
    return active[0]?.id ?? preferred;
}

/** Shifts a stored local date-time by whole days, keeping its time of day. */
export function shiftLoggedAt(value: string, days: number): string {
    const normalized = normalizeLocalDateTime(value) || `${toLocalDateString()}T12:00`;
    const [date, time] = normalized.split('T');
    return `${shiftLocalDate(date, days)}T${time ?? '12:00'}`;
}

/** Moves a stored local date-time to another day, keeping its time of day. */
export function loggedAtOnDate(value: string, date: string): string {
    const normalized = normalizeLocalDateTime(value);
    const time = normalized ? normalized.slice(11, 16) : '12:00';
    return `${date}T${time}`;
}

export interface CalorieEntryDraft {
    name: string;
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    mealType: string;
    loggedAt: string;
    foodItemId: string;
    quantityG: number | null;
    portionLabel: string;
    notes: string;
}

export interface NutritionGoalDraft {
    effectiveFrom: string;
    caloriesTarget: number | null;
    proteinTargetG: number | null;
    carbsTargetG: number | null;
    fatTargetG: number | null;
    calorieTargetSource: CalorieTargetSource;
    calculationMethod: typeof CALORIE_CALCULATION_METHOD | '';
    calculationResult: CalorieCalculationSelection | '';
    calculatedCalories: number | null;
    calculationCurrentWeightKg: number | null;
    calculationTargetWeightKg: number | null;
    calculationHeightCm: number | null;
    calculationAgeYears: number | null;
    calculationSex: CalorieCalculationSex | '';
    calculationActivityLevel: CalorieActivityLevel | '';
    calculationTargetDate: string;
}

export interface NutritionTotals {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

export function toLocalDateString(date = new Date()): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toLocalDateTimeString(date = new Date()): string {
    return `${toLocalDateString(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseSelectedDate(value: string | null | undefined, fallback = toLocalDateString()): string {
    const match = value?.match(DATE_PATTERN);
    if (!match) return fallback;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day, 12, 0, 0);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
        ? value!
        : fallback;
}

export function shiftLocalDate(value: string, days: number): string {
    const selected = parseSelectedDate(value);
    const [year, month, day] = selected.split('-').map(Number);
    const date = new Date(year, month - 1, day + days, 12, 0, 0);
    return toLocalDateString(date);
}

export function datePart(value: string): string {
    return value.trim().slice(0, 10);
}

export function normalizeLocalDateTime(value: unknown): string {
    if (!value) return '';
    const raw = String(value).trim();
    const local = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (local) return `${local[1]}T${local[2]}`;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : toLocalDateTimeString(parsed);
}

export function totalEntries(entries: CalorieEntry[]): NutritionTotals {
    return entries.reduce(
        (total, entry) => ({
            calories: total.calories + Number(entry.calories || 0),
            proteinG: total.proteinG + Number(entry.protein_g || 0),
            carbsG: total.carbsG + Number(entry.carbs_g || 0),
            fatG: total.fatG + Number(entry.fat_g || 0),
        }),
        { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    );
}

export interface MealGroup {
    slot: MealSlotView;
    entries: CalorieEntry[];
}

/**
 * Buckets a day's entries by meal slot, preserving the SQL order of both the
 * slots and the entries, and hiding nothing: callers decide which empty or
 * archived groups to render. Entries whose meal value matches no slot land in
 * a trailing "Other" group instead of silently disappearing from the diary.
 */
export function groupEntriesByMeal(
    entries: CalorieEntry[],
    slots: readonly MealSlotView[],
): MealGroup[] {
    const known = new Set(slots.map((slot) => slot.id));
    const bySlot = new Map<string, CalorieEntry[]>();
    const orphans: CalorieEntry[] = [];
    for (const entry of entries) {
        if (!known.has(entry.meal_type)) {
            orphans.push(entry);
            continue;
        }
        const group = bySlot.get(entry.meal_type);
        if (group) group.push(entry);
        else bySlot.set(entry.meal_type, [entry]);
    }
    const groups = slots.map((slot): MealGroup => ({
        slot,
        entries: bySlot.get(slot.id) ?? [],
    }));
    if (orphans.length > 0) {
        groups.push({ slot: OTHER_MEAL_SLOT, entries: orphans });
    }
    return groups;
}

export function validateCalorieEntryDraft(draft: CalorieEntryDraft): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!draft.name.trim()) errors.name = 'Enter a food name.';
    if (draft.calories === null || !Number.isFinite(draft.calories) || draft.calories < 0) {
        errors.calories = 'Calories cannot be negative.';
    }
    for (const [key, value, label] of [
        ['proteinG', draft.proteinG, 'Protein'],
        ['carbsG', draft.carbsG, 'Carbohydrates'],
        ['fatG', draft.fatG, 'Fat'],
    ] as const) {
        if (value !== null && (!Number.isFinite(value) || value < 0)) errors[key] = `${label} cannot be negative.`;
    }
    if (!draft.mealType || !draft.mealType.trim()) errors.mealType = 'Choose a meal.';
    if (!normalizeLocalDateTime(draft.loggedAt)) errors.loggedAt = 'Choose a valid date and time.';
    if (draft.quantityG !== null && (!Number.isFinite(draft.quantityG) || draft.quantityG < 0)) {
        errors.quantityG = 'Quantity cannot be negative.';
    }
    if (draft.foodItemId && (!draft.quantityG || draft.quantityG <= 0)) {
        errors.quantityG = 'Enter a quantity for the selected food.';
    }
    return errors;
}

export function validateNutritionGoalDraft(draft: NutritionGoalDraft): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!draft.effectiveFrom || parseSelectedDate(draft.effectiveFrom, '') !== draft.effectiveFrom) {
        errors.effectiveFrom = 'Choose a valid effective date.';
    }
    if (draft.caloriesTarget === null || !Number.isFinite(draft.caloriesTarget) || draft.caloriesTarget <= 0) {
        errors.caloriesTarget = 'Calorie target must be greater than zero.';
    }
    for (const [key, value, label] of [
        ['proteinTargetG', draft.proteinTargetG, 'Protein target'],
        ['carbsTargetG', draft.carbsTargetG, 'Carbohydrate target'],
        ['fatTargetG', draft.fatTargetG, 'Fat target'],
    ] as const) {
        if (value !== null && (!Number.isFinite(value) || value < 0)) errors[key] = `${label} cannot be negative.`;
    }
    if (draft.calorieTargetSource !== 'manual') {
        Object.assign(errors, validateCalorieGoalCalculationInput({
            effectiveFrom: draft.effectiveFrom,
            targetDate: draft.calculationTargetDate,
            currentWeightKg: draft.calculationCurrentWeightKg ?? Number.NaN,
            targetWeightKg: draft.calculationTargetWeightKg ?? Number.NaN,
            heightCm: draft.calculationHeightCm ?? Number.NaN,
            ageYears: draft.calculationAgeYears ?? Number.NaN,
            sex: draft.calculationSex || undefined,
            activityLevel: draft.calculationActivityLevel || undefined,
        }));
        if (draft.calculationMethod !== CALORIE_CALCULATION_METHOD) {
            errors.calculationMethod = 'Recalculate this target with the current calculator.';
        }
        if (draft.calculationResult !== 'reach_goal' && draft.calculationResult !== 'target_maintenance') {
            errors.calculationResult = 'Choose one of the calculated targets.';
        }
        if (
            draft.calculatedCalories === null
            || !Number.isFinite(draft.calculatedCalories)
            || draft.calculatedCalories <= 0
        ) {
            errors.calculatedCalories = 'Apply one of the calculated targets.';
        }
    }
    return errors;
}
