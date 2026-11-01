/** Dates and times the way Health writes them: day first, 24-hour clock. */

import { shiftLocalDate } from '../calories/logic.js';

function at(date: string): Date {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day, 12);
}

/** `Sunday, 1 November`, with the year when it is not the reference date's. */
export function dayTitle(date: string, reference: string): string {
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
    if (date.slice(0, 4) !== reference.slice(0, 4)) options.year = 'numeric';
    return new Intl.DateTimeFormat('en-GB', options).format(at(date));
}

/** `1 Nov`, with the year when it is not the reference date's. */
export function shortDate(date: string, reference: string): string {
    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    if (date.slice(0, 4) !== reference.slice(0, 4)) options.year = 'numeric';
    return new Intl.DateTimeFormat('en-GB', options).format(at(date));
}

/** `Sun 1 Nov`. */
export function weekdayDate(date: string): string {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(at(date));
}

/** `October 2026`. */
export function monthTitle(month: string): string {
    return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(at(`${month}-01`));
}

/** How an earlier day reads from another: `yesterday`, `last Sunday`, or `on 12 Oct`. */
export function weekdayLong(date: string, reference: string): string {
    if (date === shiftLocalDate(reference, -1)) return 'yesterday';
    if (date >= shiftLocalDate(reference, -7) && date < reference) {
        return `last ${new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(at(date))}`;
    }
    return `on ${shortDate(date, reference)}`;
}

/** `08:10` from a stored local date-time. */
export function clockTime(loggedAt: string): string {
    const match = /[T ](\d{2}:\d{2})/.exec(String(loggedAt));
    return match ? match[1] : '';
}

/** `19:10` from minutes after midnight. */
export function minutesClock(minutes: number): string {
    const rounded = Math.round(minutes / 5) * 5;
    return `${String(Math.floor(rounded / 60) % 24).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}

/** Whole days from one local date to another. */
export function daysBetween(from: string, to: string): number {
    return Math.round((at(to).getTime() - at(from).getTime()) / 86_400_000);
}
