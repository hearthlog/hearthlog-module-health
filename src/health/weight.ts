import type { Weightlog, WeighInSort, WeighInSortColumn, WeightTrend } from '../data/weight-logs.js';
import { formatFixed } from '@hearthlog/sdk/format';
import { formatShortDate } from './day.js';

/** The chart's ranges: days back from the latest weigh-in, or every weigh-in. */
export type WeightRange = 30 | 90 | 365 | 'all';

export const WEIGHT_RANGES: readonly { value: WeightRange; label: string; phrase: string }[] = [
    { value: 30, label: '30 days', phrase: 'the last 30 days' },
    { value: 90, label: '90 days', phrase: 'the last 90 days' },
    { value: 365, label: '1 year', phrase: 'the last year' },
    { value: 'all', label: 'All', phrase: 'all weigh-ins' },
];

/** A range's weigh-ins and seven-day means, with the day the chart starts on. */
export interface WeightRangeData extends WeightTrend {
    from: string;
}

export const EMPTY_WEIGHT_RANGE: WeightRangeData = { weighIns: [], mean: [], from: '' };

/** Rows per page of the weigh-in list. */
export const WEIGH_IN_PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_WEIGH_IN_PAGE_SIZE = WEIGH_IN_PAGE_SIZES[0];

/** The list opens newest first. */
export const DEFAULT_WEIGH_IN_SORT: WeighInSort = { column: 'date', desc: true };

const WEIGH_IN_SORT_COLUMNS: readonly WeighInSortColumn[] = ['date', 'weight', 'change', 'bmi'];

/** `weight-asc` or `change-desc`; anything else is the default order. */
export function parseWeighInSort(value: string | null): WeighInSort {
    const [column, direction] = (value ?? '').split('-');
    if (!(WEIGH_IN_SORT_COLUMNS as readonly string[]).includes(column) || (direction !== 'asc' && direction !== 'desc')) {
        return DEFAULT_WEIGH_IN_SORT;
    }
    return { column: column as WeighInSortColumn, desc: direction === 'desc' };
}

/** The address value of a sort; null for the default, which leaves the address clean. */
export function weighInSortValue(sort: WeighInSort): string | null {
    if (sort.column === DEFAULT_WEIGH_IN_SORT.column && sort.desc === DEFAULT_WEIGH_IN_SORT.desc) return null;
    return `${sort.column}-${sort.desc ? 'desc' : 'asc'}`;
}

export interface WeightPageData {
    latest: Weightlog | null;
    /** Change against the first weigh-in 30 days back; null without one. */
    delta: number | null;
    /** Kilograms per week over the last 30 days; null below three weigh-ins. */
    pace: number | null;
    trends: Record<WeightRange, WeightRangeData>;
    /** Every weigh-in on record. */
    total: number;
    defaultDate: string;
}

/** `−0,3 kg a week`; empty without a pace. */
export function weightPaceLabel(pace: number | null): string {
    return pace === null ? '' : `${formatFixed(pace, 1, { signed: true })} kg a week`;
}

/** `weighed today` or `weighed Sep 27`, for under the weight. */
export function weighedLabel(date: string, today: string): string {
    return date === today ? 'weighed today' : `weighed ${formatShortDate(date, today)}`;
}
