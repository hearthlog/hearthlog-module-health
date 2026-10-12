import type { Component } from 'svelte';
import type { ActivityKind } from '../../activities/logic.js';
import IconFood from '~icons/mdi/food-apple-outline';
import IconWalk from '~icons/mdi/walk';
import IconDumbbell from '~icons/mdi/dumbbell';
import IconRun from '~icons/mdi/run';
import IconWeight from '~icons/mdi/weight-kilogram';

/** The glyph a log entry wears in its tile: one per kind, never per name. */
export const foodIcon: Component = IconFood;
export const weightIcon: Component = IconWeight;

export function activityIcon(kind: ActivityKind): Component {
    if (kind === 'steps') return IconWalk;
    if (kind === 'workout') return IconDumbbell;
    return IconRun;
}
