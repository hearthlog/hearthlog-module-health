<script lang="ts">
    import DayStepChart from "./DayStepChart.svelte";
    import UsualPaceToggle from "./UsualPaceToggle.svelte";
    import type { HealthTimelineRow, UsualPace } from "../../data/health-day.js";
    import type { HealthSources } from "../../health/day.js";

    /**
     * The day's running totals as two charts above the list, for screens too
     * narrow to spend a gutter on each side of the log.
     */
    const titleId = $props.id();
    let {
        rows,
        nowTime,
        targets,
        sources,
        usualPace = null,
        showUsual = false,
        onToggleUsual,
        class: className = "",
    }: {
        rows: HealthTimelineRow[];
        nowTime: string | null;
        targets: { calories: number; steps: number };
        sources: HealthSources;
        usualPace?: UsualPace | null;
        showUsual?: boolean;
        onToggleUsual?: () => void;
        class?: string;
    } = $props();

    let width = $state(320);
    const timeOf = (row: HealthTimelineRow): string => row.loggedAt.slice(11, 16);
    // The axis runs 06 to 21 and stretches to whatever the day actually holds.
    const startHour = $derived(rows.length > 0 ? Math.min(6, Math.floor(Number(timeOf(rows[0]).slice(0, 2)) / 3) * 3) : 6);
    const endHour = $derived.by(() => {
        const last = rows.length > 0 ? Number(timeOf(rows[rows.length - 1]).slice(0, 2)) + 1 : 0;
        const now = nowTime ? Number(nowTime.slice(0, 2)) + 1 : 0;
        return Math.min(24, Math.max(21, Math.ceil(Math.max(last, now) / 3) * 3));
    });
    const eaten = $derived(rows.filter((row) => row.kind === "meal").map((row) => ({ time: timeOf(row), total: row.kcalTotal })));
    const walked = $derived(rows.filter((row) => row.kind === "activity" && row.detail === "steps").map((row) => ({ time: timeOf(row), total: row.stepsTotal })));
</script>

{#if rows.length > 0 && (sources.meals || sources.activity)}
    <section class="stor-panel {className}" aria-labelledby="{titleId}-title">
        <header class="stor-panel-header stor-panel-header-rule">
            <h2 id="{titleId}-title" class="stor-panel-title">The day so far</h2>
            {#if sources.meals && usualPace && onToggleUsual}
                <UsualPaceToggle pressed={showUsual} onToggle={onToggleUsual} label="usual pace" />
            {/if}
        </header>
        <div class="charts">
            <div class="plots" bind:clientWidth={width}>
                {#if sources.meals}
                    <DayStepChart
                        title="Eaten"
                        tone="eat"
                        steps={eaten}
                        target={targets.calories}
                        {nowTime}
                        usual={showUsual ? usualPace?.points ?? null : null}
                        {startHour}
                        {endHour}
                        axis={!sources.activity}
                        {width}
                    />
                {/if}
                {#if sources.activity}
                    <DayStepChart
                        title="Steps"
                        tone="move"
                        steps={walked}
                        target={targets.steps}
                        {nowTime}
                        {startHour}
                        {endHour}
                        axis
                        {width}
                    />
                {/if}
            </div>
        </div>
    </section>
{/if}

<style>
    .charts { padding: var(--stor-panel-padding); }
    .plots { display: grid; gap: 14px; }
</style>
