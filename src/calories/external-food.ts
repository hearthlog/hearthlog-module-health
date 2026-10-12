import { getKalFood, type KalEanConfidence, type KalFood, type KalServing } from '../api/kal.js';
import type { FoodItem } from '@hearthlog/sdk/data';
import {
    isPlaceholderServing,
    parseStoredServings,
    pickDefaultServing,
    type ImportedServingUpdate,
} from './servings.js';

export const KAL_SOURCE_PROVIDER = 'kal-api';

export interface ExternalFoodImport {
    id: string;
    name: string;
    brand: string;
    caloriesPer100g: number;
    proteinPer100g: number;
    carbsPer100g: number;
    fatPer100g: number;
    defaultServingG: number;
    servingLabel: string;
    favorite: boolean;
    sourceProvider: string;
    sourceId: string;
    sourceSlug: string;
    sourceDataVersion: string;
    sourceMissingNutrients: string;
    sourceEan: string;
    sourceEanConfidence: string;
    sourceServingsJson: string;
}

export function externalFoodId(food: Pick<KalFood, 'guid'>): string {
    const guid = food.guid.trim();
    return `${KAL_SOURCE_PROVIDER}-${guid}`;
}

export function missingNutrients(food: KalFood): string[] {
    const fields: Array<[string, number | null]> = [
        ['calories', food.energyKcal],
        ['protein', food.proteinG],
        ['carbs', food.carbsG],
        ['fat', food.fatG],
    ];
    return fields.filter(([, value]) => value === null).map(([field]) => field);
}

export function toExternalFoodImport(
    food: KalFood,
    options: {
        dataVersion?: string;
        ean?: string;
        eanConfidence?: KalEanConfidence | '';
        servings?: KalServing[];
    } = {},
): ExternalFoodImport {
    const servings = options.servings ?? [];
    const defaultServing = pickDefaultServing(servings);
    return {
        id: externalFoodId(food),
        name: food.name.trim(),
        brand: food.brand.trim(),
        caloriesPer100g: food.energyKcal ?? 0,
        proteinPer100g: food.proteinG ?? 0,
        carbsPer100g: food.carbsG ?? 0,
        fatPer100g: food.fatG ?? 0,
        defaultServingG: defaultServing.amount,
        servingLabel: defaultServing.label,
        favorite: false,
        sourceProvider: KAL_SOURCE_PROVIDER,
        sourceId: food.guid,
        sourceSlug: food.slug,
        sourceDataVersion: options.dataVersion ?? '',
        sourceMissingNutrients: JSON.stringify(missingNutrients(food)),
        sourceEan: options.ean ?? '',
        sourceEanConfidence: options.eanConfidence ?? '',
        sourceServingsJson: JSON.stringify(servings),
    };
}

export function hasKnownCalories(food: KalFood): boolean {
    return food.energyKcal !== null && Number.isFinite(food.energyKcal);
}

type StoredServingSource = Pick<
    FoodItem,
    | 'id'
    | 'source_provider'
    | 'source_slug'
    | 'source_servings_json'
    | 'default_serving_g'
    | 'serving_label'
>;

/** What one catalog lookup produced for a food item that lacks servings. */
export type ImportedServingsFetch =
    | { status: 'updated'; update: ImportedServingUpdate }
    | { status: 'empty' }
    | { status: 'failed' };

/** True for a catalog import whose source servings were never stored. */
export function needsServingsRefresh(food: StoredServingSource): boolean {
    return food.source_provider === KAL_SOURCE_PROVIDER
        && Boolean(food.source_slug)
        && parseStoredServings(food.source_servings_json).length === 0;
}

/**
 * Fetch one catalog food's servings without the once-per-session guard, for
 * callers that manage their own retry policy (the bulk library refresh).
 * `empty` means the source publishes only generic reference units.
 */
export async function fetchImportedServingsUpdate(
    food: StoredServingSource,
    options: { signal?: AbortSignal } = {},
): Promise<ImportedServingsFetch> {
    if (!needsServingsRefresh(food)) return { status: 'empty' };

    let servings: KalServing[];
    try {
        servings = (await getKalFood(food.source_slug, { signal: options.signal })).servings;
    } catch {
        return { status: 'failed' };
    }
    if (servings.length === 0) return { status: 'empty' };

    const update: ImportedServingUpdate = {
        id: food.id,
        sourceServingsJson: JSON.stringify(servings),
    };
    if (isPlaceholderServing(food)) {
        const fallback = pickDefaultServing(servings);
        update.defaultServingG = fallback.amount;
        update.servingLabel = fallback.label;
    }
    return { status: 'updated', update };
}

/**
 * Foods imported before serving metadata existed have no stored servings and
 * still carry the generic 100 g placeholder. Refresh at most once per food id
 * per session; callers apply the returned update as a FOOD_ITEM_UPDATED event.
 */
const attemptedServingsRefresh = new Set<string>();

export function resetServingsRefreshCache(): void {
    attemptedServingsRefresh.clear();
}

export async function loadMissingImportedServings(
    food: StoredServingSource,
    options: { signal?: AbortSignal } = {},
): Promise<ImportedServingUpdate | null> {
    if (!needsServingsRefresh(food)) return null;
    if (attemptedServingsRefresh.has(food.id)) return null;
    attemptedServingsRefresh.add(food.id);

    const result = await fetchImportedServingsUpdate(food, options);
    return result.status === 'updated' ? result.update : null;
}

export function externalImportToFoodItem(imported: ExternalFoodImport): FoodItem {
    return {
        tenant_id: '',
        log_id: '',
        id: imported.id,
        name: imported.name,
        brand: imported.brand,
        calories_per_100g: imported.caloriesPer100g,
        protein_per_100g: imported.proteinPer100g,
        carbs_per_100g: imported.carbsPer100g,
        fat_per_100g: imported.fatPer100g,
        default_serving_g: imported.defaultServingG,
        serving_label: imported.servingLabel,
        favorite: imported.favorite,
        source_provider: imported.sourceProvider,
        source_id: imported.sourceId,
        source_slug: imported.sourceSlug,
        source_data_version: imported.sourceDataVersion,
        source_missing_nutrients: imported.sourceMissingNutrients,
        source_ean: imported.sourceEan,
        source_ean_confidence: imported.sourceEanConfidence,
        source_servings_json: imported.sourceServingsJson,
        created_at: '',
        updated_at: '',
    };
}
