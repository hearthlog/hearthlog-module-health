import { describe, expect, it } from 'vitest';
import { parseQuickEntry, quickCalories, quickPortion, searchStems } from './quick-entry.js';
import { arrivalDate, budgetBar, calibration, dayBudget, dayStatus, macroTargets } from './budget.js';
import { nextMealSlot } from './diary.js';

describe('parseQuickEntry', () => {
    it('reads a count before the food', () => {
        const entry = parseQuickEntry('2 rohlíky');
        expect(entry).toEqual({ term: 'rohlíky', amount: 2, unit: null });
        expect(quickPortion(entry)).toEqual({ kind: 'count', count: 2 });
        expect(quickCalories(entry)).toBeNull();
    });

    it('reads grams before or after the food', () => {
        expect(parseQuickEntry('150 g kuře')).toEqual({ term: 'kuře', amount: 150, unit: 'g' });
        expect(parseQuickEntry('kuře 150g')).toEqual({ term: 'kuře', amount: 150, unit: 'g' });
        expect(quickPortion(parseQuickEntry('150g kuře'))).toEqual({ kind: 'grams', grams: 150 });
    });

    it('reads a large bare number as kcal with a name', () => {
        const entry = parseQuickEntry('650 canteen');
        expect(quickCalories(entry)).toEqual({ calories: 650, name: 'Canteen' });
        expect(quickCalories(parseQuickEntry('pizza 900 kcal'))).toEqual({ calories: 900, name: 'Pizza' });
        expect(quickCalories(parseQuickEntry('420'))).toEqual({ calories: 420, name: 'Food' });
    });

    it('keeps a plain name as the search term', () => {
        expect(parseQuickEntry('  skyr  natural ')).toEqual({ term: 'skyr natural', amount: null, unit: null });
        expect(quickPortion(parseQuickEntry('skyr'))).toEqual({ kind: 'usual' });
    });

    it('accepts a decimal comma', () => {
        expect(parseQuickEntry('1,5 ks banán')).toEqual({ term: 'banán', amount: 1.5, unit: 'count' });
    });
});

describe('searchStems', () => {
    it('shortens the last word, longest first', () => {
        expect(searchStems('rohlíky')).toEqual(['rohlíky', 'rohlík', 'rohlí', 'rohl']);
        expect(searchStems('kuřecí prsa')).toEqual(['kuřecí prsa']);
        expect(searchStems('kuřecí prsíčka')).toEqual(['kuřecí prsíčka', 'kuřecí prsíčk', 'kuřecí prsíč', 'kuřecí prsí']);
        expect(searchStems('')).toEqual([]);
    });
});

describe('budget', () => {
    it('adds steps to the goal and subtracts what was eaten', () => {
        expect(dayBudget(2100, 160.4, 1108)).toEqual({ goal: 2100, steps: 160, budget: 2260, eaten: 1108, left: 1152 });
        expect(dayBudget(0, 160, 500).budget).toBe(0);
    });

    it('reads over only past five percent', () => {
        expect(dayStatus(2380, 2230)).toBe('over');
        expect(dayStatus(2300, 2230)).toBe('near');
        expect(dayStatus(1800, 2230)).toBe('under');
        expect(dayStatus(0, 2230)).toBe('none');
    });

    it('draws the next meal dashed and the steps last', () => {
        const bar = budgetBar([{ key: 'breakfast', label: 'Breakfast', calories: 484 }, { key: 'lunch', label: 'Lunch', calories: 624 }], 650, dayBudget(2100, 160, 1108));
        expect(bar.whole).toBe(2260);
        expect(bar.parts.map((part) => [part.kind, part.value])).toEqual([
            ['eaten', 484], ['eaten', 624], ['next', 650], ['rest', 342], ['steps', 160],
        ]);
    });

    it('arrives at the goal at a pace that points toward it', () => {
        expect(arrivalDate('2026-11-01', 84.6, 78, -0.5)).toBe('2027-02-02');
        expect(arrivalDate('2026-11-01', 84.6, 78, 0.2)).toBeNull();
    });

    it('splits a budget into macro targets', () => {
        expect(macroTargets(2100, 78)).toEqual({ proteinG: 125, carbsG: 245, fatG: 70 });
    });

    it('finds the energy the estimate misses', () => {
        const result = calibration({ trackedDays: 29, averageEaten: 2144, averageBudget: 2239, goal: 2100, actualKgPerWeek: -0.42 });
        // The scale lost faster than the logged deficit explains: the days burn more than estimated.
        expect(result?.gap).toBe(-367);
        expect(result?.suggestedGoal).toBe(2470);
        expect(calibration({ trackedDays: 10, averageEaten: 2000, averageBudget: 2200, goal: 2100, actualKgPerWeek: 0 })).toBeNull();
    });
});

describe('nextMealSlot', () => {
    const meal = (id: string, filled: boolean) => ({ slot: { id, label: id, sortOrder: 0, archived: false, builtIn: true }, entries: filled ? [{} as never] : [], calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
    it('skips a snack logged in the morning', () => {
        expect(nextMealSlot([meal('breakfast', true), meal('lunch', true), meal('dinner', false), meal('snack', true)])).toBe('dinner');
        expect(nextMealSlot([meal('breakfast', true), meal('lunch', true), meal('dinner', true), meal('snack', false)])).toBeNull();
        expect(nextMealSlot([meal('breakfast', false), meal('lunch', true), meal('dinner', false), meal('snack', false)])).toBe('dinner');
    });
});
