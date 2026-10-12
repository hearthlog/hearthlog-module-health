<script lang="ts">
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    import Sparkline from "./Sparkline.svelte";
    import WeekBars from "./WeekBars.svelte";
    import { formatNumber } from "@hearthlog/sdk/format";
    import { dayNumber } from "../../health/charts.js";
    import { formatShortDate, weightChangeLabel, type HealthBody, type HealthSources, type HealthWeekDay } from "../../health/day.js";

    /**
     * The strip's week as columns: calories against their budget, steps against
     * their minimum. Weight sits beneath as the last 30 days of its seven-day mean.
     */
    let {
        week,
        selected,
        today,
        targets,
        averages,
        sources,
        body = null,
        loading,
        class: className = "",
    }: {
        week: readonly HealthWeekDay[];
        selected: string;
        today: string;
        targets: { calories: number; steps: number };
        averages: { calories: number; steps: number };
        sources: HealthSources;
        body?: HealthBody | null;
        loading: boolean;
        class?: string;
    } = $props();

    const dates = $derived(week.map((day) => day.date));
    const range = $derived(`${formatShortDate(week[0].date, selected)} – ${formatShortDate(week[6].date, selected)}`);
    const weightPoints = $derived((body?.trend ?? []).map((point) => ({ x: dayNumber(point.date), y: point.mean })));

    function summary(average: number, target: number): string {
        const parts: string[] = [];
        if (average > 0) parts.push(`avg ${formatNumber(average)}`);
        if (target > 0) parts.push(`goal ${formatNumber(target)}`);
        return parts.join(" · ");
    }
</script>

<section class="stor-panel {className}" aria-labelledby="health-week-title">
    <header class="stor-panel-header">
        <h2 id="health-week-title" class="font-semibold text-[var(--stor-ink)]">This week</h2>
        <span class="text-xs text-[var(--stor-muted-text)]">{range}</span>
    </header>
    <div class="flex flex-col gap-5 px-[var(--stor-panel-padding)] pb-[var(--stor-panel-padding)]">
        {#if loading}
            <DataPlaceholder rows={4} compact />
        {:else}
            {#if sources.meals}
                <div class="stor-tone-eat">
                    <div class="mb-2 flex items-baseline justify-between gap-2">
                        <h3 class="flex items-center gap-2 text-[13px] font-semibold text-[var(--stor-ink)]"><i class="h-2 w-2 rounded-full bg-[var(--tone)]"></i>Calories</h3>
                        <span class="text-xs text-[var(--stor-muted-text)]">{summary(averages.calories, targets.calories)}</span>
                    </div>
                    <WeekBars
                        values={week.map((day) => day.calories)}
                        {dates}
                        {selected}
                        {today}
                        target={targets.calories}
                        tone="eat"
                        mode="budget"
                        format={formatNumber}
                        label="Calories, this week"
                        width={380}
                        plotHeight={78}
                    />
                </div>
            {/if}
            {#if sources.activity}
                <div class="stor-tone-move">
                    <div class="mb-2 flex items-baseline justify-between gap-2">
                        <h3 class="flex items-center gap-2 text-[13px] font-semibold text-[var(--stor-ink)]"><i class="h-2 w-2 rounded-full bg-[var(--tone)]"></i>Steps</h3>
                        <span class="text-xs text-[var(--stor-muted-text)]">{summary(averages.steps, targets.steps)}</span>
                    </div>
                    <WeekBars
                        values={week.map((day) => day.steps)}
                        {dates}
                        {selected}
                        {today}
                        target={targets.steps}
                        tone="move"
                        mode="minimum"
                        format={formatNumber}
                        label="Steps, this week"
                        width={380}
                        plotHeight={78}
                    />
                </div>
            {/if}
            {#if sources.body && weightPoints.length > 1}
                <div class="stor-tone-body">
                    <div class="mb-2 flex items-baseline justify-between gap-2">
                        <h3 class="flex items-center gap-2 text-[13px] font-semibold text-[var(--stor-ink)]"><i class="h-2 w-2 rounded-full bg-[var(--tone)]"></i>Weight</h3>
                        <span class="text-xs text-[var(--stor-muted-text)]">{weightChangeLabel(body?.delta ?? null)}</span>
                    </div>
                    <Sparkline points={weightPoints} tone="body" label="Weight over the last 30 days" width={380} height={64} />
                </div>
            {/if}
        {/if}
    </div>
</section>
