import { deferPage } from '@hearthlog/sdk/runtime';
import { queryDatabase } from '@hearthlog/sdk/data';
import type { ModuleLoadEvent } from "@hearthlog/sdk/runtime";

const loadData = async ({ depends }: ModuleLoadEvent) => {

    return {
        foodItems: await queryDatabase((repositories) =>
            repositories.calories.getFoodItems()),
    };
};

export const load = (event: ModuleLoadEvent) => {
    event.depends('app:foods');
    return deferPage(event, { foodItems: [] } as Awaited<ReturnType<typeof loadData>>, () => loadData(event));
};
