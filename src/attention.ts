import type { AttentionContribution, NavFigure } from '@hearthlog/contracts';
import { queryDatabase } from '@hearthlog/sdk/data';
import { formatFixed, formatNumber } from '@hearthlog/sdk/format';
import { dayBudget } from './health/budget.js';
import { isFeatureEnabled } from '@hearthlog/sdk/runtime';

/**
 * The section's navigation id: the first enabled feature among its places (Body, Nutrition, Activity), as the
 * navigation picks it. Only that one, since `activities` is also the Activity sub-page's id.
 */
function sectionId(): string | null {
    return (['bmi', 'calories', 'activities'] as const).find((feature) => isFeatureEnabled(feature)) ?? null;
}

/**
 * Totals arrive summed by SQL; this only words them. With a goal the section and its Day say what is left,
 * steps included; without one they say what was eaten, or the steps. Body shows the latest weight.
 */
export function dayFigures(
    totals: { kcal: number; steps: number; left: number | null; weight: number | null },
    section: string | null,
): NavFigure[] {
    const left = totals.left !== null
        ? { text: totals.left >= 0 ? `${formatNumber(totals.left)} left` : `${formatNumber(-totals.left)} over`, label: totals.left >= 0 ? `${formatNumber(totals.left)} kcal left today` : `${formatNumber(-totals.left)} kcal over today` }
        : null;
    const kcal = totals.kcal > 0 ? { text: `${formatNumber(totals.kcal)} kcal`, label: `${formatNumber(totals.kcal)} kcal eaten today` } : null;
    const steps = totals.steps > 0 ? { text: `${formatNumber(totals.steps)} steps`, label: `${formatNumber(totals.steps)} steps today` } : null;
    const lead = left ?? kcal ?? steps;
    const weight = totals.weight !== null ? { text: `${formatFixed(totals.weight, 1)} kg`, label: `Latest weigh-in ${formatFixed(totals.weight, 1)} kg` } : null;
    return [
        ...(section && lead ? [{ id: section, ...lead }] : []),
        ...(left ?? kcal ? [{ id: 'day', ...(left ?? kcal)! }] : []),
        ...(weight ? [{ id: 'body', ...weight }] : []),
    ];
}

/** What is left today beside Health in the sidebar, and the latest weight beside Body. */
export const attention: AttentionContribution = {
    async figures({ today }) {
        const sources = { meals: isFeatureEnabled('calories'), activity: isFeatureEnabled('activities') };
        const body = isFeatureEnabled('bmi');
        const [totals, goal, activity, latest] = await queryDatabase((repositories) => Promise.all([
            repositories.healthDay.getDayTotals(today, sources),
            sources.meals ? repositories.calories.getLatestNutritionGoal(today) : null,
            sources.activity ? repositories.activities.getActivityTrend(today, today) : null,
            body ? repositories.weightLogs.getLatestWeightLog(today) : null,
        ]));
        const budget = dayBudget(Number(goal?.calories_target ?? 0), activity?.days[0]?.activeCalories ?? 0, totals.kcal);
        return dayFigures({
            ...totals,
            left: budget.budget > 0 ? budget.left : null,
            weight: latest ? Number(latest.weight) : null,
        }, sectionId());
    },
};
