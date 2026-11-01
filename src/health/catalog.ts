import { queryDatabase, type FoodItem } from '@hearthlog/sdk/data';
import { getKalFood, getKalMeta, type KalEanConfidence, type KalFood } from '../api/kal.js';
import { externalImportToFoodItem, KAL_SOURCE_PROVIDER, toExternalFoodImport, type ExternalFoodImport } from '../calories/external-food.js';

/**
 * A catalog food ready to log: the library copy when it was imported before,
 * otherwise a new import that is saved together with the first entry.
 */
export async function prepareCatalogFood(
    item: KalFood,
    barcode?: { ean: string; eanConfidence: KalEanConfidence },
): Promise<{ food: FoodItem; imported: ExternalFoodImport | null }> {
    const existing = await queryDatabase((repositories) => repositories.calories.getFoodItemBySource(KAL_SOURCE_PROVIDER, item.guid));
    if (existing) return { food: existing, imported: null };
    const [meta, detail] = await Promise.allSettled([getKalMeta(), getKalFood(item.slug)]);
    const imported = toExternalFoodImport(item, {
        dataVersion: meta.status === 'fulfilled' ? meta.value.dataVersion : '',
        servings: detail.status === 'fulfilled' ? detail.value.servings : [],
        ...(barcode ?? {}),
    });
    return { food: externalImportToFoodItem(imported), imported };
}
