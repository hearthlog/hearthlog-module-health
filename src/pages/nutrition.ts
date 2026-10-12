import { deferPage } from '@hearthlog/sdk/runtime';
import { parseSelectedDate, toLocalDateString } from '../calories/logic.js';
import { queryDatabase } from '@hearthlog/sdk/data';
import { isFeatureEnabled, tenant } from '@hearthlog/sdk/runtime';
import { appClock } from '@hearthlog/sdk/runtime';
import { nutritionSources, type NutritionPageData } from '../calories/page-data.js';
import type { ModuleLoadEvent } from "@hearthlog/sdk/runtime";

export const load = (event: ModuleLoadEvent) => {
    event.depends('app:calories');
    if (isFeatureEnabled('activities')) event.depends('app:activities');
    if (isFeatureEnabled('bmi')) event.depends('app:weight-logs');
    const sources = nutritionSources(tenant.features);
    const initial: NutritionPageData = {
        selectedDate: parseSelectedDate(event.url.searchParams.get('date'), toLocalDateString()),
        today: toLocalDateString(),
        sources,
        firstLogged: null,
        foodItems: [],
        recentFoodItemIds: [],
        mealSlots: [],
    };
    return deferPage(event, initial, async (): Promise<NutritionPageData> => {
        const today = toLocalDateString(await appClock.ready());
        const [firstLogged, foodItems, recentFoodItemIds, mealSlots] = await queryDatabase((repositories) => {
            const calories = repositories.calories;
            return Promise.all([
                repositories.healthDay.getFirstLoggedDay({ meals: true, activity: false, body: false }),
                calories.getFoodItems(),
                calories.getRecentFoodItemIds(8),
                calories.getMealSlots(),
            ]);
        });
        return {
            selectedDate: parseSelectedDate(event.url.searchParams.get('date'), today),
            today,
            sources,
            firstLogged,
            foodItems,
            recentFoodItemIds,
            mealSlots,
        };
    });
};
