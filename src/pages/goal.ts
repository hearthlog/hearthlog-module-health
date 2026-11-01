import type { ModuleLoadEvent } from "@hearthlog/sdk/runtime";
import { appClock, deferPage, tenant } from '@hearthlog/sdk/runtime';
import { queryDatabase, type NutritionGoal } from '@hearthlog/sdk/data';
import { shiftLocalDate, toLocalDateString } from '../calories/logic.js';

/** What the Goal page starts from: the weight trend, the last height, and the goal in force. */
export interface GoalPageData {
    today: string;
    trendKg: number | null;
    heightCm: number | null;
    goal: NutritionGoal | null;
}

export const load = (event: ModuleLoadEvent) => {
    event.depends('app:calories');
    if (tenant.features.has('bmi')) event.depends('app:weight-logs');
    const initial: GoalPageData = { today: toLocalDateString(), trendKg: null, heightCm: null, goal: null };
    return deferPage(event, initial, async (): Promise<GoalPageData> => {
        const today = toLocalDateString(await appClock.ready());
        return queryDatabase(async (repositories) => {
            const [goal, latest] = await Promise.all([
                repositories.calories.getLatestNutritionGoal(today),
                tenant.features.has('bmi') ? repositories.weightLogs.getLatestWeightLog(today) : null,
            ]);
            const latestDate = latest ? String(latest.date).slice(0, 10) : null;
            const trend = latestDate ? await repositories.weightLogs.getWeightTrend(shiftLocalDate(latestDate, -7), latestDate) : null;
            return {
                today,
                trendKg: trend?.mean.at(-1)?.mean ?? (latest ? Number(latest.weight) : null),
                heightCm: latest ? Number(latest.height) || null : null,
                goal,
            };
        });
    });
};
