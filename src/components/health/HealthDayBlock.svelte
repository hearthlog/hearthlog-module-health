<script lang="ts">
    import { providePageResource } from "@hearthlog/sdk/runtime";
    import HealthDayTitle from "./HealthDayTitle.svelte";
    import HealthDayReadout from "./HealthDayReadout.svelte";
    import HealthDayTimeline from "./HealthDayTimeline.svelte";
    import DayRiverCharts from "./DayRiverCharts.svelte";
    import { effectiveMealSlots, type StoredMealSlot } from "../../calories/logic.js";
    import { appClock } from "@hearthlog/sdk/runtime";
    import { dateTitleParts, nextEmptyMealSlot, type HealthSources } from "../../health/day.js";
    import type { HealthDayBlock } from "../../health/day-blocks.js";

    /**
     * One day of the Health list: its date, the day's three numbers, and the log
     * with the river beside it. A day still loading draws the same frame with
     * placeholders, so the list keeps its shape as days arrive.
     */
    let {
        date,
        today,
        day,
        sources,
        mealSlots,
        showUsual,
        onToggleUsual,
        onWeek,
    }: {
        date: string;
        today: string;
        /** Missing while the day loads. */
        day?: HealthDayBlock;
        sources: HealthSources;
        mealSlots: StoredMealSlot[];
        showUsual: boolean;
        onToggleUsual: () => void;
        onWeek: () => void;
    } = $props();

    // Values and controls inside this day wait for this day, not for the page.
    providePageResource(() => ({ loading: day === undefined }));

    const loading = $derived(day === undefined);
    const label = $derived(`${dateTitleParts(date).weekday}, ${dateTitleParts(date).rest}`);
    const nowTime = $derived(date === today ? appClock.now().toTimeString().slice(0, 5) : null);
    const targets = $derived(day?.targets ?? { calories: 0, steps: 0 });
    const nextMeal = $derived(day && sources.meals ? nextEmptyMealSlot(effectiveMealSlots(mealSlots), day.timeline) : null);
</script>

<section class="day" aria-label={label} data-day={date}>
    <HealthDayTitle {date} {today} {onWeek} />
    <div class="body">
        <!-- Phones keep the numbers and charts in the sheet behind the top bar's figures. -->
        <div class="max-md:hidden"><HealthDayReadout {date} {today} {sources} {day} {loading} /></div>
        {#if day}
            <DayRiverCharts
                class="day-charts max-md:!hidden"
                rows={day.timeline}
                {nowTime}
                {targets}
                {sources}
                usualPace={day.usualPace}
                {showUsual}
                {onToggleUsual}
            />
        {/if}
        <HealthDayTimeline
            rows={day?.timeline ?? []}
            {loading}
            selectedDate={date}
            {nowTime}
            {nextMeal}
            {targets}
            {sources}
            usualPace={day?.usualPace ?? null}
            {showUsual}
            {onToggleUsual}
        />
    </div>
</section>

<style>
    /* A day lays out by its own width: a wide day flanks its log with the river gutters, a narrow one
       (a phone, or one of the columns on a wide screen) draws the river as charts above the log. */
    .day { container: health-day / inline-size; padding-bottom: var(--stor-section-gap); }
    @container health-day (min-width: 32rem) { .body :global(.day-charts) { display: none; } }
    /* A narrow day reads its log first; the charts that retell it follow. */
    @container health-day (max-width: calc(32rem - 1px)) { .body :global(.day-charts) { order: 1; } }
    .body { display: flex; flex-direction: column; gap: var(--stor-section-gap); }
</style>
