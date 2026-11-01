import type { ModuleLoadEvent } from "@hearthlog/sdk/runtime";
import { appClock, deferPage, tenant } from '@hearthlog/sdk/runtime';
import { queryDatabase } from '@hearthlog/sdk/data';
import { parseSelectedDate, toLocalDateString, type StoredMealSlot } from '../calories/logic.js';
import { healthSources } from '../health/week-data.js';
import type { HealthSources } from '../health/day.js';
import { loadDayView, type DayView } from '../health/day-page.js';

/** One day of Health: the budget line, the diary, and weight and steps beside them. */
export interface HealthPageData {
    selectedDate: string;
    today: string;
    sources: HealthSources;
    mealSlots: StoredMealSlot[];
    view: DayView | null;
}

export const load = (event: ModuleLoadEvent) => {
    const sources = healthSources(tenant.features);
    if (sources.meals) event.depends('app:calories');
    if (sources.activity) event.depends('app:activities');
    if (sources.body) event.depends('app:weight-logs');
    const initial: HealthPageData = {
        selectedDate: parseSelectedDate(event.url.searchParams.get('date'), toLocalDateString()),
        today: toLocalDateString(),
        sources,
        mealSlots: [],
        view: null,
    };
    return deferPage(event, initial, async (): Promise<HealthPageData> => {
        const today = toLocalDateString(await appClock.ready());
        const selectedDate = parseSelectedDate(event.url.searchParams.get('date'), today);
        return queryDatabase(async (repositories) => {
            const mealSlots = sources.meals ? await repositories.calories.getMealSlots() : [];
            const view = await loadDayView(repositories, sources, mealSlots, selectedDate);
            return { selectedDate, today, sources, mealSlots, view };
        });
    });
};
