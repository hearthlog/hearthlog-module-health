import type { AttentionContribution, NavFigure } from '@hearthlog/contracts';
import { queryDatabase } from '@hearthlog/sdk/data';
import { formatNumber } from '@hearthlog/sdk/format';
import { isFeatureEnabled } from '@hearthlog/sdk/runtime';

/**
 * The section's navigation id: the first enabled feature among its places (Body, Nutrition, Activity), as the
 * navigation picks it. Only that one, since `activities` is also the Activity sub-page's id.
 */
function sectionId(): string | null {
    return (['bmi', 'calories', 'activities'] as const).find((feature) => isFeatureEnabled(feature)) ?? null;
}

/** Totals arrive summed by SQL; this only words them. Steps lead; calories show when no steps are logged. */
export function dayFigures(totals: { kcal: number; steps: number }, section: string | null): NavFigure[] {
    const steps = totals.steps > 0 ? { text: `${formatNumber(totals.steps)} steps`, label: `${formatNumber(totals.steps)} steps today` } : null;
    const kcal = totals.kcal > 0 ? { text: `${formatNumber(totals.kcal)} kcal`, label: `${formatNumber(totals.kcal)} kcal eaten today` } : null;
    const lead = steps ?? kcal;
    return [
        ...(section && lead ? [{ id: section, ...lead }] : []),
        ...(steps && kcal ? [{ id: 'nutrition', ...kcal }] : []),
    ];
}

/** Today's steps and calories beside Health in the sidebar. */
export const attention: AttentionContribution = {
    async figures({ today }) {
        const sources = { meals: isFeatureEnabled('calories'), activity: isFeatureEnabled('activities') };
        const totals = await queryDatabase((repositories) => repositories.healthDay.getDayTotals(today, sources));
        return dayFigures(totals, sectionId());
    },
};
