/**
 * Type-to-log: what a meal's add row understands. "2 rohlíky" is two pieces
 * of a roll, "150 g kuře" is grams of chicken, "650 canteen" is a number with
 * a name. The parser only reads the text; matching foods is SQL's job.
 */

export type QuickUnit = 'g' | 'kcal' | 'count';

export interface QuickEntry {
    /** The words to look a food up by, as typed. */
    term: string;
    amount: number | null;
    /** Null when a bare number was typed: small numbers count pieces, large ones grams or kcal. */
    unit: QuickUnit | null;
}

const UNITS: Record<string, QuickUnit> = {
    g: 'g', gr: 'g', gram: 'g', grams: 'g', gramů: 'g',
    kcal: 'kcal', cal: 'kcal', kal: 'kcal',
    ks: 'count', x: 'count', '×': 'count', pc: 'count', pcs: 'count', piece: 'count', pieces: 'count',
};

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIT = String.raw`(g|gr|grams?|gramů|kcal|cal|kal|ks|x|×|pcs?|pieces?)?`;
const LEADING = new RegExp(String.raw`^${NUMBER}\s*${UNIT}\s+(.+)$`, 'iu');
const TRAILING = new RegExp(String.raw`^(.+?)\s+${NUMBER}\s*${UNIT}$`, 'iu');
const ONLY_NUMBER = new RegExp(String.raw`^${NUMBER}\s*${UNIT}$`, 'iu');

function toNumber(text: string): number {
    return Number(text.replace(',', '.'));
}

export function parseQuickEntry(text: string): QuickEntry {
    const value = text.trim().replace(/\s+/g, ' ');
    const leading = LEADING.exec(value);
    if (leading) return { term: leading[3].trim(), amount: toNumber(leading[1]), unit: leading[2] ? UNITS[leading[2].toLowerCase()] ?? null : null };
    const trailing = TRAILING.exec(value);
    if (trailing) return { term: trailing[1].trim(), amount: toNumber(trailing[2]), unit: trailing[3] ? UNITS[trailing[3].toLowerCase()] ?? null : null };
    const only = ONLY_NUMBER.exec(value);
    if (only) return { term: '', amount: toNumber(only[1]), unit: only[2] ? UNITS[only[2].toLowerCase()] ?? null : null };
    return { term: value, amount: null, unit: null };
}

/** A bare number this small counts pieces; above it, it is grams of a food or kcal of a named meal. */
export const MAX_BARE_COUNT = 20;

/** How a typed amount applies to a matched food. */
export function quickPortion(entry: QuickEntry): { kind: 'count'; count: number } | { kind: 'grams'; grams: number } | { kind: 'usual' } {
    if (entry.amount === null || !(entry.amount > 0)) return { kind: 'usual' };
    if (entry.unit === 'g') return { kind: 'grams', grams: entry.amount };
    if (entry.unit === 'count') return { kind: 'count', count: entry.amount };
    if (entry.unit === null && entry.amount <= MAX_BARE_COUNT) return { kind: 'count', count: entry.amount };
    if (entry.unit === null) return { kind: 'grams', grams: entry.amount };
    return { kind: 'usual' };
}

/** "650 canteen" and "canteen 650 kcal" log a number with a name; null when the text is not one. */
export function quickCalories(entry: QuickEntry): { calories: number; name: string } | null {
    if (entry.amount === null || !(entry.amount > 0)) return null;
    if (entry.unit === 'kcal' || (entry.unit === null && entry.amount > MAX_BARE_COUNT)) {
        const name = entry.term.trim();
        return { calories: Math.round(entry.amount), name: name ? name.charAt(0).toLocaleUpperCase() + name.slice(1) : 'Food' };
    }
    return null;
}

/**
 * Shorter forms of the last word, so an inflected "rohlíky" or "kuřecí" still
 * finds "Rohlík" and "Kuřecí prsa". Longest first; never under four letters.
 */
export function searchStems(term: string): string[] {
    const words = term.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const last = words[words.length - 1];
    const head = words.slice(0, -1).join(' ');
    const stems: string[] = [];
    for (let length = last.length; length >= Math.min(4, last.length); length -= 1) {
        stems.push(head ? `${head} ${last.slice(0, length)}` : last.slice(0, length));
        if (length < last.length - 2) break;
    }
    return stems;
}
