import type { KalServing } from '../api/kal.js';

export const DEFAULT_SERVING_G = 100;

/** A partial food-item update produced by refreshing servings from the catalog. */
export interface ImportedServingUpdate {
    id: string;
    sourceServingsJson: string;
    defaultServingG?: number;
    servingLabel?: string;
}

function parseStoredServing(value: unknown): KalServing | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const unit = record.unit;
    const amount = record.amount;
    if ((unit !== 'g' && unit !== 'ml') || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        return null;
    }
    const label = typeof record.label === 'string' ? record.label : null;
    const title = typeof record.title === 'string' && record.title.trim()
        ? record.title
        : label ?? `${amount} ${unit}`;
    return { label, title, amount, unit };
}

/**
 * Safely read the source servings persisted on a food item. Stored data is a
 * JSON snapshot of the kal API `Serving` array; invalid entries are dropped
 * instead of failing the whole library.
 */
export function parseStoredServings(json: string): KalServing[] {
    if (!json) return [];
    try {
        const value = JSON.parse(json) as unknown;
        if (!Array.isArray(value)) return [];
        return value.map(parseStoredServing).filter((serving): serving is KalServing => serving !== null);
    } catch {
        return [];
    }
}

/**
 * Servings usable for logging, in source order. Milliliters are allowed under
 * the deliberate 1 g/ml estimate: the diary is gram-based and the source API
 * publishes nutrition per 100 g without a density, so volume portions are
 * approximations (exact for water-like liquids).
 */
export function selectableServings(servings: KalServing[]): KalServing[] {
    return servings.filter((serving) => serving.amount > 0);
}

/** Grams represented by one serving; 1 ml is estimated as 1 g. */
export function servingGrams(serving: KalServing): number {
    return serving.amount;
}

/** Picker label: "90 g · kus", "300 ml (≈ 300 g)". */
export function servingOptionLabel(serving: KalServing): string {
    const amount = Number.isInteger(serving.amount)
        ? String(serving.amount)
        : String(Number(serving.amount.toFixed(1)));
    const label = serving.label?.trim();
    const base = label ? `${amount} ${serving.unit} · ${label}` : serving.title.trim();
    return serving.unit === 'ml' ? `${base} (≈ ${amount} g)` : base;
}

/** Short display name of a serving: the Czech kind, or the site title. */
export function servingLabel(serving: KalServing): string {
    const label = serving.label?.trim();
    return label || serving.title.trim();
}

/** The serving a fresh import starts with; falls back to the generic 100 g. */
export function pickDefaultServing(servings: KalServing[]): { amount: number; label: string } {
    const serving = selectableServings(servings)[0];
    if (!serving) return { amount: DEFAULT_SERVING_G, label: '' };
    return { amount: servingGrams(serving), label: servingLabel(serving) };
}

/**
 * True when the food item still carries the pre-servings placeholder. Such a
 * default may be replaced when serving metadata arrives for the first time.
 */
export function isPlaceholderServing(
    food: { default_serving_g: number; serving_label: string },
): boolean {
    const label = food.serving_label.trim();
    return food.default_serving_g === DEFAULT_SERVING_G && (label === '' || /^100\s*g$/i.test(label));
}
