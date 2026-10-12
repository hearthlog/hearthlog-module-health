import type { Component } from 'svelte';
import type { HealthTone } from '../../health/day.js';
import { activityIcon, foodIcon, weightIcon } from './health-icons.js';

export interface HealthLogItem {
    id: 'food' | 'activity' | 'weigh-in';
    label: string;
    description: string;
    /** The page and drawer that already exist; nothing here writes anything itself. */
    href: string;
    tone: HealthTone;
    icon: Component;
}

/** What can be logged on a day, limited to the features the tenant has. */
export function healthLogItems(date: string, sources: { meals: boolean; activity: boolean; body: boolean }): HealthLogItem[] {
    const items: HealthLogItem[] = [];
    if (sources.meals) {
        items.push({ id: 'food', label: 'Food', description: 'Meals, snacks and drinks', href: `/calories?date=${date}&newEntry=1`, tone: 'eat', icon: foodIcon });
    }
    if (sources.activity) {
        items.push({ id: 'activity', label: 'Activity', description: 'Steps or a workout', href: `/activities?date=${date}&newEntry=1`, tone: 'move', icon: activityIcon('workout') });
    }
    if (sources.body) {
        items.push({ id: 'weigh-in', label: 'Weigh-in', description: 'Weight and height', href: `/bmi?newWeighIn=1&date=${date}`, tone: 'body', icon: weightIcon });
    }
    return items;
}
