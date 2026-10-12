import type { ModuleLoadEvent } from "@hearthlog/sdk/runtime";
import { deferPage } from '@hearthlog/sdk/runtime';
import { queryDatabase } from '@hearthlog/sdk/data';
import { tenant } from '@hearthlog/sdk/runtime';
import { appClock } from '@hearthlog/sdk/runtime';
import { parseSelectedDate, toLocalDateString } from '../calories/logic.js';
import { activitySources, type ActivityPageData } from '../activities/page-data.js';

export const load = (event: ModuleLoadEvent) => {
    event.depends('app:activities');
    // The week strip carries a pip per domain, so those domains refresh this page too.
    if (tenant.features.has('calories')) event.depends('app:calories');
    if (tenant.features.has('bmi')) event.depends('app:weight-logs');
    const sources = activitySources(tenant.features);
    const initial: ActivityPageData = {
        selectedDate: parseSelectedDate(event.url.searchParams.get('date'), toLocalDateString()),
        today: toLocalDateString(),
        sources,
        firstLogged: null,
        latestWeightLog: null,
    };
    return deferPage(event, initial, async (): Promise<ActivityPageData> => {
        const today = toLocalDateString(await appClock.ready());
        const [firstLogged, latestWeightLog] = await queryDatabase((repositories) => Promise.all([
            repositories.healthDay.getFirstLoggedDay({ meals: false, activity: true, body: false }),
            tenant.features.has('bmi') ? repositories.weightLogs.getLatestWeightLog() : null,
        ]));
        return {
            selectedDate: parseSelectedDate(event.url.searchParams.get('date'), today),
            today,
            sources,
            firstLogged,
            latestWeightLog,
        };
    });
};
