<script lang="ts">
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    import WeekBars from "../health/WeekBars.svelte";
    import { formatNumber } from "@hearthlog/sdk/format";
    import { formatShortDate, type HealthWeekDay } from "../../health/day.js";

    /** The strip's week as calorie columns against the budget, with the week's SQL averages beneath. */
    let {
        week,
        selected,
        today,
        target,
        proteinTarget,
        averageCalories,
        averageProteinG,
        trackedDays,
        loading,
        class: className = "",
    }: {
        week: readonly HealthWeekDay[];
        selected: string;
        today: string;
        /** The daily calorie goal; zero draws no goal line. */
        target: number;
        proteinTarget: number;
        /** Averages over the days that have something logged. */
        averageCalories: number;
        averageProteinG: number;
        trackedDays: number;
        loading: boolean;
        class?: string;
    } = $props();

    const dates = $derived(week.map((day) => day.date));
    const range = $derived(`${formatShortDate(week[0].date, selected)} – ${formatShortDate(week[6].date, selected)}`);
    const format = (value: number): string => formatNumber(value, 1);
    // Averages read as whole numbers, like the day view's week panel.
    const average = (value: number): string => (trackedDays > 0 ? formatNumber(value) : "—");
</script>

<section class="stor-panel {className}" aria-labelledby="nutrition-week-title">
    <header class="stor-panel-header">
        <h2 id="nutrition-week-title" class="font-semibold text-[var(--stor-ink)]">This week</h2>
        <span class="text-xs text-[var(--stor-muted-text)]">{range}</span>
    </header>
    <div class="px-[var(--stor-panel-padding)] pb-[var(--stor-panel-padding)]">
        {#if loading}
            <DataPlaceholder rows={5} compact />
        {:else}
            <div class="stor-tone-eat">
                <WeekBars
                    values={week.map((day) => day.calories)}
                    {dates}
                    {selected}
                    {today}
                    {target}
                    tone="eat"
                    mode="budget"
                    {format}
                    label="Calories, this week"
                    width={380}
                    plotHeight={104}
                />
            </div>
            <dl class="facts">
                <div><dt>Daily average</dt><dd>{average(averageCalories)}<small>&nbsp;kcal</small></dd></div>
                <div><dt>Goal</dt><dd>{target > 0 ? format(target) : "—"}<small>&nbsp;kcal</small></dd></div>
                <div><dt>Protein average</dt><dd>{average(averageProteinG)}<small>{proteinTarget > 0 ? ` / ${format(proteinTarget)} g` : " g"}</small></dd></div>
                <div><dt>Days logged</dt><dd>{trackedDays}<small>&nbsp;of 7</small></dd></div>
            </dl>
        {/if}
    </div>
</section>

<style>
    .facts {
        display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; margin: 16px 0 0; padding-top: 14px;
        border-top: 1px solid color-mix(in srgb, var(--stor-border) 70%, transparent);
    }
    .facts > div { padding: 8px 0; }
    .facts dt { font-size: 12px; font-weight: 500; color: var(--stor-muted-text); }
    .facts dd { margin: 2px 0 0; font-size: 18px; font-weight: 650; letter-spacing: -.015em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .facts dd small { font-size: 11.5px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
</style>
