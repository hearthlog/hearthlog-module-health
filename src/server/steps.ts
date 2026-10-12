/**
 * The steps integration: one `activity_entry` per day, set by date. Pure
 * request validation and event construction; the Worker owns the transport.
 */

import { deterministicUuid, IntegrationRequestError, type ServiceAppend } from '@hearthlog/sdk/server';

export const MAX_STEPS = 200_000;
/** Days before the Worker's UTC today a date may reach back. */
export const STEPS_PAST_DAYS = 14;
/** Days after the Worker's UTC today a date may reach, so a phone ahead of UTC still lands. */
export const STEPS_FUTURE_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The step count from a request body of the shape `{ "steps": 8421 }`. */
export function parseStepsBody(value: unknown): number {
    const steps = value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).steps
        : undefined;
    if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 0 || steps > MAX_STEPS) {
        throw new IntegrationRequestError(400, 'invalid_request', `steps must be a whole number from 0 to ${MAX_STEPS}`);
    }
    return steps;
}

/** A `YYYY-MM-DD` date inside the accepted window around `now`. */
export function parseStepsDate(value: string, now: number): string {
    const match = DATE.exec(value);
    const parsed = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN;
    if (!match || Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
        throw new IntegrationRequestError(400, 'invalid_date', 'The date must be a calendar day written YYYY-MM-DD');
    }
    const today = Math.floor(now / DAY_MS) * DAY_MS;
    if (parsed < today - STEPS_PAST_DAYS * DAY_MS || parsed > today + STEPS_FUTURE_DAYS * DAY_MS) {
        throw new IntegrationRequestError(
            422,
            'date_out_of_range',
            `The date must be within ${STEPS_PAST_DAYS} days before and ${STEPS_FUTURE_DAYS} day after today`,
        );
    }
    return value;
}

/**
 * The append that sets one day's total. Without `base` the entity is created;
 * with it the entity is updated from that version. Ids derive from the day, the
 * count, the base and the minute, so a retry inside the minute is the same
 * request and Ledger answers it from its stored response.
 */
export async function buildStepsAppend(input: {
    integrationId: string;
    date: string;
    steps: number;
    base: number | undefined;
    now: number;
}): Promise<{ entityId: string; append: ServiceAppend }> {
    const { integrationId, date, steps, base } = input;
    const minute = Math.floor(input.now / 60_000) * 60_000;
    const entityUuid = await deterministicUuid('entity', integrationId, 'steps', date);
    const entityId = `activity_entry:${entityUuid}`;
    const salt = [entityUuid, String(base ?? 0), String(steps), String(minute)];
    const payload: Record<string, unknown> = base === undefined
        ? {
            id: entityUuid,
            name: 'Steps',
            kind: 'steps',
            amount: steps,
            unit: 'steps',
            durationMinutes: 0,
            intensity: 'moderate',
            loggedAt: `${date}T00:00`,
            activeCalories: 0,
            calorieSource: 'none',
            calculationMethod: '',
            calculationWeightKg: 0,
            notes: '',
            source: integrationId,
        }
        : { id: entityUuid, amount: steps };
    return {
        entityId,
        append: {
            requestId: await deterministicUuid('request', ...salt),
            events: [{
                id: await deterministicUuid('event', ...salt),
                type: base === undefined ? 'ACTIVITY_ENTRY_ADDED' : 'ACTIVITY_ENTRY_UPDATED',
                entityId,
                timestamp: minute,
                ...(base === undefined ? {} : { baseEntityVersion: base }),
                payload,
            }],
        },
    };
}
