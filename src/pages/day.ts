import type { ModuleLoadEvent } from "@hearthlog/sdk/runtime";
import { deferPage } from '@hearthlog/sdk/runtime';
import { queryDatabase } from '@hearthlog/sdk/data';
import { tenant } from '@hearthlog/sdk/runtime';
import { appClock } from '@hearthlog/sdk/runtime';
import { parseSelectedDate, toLocalDateString, type StoredMealSlot } from '../calories/logic.js';
import { healthSources } from '../health/week-data.js';
import type { HealthSources } from '../health/day.js';

/** What the Health list needs besides its days, which it reads itself as they scroll into view. */
export interface HealthPageData {
    /** The day the list opens at. */
    selectedDate: string;
    today: string;
    sources: HealthSources;
    /** Meal slots, so a day can offer its next empty meal. */
    mealSlots: StoredMealSlot[];
    /** The earliest day with anything logged; the list reaches back to its week. */
    firstLogged: string | null;
}

/**
 * Health: an endless list of days, each with its meals, movement, and body
 * measurements. Every figure is a SQL aggregate from the owning feature's
 * repository, read per day as the day scrolls into view.
 */
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
        firstLogged: null,
    };
    return deferPage(event, initial, async (): Promise<HealthPageData> => {
        const today = toLocalDateString(await appClock.ready());
        const [mealSlots, firstLogged] = await queryDatabase((repositories) => Promise.all([
            sources.meals ? repositories.calories.getMealSlots() : [],
            repositories.healthDay.getFirstLoggedDay(sources),
        ]));
        return {
            selectedDate: parseSelectedDate(event.url.searchParams.get('date'), today),
            today,
            sources,
            mealSlots,
            firstLogged,
        };
    });
};
