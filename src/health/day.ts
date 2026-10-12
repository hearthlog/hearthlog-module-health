import { MEAL_TYPES } from '../calories/logic.js';
import { ACTIVITY_KINDS, type ActivityKind } from '../activities/logic.js';
import { formatFixed, formatNumber } from '@hearthlog/sdk/format';
import { shiftDay, weekStartOf } from '@hearthlog/sdk/endless';
import type { ActivityEntryRow } from '../data/activities.js';
import type { HealthTimelineRow } from '../data/health-day.js';
import type { WeightMeanPoint } from '../data/weight-logs.js';

/** The Health domains a tenant has; each feeds one pip of the week strip. */
export interface HealthSources {
    meals: boolean;
    activity: boolean;
    body: boolean;
}

/** One day of the strip: sums from the read model, so the strip and the week charts share them. */
export interface HealthWeekDay {
    date: string;
    calories: number;
    proteinG: number;
    steps: number;
    exerciseMinutes: number;
    weighed: boolean;
}

export interface HealthBody {
    weight: number;
    height: number;
    date: string;
    /** Change against the first weigh-in 30 days back; null without one. */
    delta: number | null;
    /** Seven-day mean over the last 30 days, oldest first. */
    trend: WeightMeanPoint[];
}

/** The domains a day is made of; each owns one colour. */
export type HealthTone = 'eat' | 'move' | 'body';

// ------------------------------------------------------------------ the week

/** The seven dates of the Monday-first week that holds `date`. */
export function weekOf(date: string): string[] {
    const start = weekStartOf(date);
    return Array.from({ length: 7 }, (_, index) => shiftDay(start, index));
}

/** Two-letter weekday for chart labels; Monday to Sunday reads Mo Tu We Th Fr Sa Su. */
export function weekdayShort(date: string): string {
    const [year, month, day] = date.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date(year, month - 1, day, 12)).slice(0, 2);
}

/** `Wednesday, September 30`, split so the weekday can be quieter than the date. */
export function dateTitleParts(date: string): { weekday: string; rest: string } {
    const [year, month, day] = date.split('-').map(Number);
    const at = new Date(year, month - 1, day, 12);
    return {
        weekday: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(at),
        rest: new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(at),
    };
}

/** Share of a target reached on a day; a day without a target reads as done once anything is logged. */
export function dayRatio(value: number, target: number): number {
    if (target > 0) return Math.max(0, value) / target;
    return value > 0 ? 1 : 0;
}

/** Left and right arrow keys move the selected day, unless the key belongs to a control. */
export function dayArrowStep(event: KeyboardEvent): -1 | 1 | 0 {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return 0;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return 0;
    const target = event.target;
    if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, button, a, [contenteditable='true'], [role='dialog'], [role='listbox'], [role='menu']")
    ) return 0;
    return event.key === 'ArrowLeft' ? -1 : 1;
}

// ------------------------------------------------------------------ goals and status lines

/** `progress` while under way, `met` once a minimum is reached, `over` past a budget. */
export type GoalTone = 'progress' | 'met' | 'over';

export interface GoalProgress {
    /** Share of the target reached; null without a target. A budget keeps counting past it, a minimum stops there. */
    ratio: number | null;
    tone: GoalTone;
}

/**
 * Calories are a budget (going past the target is the signal), steps are a
 * minimum (reaching the target completes it).
 */
export function goalProgress(value: number, target: number, kind: 'budget' | 'minimum'): GoalProgress {
    if (!(target > 0)) return { ratio: null, tone: 'progress' };
    const ratio = Math.max(0, value) / target;
    if (kind === 'budget') return { ratio, tone: ratio > 1 ? 'over' : 'progress' };
    return { ratio: Math.min(1, ratio), tone: ratio >= 1 ? 'met' : 'progress' };
}

export function eatStatus(calories: number, target: number): string {
    if (!(target > 0)) return '';
    if (calories > target) return `${formatNumber(calories - target)} kcal over target`;
    return `${formatNumber(target - calories)} kcal to target`;
}

export function moveStatus(steps: number, target: number): string {
    if (!(target > 0)) return '';
    if (steps >= target) return 'Target reached';
    return `${formatNumber(target - steps)} steps to target`;
}

/** The same line for a narrow column: the unit is already in the ring. */
export function eatStatusShort(calories: number, target: number): string {
    if (!(target > 0)) return '';
    return calories > target ? `${formatNumber(calories - target)}\u00a0over` : `${formatNumber(target - calories)}\u00a0to target`;
}

export function moveStatusShort(steps: number, target: number): string {
    if (!(target > 0)) return '';
    return steps >= target ? 'Target reached' : `${formatNumber(target - steps)}\u00a0to target`;
}

/** `Sep 24`, with the year only when it differs from the reference date. */
export function formatShortDate(date: string, referenceDate: string): string {
    const [year, month, day] = date.split('-').map(Number);
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    if (date.slice(0, 4) !== referenceDate.slice(0, 4)) options.year = 'numeric';
    return new Intl.DateTimeFormat('en-US', options).format(new Date(year, month - 1, day, 12));
}

export function weighStatus(weighedOn: string, selectedDate: string, today: string): string {
    if (weighedOn === selectedDate) return selectedDate === today ? 'Weighed today' : 'Weighed this day';
    return `Last weighed ${formatShortDate(weighedOn, selectedDate)}`;
}

export function bmiSummary(weightKg: number, heightCm: number): string {
    if (!(weightKg > 0) || !(heightCm > 0)) return '';
    return `BMI ${formatFixed(weightKg / (heightCm / 100) ** 2, 1)}`;
}

/** `−1,4 kg / 30 d`, for a narrow column. */
export function weightChangeShort(delta: number | null): string {
    if (delta === null) return '';
    return `${formatFixed(delta, 1, { signed: true })}\u00a0kg / 30\u00a0d`;
}

/** `−1,4 kg in 30 days`; a change that rounds to nothing reads `0,0 kg`. */
export function weightChangeLabel(delta: number | null): string {
    if (delta === null) return '';
    return `${formatFixed(delta, 1, { signed: true })} kg in 30 days`;
}

// ------------------------------------------------------------------ timeline rows

/** The slot's own label; built-in ids fall back to their default name. */
export function mealSlotLabel(slotId: string, slotLabel: string): string {
    if (slotLabel.trim()) return slotLabel.trim();
    if ((MEAL_TYPES as readonly string[]).includes(slotId)) return slotId.charAt(0).toUpperCase() + slotId.slice(1);
    return 'Meal';
}

export interface TimelineMeasure {
    amount: number;
    unit: string;
}

/** The one figure a timeline row leads with. */
export function timelineMeasure(row: HealthTimelineRow): TimelineMeasure | null {
    if (row.kind === 'meal') return { amount: row.calories, unit: 'kcal' };
    if (row.unit === 'steps') return { amount: row.amount, unit: 'steps' };
    if (row.durationMinutes > 0) return { amount: row.durationMinutes, unit: 'min' };
    if (row.amount > 0) return { amount: row.amount, unit: row.unit };
    if (row.calories > 0) return { amount: row.calories, unit: 'kcal' };
    return null;
}

/** An activity diary entry in the timeline's row shape, so the diary and the day timeline read the same. */
export function activityEntryRow(entry: ActivityEntryRow): HealthTimelineRow {
    return {
        kind: 'activity',
        id: entry.id,
        name: entry.name,
        loggedAt: entry.logged_at,
        detail: entry.kind,
        detailLabel: '',
        calories: Number(entry.effective_active_calories),
        amount: Number(entry.amount),
        unit: entry.unit,
        durationMinutes: Number(entry.duration_minutes),
        intensity: entry.intensity,
        kcalTotal: 0,
        stepsTotal: 0,
    };
}

/** The tone and glyph a row wears: meals are Eat, movement is Move. */
export function timelineTone(row: HealthTimelineRow): HealthTone {
    return row.kind === 'meal' ? 'eat' : 'move';
}

export function timelineActivityKind(row: HealthTimelineRow): ActivityKind {
    return (ACTIVITY_KINDS as readonly string[]).includes(row.detail) ? (row.detail as ActivityKind) : 'custom';
}

/**
 * The one support line under a row's name: the meal slot for meals, and for
 * movement the figures its leading measure leaves out. Steps need no line;
 * their name already says what they are.
 */
export function timelineDetail(row: HealthTimelineRow): string {
    if (row.kind === 'meal') return mealSlotLabel(row.detail, row.detailLabel);
    const kind = timelineActivityKind(row);
    if (kind === 'steps') return '';
    const measure = timelineMeasure(row);
    const parts: string[] = [];
    // Only workouts choose an intensity; other kinds store the default without asking.
    if (kind === 'workout' && row.intensity) parts.push(row.intensity.charAt(0).toUpperCase() + row.intensity.slice(1));
    if (row.durationMinutes > 0 && measure?.unit !== 'min') parts.push(`${formatNumber(row.durationMinutes)} min`);
    if (row.calories > 0 && measure?.unit !== 'kcal') parts.push(`${formatNumber(row.calories)} kcal`);
    return parts.join(' · ');
}

/** Where the "now" marker goes in rows already ordered by SQL: before the first later row. */
export function nowMarkerIndex(rows: readonly Pick<HealthTimelineRow, 'loggedAt'>[], nowTime: string): number {
    const index = rows.findIndex((row) => row.loggedAt.slice(11, 16) > nowTime);
    return index === -1 ? rows.length : index;
}

/**
 * The first visible meal slot with nothing logged on the day. Slots come in
 * SQL order; this only checks which ids the day's rows already use.
 */
export function nextEmptyMealSlot(
    slots: readonly { id: string; label: string; archived: boolean }[],
    rows: readonly Pick<HealthTimelineRow, 'kind' | 'detail'>[],
): { id: string; label: string } | null {
    const used = new Set(rows.filter((row) => row.kind === 'meal').map((row) => row.detail));
    const slot = slots.find((candidate) => !candidate.archived && !used.has(candidate.id));
    return slot ? { id: slot.id, label: slot.label } : null;
}
