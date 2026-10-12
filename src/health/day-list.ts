import { dayAxis, dayOffset, shiftDay, weekStartOf, type EndlessAxis } from '@hearthlog/sdk/endless';

/** Days before today that are always within reach, so a new log can still scroll back. */
const MIN_PAST_DAYS = 28;
/** Days after today the list reaches; the axis then rounds up to the end of that week. */
const FUTURE_DAYS = 7;

/**
 * The days an endless Health list scrolls through, from the week of the first
 * logged day (or four weeks back, whichever is earlier) to the end of the week
 * a week from today. Both ends are whole Monday-first weeks, so the week strip
 * never offers a day the list cannot show.
 */
export function healthDayAxis(today: string, firstLogged: string | null): EndlessAxis {
    const earliest = firstLogged && firstLogged < shiftDay(today, -MIN_PAST_DAYS) ? firstLogged : shiftDay(today, -MIN_PAST_DAYS);
    const start = weekStartOf(earliest);
    const end = shiftDay(weekStartOf(shiftDay(today, FUTURE_DAYS)), 6);
    return dayAxis(today, -dayOffset(start, today), dayOffset(end, today));
}
