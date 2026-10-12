/**
 * BMI Store - Manages height (localStorage) and weight history (from DB)
 * Weight entries are stored via event sourcing, height is stored locally.
 */

import { commandActionsAvailable } from '@hearthlog/sdk/runtime';
import { untrack } from 'svelte';

const HEIGHT_STORAGE_KEY = 'bmi-height';

export interface WeightLogEntry {
    id: string;
    weight: number;
    height: number;
    date: string;
    notes: string | null;
}

function normalizePositiveNumber(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return null;
    }

    return value;
}

function loadHeightFromStorage(): number | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const stored = localStorage.getItem(HEIGHT_STORAGE_KEY);
        if (stored) return normalizePositiveNumber(Number(stored));
    } catch {
        // Ignore
    }
    return null;
}

function saveHeightToStorage(height: number | null): void {
    if (typeof localStorage === 'undefined') return;
    if (height !== null) {
        localStorage.setItem(HEIGHT_STORAGE_KEY, String(height));
    } else {
        localStorage.removeItem(HEIGHT_STORAGE_KEY);
    }
}

function createBmiStore() {
    let height = $state<number | null>(loadHeightFromStorage());
    let weight = $state<number | null>(null);
    let history = $state<WeightLogEntry[]>([]);
    let viewOverride = $state<{
        height: number | null;
        weight: number | null;
        history: WeightLogEntry[];
    } | null>(null);
    const visibleHeight = $derived(viewOverride?.height ?? height);
    const visibleWeight = $derived(viewOverride?.weight ?? weight);
    const visibleHistory = $derived(viewOverride?.history ?? history);

    // Derived: BMI calculation
    const bmi = $derived.by(() => {
        if (visibleHeight === null || visibleWeight === null) return null;
        const heightInMeters = visibleHeight / 100;
        return Number((visibleWeight / (heightInMeters * heightInMeters)).toFixed(1));
    });

    // Derived: Ideal weight range
    const idealWeightRange = $derived.by(() => {
        if (visibleHeight === null) return null;
        const h = visibleHeight / 100;
        const hSq = h * h;
        return {
            min: Number((18.5 * hSq).toFixed(1)),
            max: Number((24.9 * hSq).toFixed(1))
        };
    });

    return {
        get height() { return visibleHeight; },
        get weight() { return visibleWeight; },
        get history() { return visibleHistory; },
        get bmi() { return bmi; },
        get idealWeightRange() { return idealWeightRange; },

        setHeight(value: number | null) {
            if (viewOverride) return;
            const normalized = normalizePositiveNumber(value);
            height = normalized;
            saveHeightToStorage(normalized);
        },

        setWeight(value: number | null) {
            if (viewOverride) return;
            weight = normalizePositiveNumber(value);
        },

        /**
         * Load history from the database. The caller passes rows in SQL order
         * (`date`, `created_at`, `id`); this store never re-sorts or filters.
         */
        setDatabaseView(entries: WeightLogEntry[]) {
            if (commandActionsAvailable()) {
                viewOverride = null;
                history = entries;
                weight = entries.at(-1)?.weight ?? null;
                const latestHeight = entries.at(-1)?.height;
                if (untrack(() => height === null) && latestHeight !== undefined) {
                    height = normalizePositiveNumber(latestHeight);
                    saveHeightToStorage(height);
                }
                return;
            }
            const latest = entries.at(-1) ?? null;
            viewOverride = {
                history: entries,
                weight: latest?.weight ?? null,
                height: latest?.height ?? null,
            };
        },

        clearDatabaseView() {
            viewOverride = null;
        },
    };
}

export const bmiStore = createBmiStore();
