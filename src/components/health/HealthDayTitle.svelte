<script lang="ts">
    import { dateTitleParts } from "../../health/day.js";

    /**
     * A day's heading in the endless list: the date in the serif face, with the
     * weekday quieter. Where each day scrolls itself (from lg) it stays at the
     * top while its day scrolls underneath; on phones the page scrolls the day
     * and the week strip above it names the day instead.
     */
    let { date, today, onWeek }: {
        date: string;
        today: string;
        /** Phones have no room for the week panels beside the list; this opens them in a sheet. */
        onWeek?: () => void;
    } = $props();

    const title = $derived(dateTitleParts(date));
    const isToday = $derived(date === today);
</script>

<header class="day-title" data-day-title>
    <h2 class="stor-serif-title title">
        <span class="weekday">{title.weekday}<span class="comma">,</span></span>
        {title.rest}
    </h2>
    {#if isToday}<span class="chip-today">Today</span>{/if}
    {#if onWeek}<button type="button" class="week" onclick={onWeek}>Week</button>{/if}
</header>

<style>
    .day-title {
        position: sticky; top: 0; z-index: 2; display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 8px 12px;
        padding: 6px 4px 10px; background: var(--stor-bg);
    }
    .title { font-size: 30px; font-weight: 500; line-height: 1.1; letter-spacing: -.014em; color: var(--stor-ink); }
    .weekday { color: var(--stor-muted-text); }
    .chip-today {
        display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 999px; white-space: nowrap;
        background: var(--stor-accent-soft); color: var(--stor-accent-text); font-size: 11px; font-weight: 600;
    }
    .week {
        display: none; height: 32px; margin-left: auto; padding: 0 12px; border-radius: 999px; font-size: 13px; font-weight: 600;
        background: var(--stor-surface-muted); color: var(--stor-ink);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--stor-border) 60%, transparent);
    }
    .week:hover { background: var(--stor-surface-hover); }
    .week:focus-visible { outline: 2px solid var(--stor-focus); outline-offset: 2px; }
    @media (max-width: 1023px) { .week { display: inline-flex; align-items: center; } }
    /* Phones name the day in the top bar and the strip; the week opens from the top bar's figures. */
    @media (max-width: 767px) { .day-title { display: none; } }
    /* Phones stack the weekday above the date, in the small caps the strip uses. */
    @media (max-width: 639px) {
        .day-title { align-items: flex-end; }
        .title { display: flex; flex-direction: column; gap: 3px; line-height: 1.05; }
        .weekday { font: 600 12px/1 var(--stor-font-sans); letter-spacing: .06em; text-transform: uppercase; }
        .comma { display: none; }
        .chip-today { margin-bottom: 5px; }
    }
</style>
