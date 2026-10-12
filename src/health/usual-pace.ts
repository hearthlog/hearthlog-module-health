import { getDeviceSetting as kvGet, setDeviceSetting as kvSet } from '@hearthlog/sdk/runtime';

/**
 * Whether the day view lays the usual calorie pace over today's. It is a device
 * preference, like the balance floor in Finance, so it lives in local KV and
 * never becomes an event. Off until someone turns it on.
 */

const USUAL_PACE_KEY = 'health:usual-pace';

export async function loadUsualPace(): Promise<boolean> {
    try {
        return (await kvGet<unknown>(USUAL_PACE_KEY)) === true;
    } catch {
        return false;
    }
}

export function saveUsualPace(on: boolean): Promise<void> {
    return kvSet(USUAL_PACE_KEY, on);
}
