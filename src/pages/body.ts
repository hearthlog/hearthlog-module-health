import { deferPage } from '@hearthlog/sdk/runtime';
import type { ModuleLoadEvent } from "@hearthlog/sdk/runtime";
import { shiftLocalDate, toLocalDateString } from '../calories/logic.js';
import { queryDatabase } from '@hearthlog/sdk/data';
import { appClock } from '@hearthlog/sdk/runtime';
import {
    EMPTY_WEIGHT_RANGE,
    type WeightPageData,
    type WeightRange,
    type WeightRangeData,
} from '../health/weight.js';

/** Every range is one SQL read, so switching the chart needs no further query. */
const loadData = async (): Promise<WeightPageData> => {
    const today = toLocalDateString(await appClock.ready());
    return queryDatabase(async (repositories) => {
        const weights = repositories.weightLogs;
        const [latest, total] = await Promise.all([
            weights.getLatestWeightLog(),
            weights.countWeightLogs(),
        ]);
        const empty = { 30: EMPTY_WEIGHT_RANGE, 90: EMPTY_WEIGHT_RANGE, 365: EMPTY_WEIGHT_RANGE, all: EMPTY_WEIGHT_RANGE };
        if (!latest) return { latest, delta: null, pace: null, trends: empty, total, defaultDate: today };

        const latestDate = String(latest.date).slice(0, 10);
        const monthAgo = shiftLocalDate(latestDate, -30);
        const starts = { 30: monthAgo, 90: shiftLocalDate(latestDate, -90), 365: shiftLocalDate(latestDate, -365), all: '0000-01-01' };
        const [last30, last90, last365, all, baseline, pace] = await Promise.all([
            weights.getWeightTrend(starts[30], latestDate),
            weights.getWeightTrend(starts[90], latestDate),
            weights.getWeightTrend(starts[365], latestDate),
            weights.getWeightTrend(starts.all, latestDate),
            weights.getFirstWeightLogSince(monthAgo, latest.id),
            weights.getWeightPace(monthAgo, latestDate),
        ]);
        const trends: Record<WeightRange, WeightRangeData> = {
            30: { ...last30, from: starts[30] },
            90: { ...last90, from: starts[90] },
            365: { ...last365, from: starts[365] },
            all: { ...all, from: all.weighIns[0]?.date ?? latestDate },
        };
        return {
            latest,
            delta: baseline ? Number(latest.weight) - Number(baseline.weight) : null,
            pace,
            trends,
            total,
            defaultDate: today,
        };
    });
};

export const load = (event: ModuleLoadEvent) => {
    event.depends('app:weight-logs');
    return deferPage<WeightPageData>(event, {
        latest: null,
        delta: null,
        pace: null,
        trends: { 30: EMPTY_WEIGHT_RANGE, 90: EMPTY_WEIGHT_RANGE, 365: EMPTY_WEIGHT_RANGE, all: EMPTY_WEIGHT_RANGE },
        total: 0,
        defaultDate: toLocalDateString(),
    }, () => loadData());
};
