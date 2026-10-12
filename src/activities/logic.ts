import {
    normalizeLocalDateTime,
    parseSelectedDate,
} from '../calories/logic.js';

export const ACTIVITY_KINDS = ['steps', 'workout', 'custom'] as const;
export const ACTIVITY_INTENSITIES = ['light', 'moderate', 'vigorous'] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type ActivityIntensity = (typeof ACTIVITY_INTENSITIES)[number];
export type ActivityCalorieSource = 'none' | 'estimated' | 'manual';

export interface ActivityEntryDraft {
    name: string;
    kind: ActivityKind;
    amount: number | null;
    unit: string;
    durationMinutes: number | null;
    intensity: ActivityIntensity;
    loggedAt: string;
    manualActiveCalories: number | null;
    notes: string;
}

export interface ActivityGoalDraft {
    effectiveFrom: string;
    stepsTarget: number | null;
    exerciseMinutesTarget: number | null;
}

export interface ActivityTotals {
    steps: number;
    exerciseMinutes: number;
    workoutSessions: number;
    activeCalories: number;
}

export interface ActivityCalorieCalculation {
    activeCalories: number;
    source: ActivityCalorieSource;
    method: string;
    weightKg: number;
}

/** Active kilocalories per step per kilogram of body weight. */
export const STEP_CALORIES_PER_KG = 0.0005;
const WORKOUT_MET: Record<ActivityIntensity, number> = {
    light: 3.5,
    moderate: 5,
    vigorous: 7.5,
};

function positiveNumber(value: number | null): value is number {
    return value !== null && Number.isFinite(value) && value > 0;
}

function nonNegativeNumber(value: number | null): value is number {
    return value !== null && Number.isFinite(value) && value >= 0;
}

export function activityKindLabel(kind: ActivityKind): string {
    if (kind === 'steps') return 'Steps';
    if (kind === 'workout') return 'Workout';
    return 'Custom activity';
}

/**
 * Calculates active, rather than total, exercise calories. The activity
 * baseline is deliberately excluded from workout estimates because the
 * Nutrition target calculator already models typical daily activity.
 */
export function calculateActivityCalories(
    draft: Pick<ActivityEntryDraft, 'kind' | 'amount' | 'durationMinutes' | 'intensity' | 'manualActiveCalories'>,
    latestWeightKg: number | null,
): ActivityCalorieCalculation {
    if (nonNegativeNumber(draft.manualActiveCalories)) {
        return {
            activeCalories: Math.round(draft.manualActiveCalories),
            source: 'manual',
            method: 'manual',
            weightKg: 0,
        };
    }

    if (!positiveNumber(latestWeightKg)) {
        return { activeCalories: 0, source: 'none', method: '', weightKg: 0 };
    }

    if (draft.kind === 'steps' && positiveNumber(draft.amount)) {
        return {
            activeCalories: Math.round(draft.amount * latestWeightKg * STEP_CALORIES_PER_KG),
            source: 'estimated',
            method: 'steps-active-v1',
            weightKg: latestWeightKg,
        };
    }

    if (draft.kind === 'workout' && positiveNumber(draft.durationMinutes)) {
        const met = WORKOUT_MET[draft.intensity];
        return {
            activeCalories: Math.round(
                Math.max(0, met - 1) * 3.5 * latestWeightKg * draft.durationMinutes / 200,
            ),
            source: 'estimated',
            method: `workout-${draft.intensity}-active-v1`,
            weightKg: latestWeightKg,
        };
    }

    return { activeCalories: 0, source: 'none', method: '', weightKg: 0 };
}

export function validateActivityEntryDraft(draft: ActivityEntryDraft): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!ACTIVITY_KINDS.includes(draft.kind)) errors.kind = 'Choose an activity type.';
    if (!draft.name.trim()) errors.name = 'Enter an activity name.';
    if (!positiveNumber(draft.amount)) {
        errors.amount = draft.kind === 'steps'
            ? 'Enter a positive step count.'
            : 'Enter a positive amount.';
    } else if (draft.kind === 'steps' && !Number.isInteger(draft.amount)) {
        errors.amount = 'Steps must be a whole number.';
    }
    if (!draft.unit.trim()) errors.unit = 'Enter a unit.';
    if (draft.durationMinutes !== null && (!Number.isFinite(draft.durationMinutes) || draft.durationMinutes < 0)) {
        errors.durationMinutes = 'Duration cannot be negative.';
    }
    if (draft.kind === 'workout' && !positiveNumber(draft.durationMinutes)) {
        errors.durationMinutes = 'Enter a positive workout duration.';
    }
    if (!ACTIVITY_INTENSITIES.includes(draft.intensity)) errors.intensity = 'Choose an intensity.';
    if (!normalizeLocalDateTime(draft.loggedAt)) errors.loggedAt = 'Choose a valid date and time.';
    if (draft.manualActiveCalories !== null && (!Number.isFinite(draft.manualActiveCalories) || draft.manualActiveCalories < 0)) {
        errors.manualActiveCalories = 'Active calories cannot be negative.';
    }
    return errors;
}

export function validateActivityGoalDraft(draft: ActivityGoalDraft): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!draft.effectiveFrom || parseSelectedDate(draft.effectiveFrom, '') !== draft.effectiveFrom) {
        errors.effectiveFrom = 'Choose a valid effective date.';
    }
    if (draft.stepsTarget !== null && (!Number.isFinite(draft.stepsTarget) || draft.stepsTarget < 0)) {
        errors.stepsTarget = 'Steps target cannot be negative.';
    }
    if (draft.exerciseMinutesTarget !== null && (!Number.isFinite(draft.exerciseMinutesTarget) || draft.exerciseMinutesTarget < 0)) {
        errors.exerciseMinutesTarget = 'Exercise target cannot be negative.';
    }
    return errors;
}
