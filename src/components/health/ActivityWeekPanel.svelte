<script lang="ts">
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    import { DataValue } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import HealthBudgetBar from "./HealthBudgetBar.svelte";
    import WeekBars from "./WeekBars.svelte";
    import { formatNumber } from "@hearthlog/sdk/format";
    import { dateTitleParts, formatShortDate, type HealthWeekDay } from "../../health/day.js";

    /**
     * The strip's week as step columns against the daily minimum, a day at goal
     * earning a check, and the week's workouts as a ladder against the weekly
     * exercise minutes.
     */
    let {
        week,
        selected,
        today,
        target,
        daysAtGoal,
        averageSteps,
        trackedDays,
        exerciseMinutes,
        exerciseTarget,
        workouts,
        sessions,
        loading,
        onEditGoals,
        class: className = "",
    }: {
        week: readonly HealthWeekDay[];
        selected: string;
        today: string;
        /** The daily steps goal; zero draws no goal line. */
        target: number;
        /** Days of the week that reached the goal, counted in SQL. */
        daysAtGoal: number;
        /** SQL average over the week's days that have steps. */
        averageSteps: number;
        trackedDays: number;
        /** The week's workout minutes, summed in SQL. */
        exerciseMinutes: number;
        /** The weekly exercise goal in minutes; zero when none is set. */
        exerciseTarget: number;
        workouts: number;
        /** Each of the week's workouts, oldest first. */
        sessions: readonly { id: string; date: string; minutes: number }[];
        loading: boolean;
        onEditGoals: () => void;
        class?: string;
    } = $props();

    const dates = $derived(week.map((day) => day.date));
    const range = $derived(`${formatShortDate(week[0].date, selected)} – ${formatShortDate(week[6].date, selected)}`);
    const toGo = $derived(
        exerciseTarget <= 0 ? "" : exerciseMinutes >= exerciseTarget ? "Goal reached" : `${formatNumber(exerciseTarget - exerciseMinutes)} min to go`,
    );
    const parts = $derived(sessions.map((session) => ({ key: session.id, label: dateTitleParts(session.date).weekday.slice(0, 3), value: session.minutes })));
    const ladderLabel = $derived(
        ["Workouts this week", ...parts.map((part) => `${part.label} ${formatNumber(part.value)} min`)].join(", ")
            + (exerciseTarget > 0 ? `, of ${formatNumber(exerciseTarget)} min` : ""),
    );
</script>

<section class="stor-panel {className}" aria-labelledby="activity-week-title">
    <header class="stor-panel-header">
        <h2 id="activity-week-title" class="font-semibold text-[var(--stor-ink)]">This week</h2>
        <span class="text-xs text-[var(--stor-muted-text)]">{range}</span>
    </header>
    <div class="px-[var(--stor-panel-padding)] pb-[var(--stor-panel-padding)]">
        {#if loading}
            <DataPlaceholder rows={5} compact />
        {:else}
            <div class="stor-tone-move">
                <WeekBars
                    values={week.map((day) => day.steps)}
                    {dates}
                    {selected}
                    {today}
                    {target}
                    tone="move"
                    mode="minimum"
                    format={formatNumber}
                    label="Steps, this week"
                    width={380}
                    plotHeight={104}
                />
            </div>
            <dl class="facts">
                <div><dt>Goal</dt><dd>{target > 0 ? formatNumber(target) : "—"}<small>&nbsp;steps a day</small></dd></div>
                <div><dt>Days at goal</dt><dd>{target > 0 ? daysAtGoal : "—"}<small>&nbsp;of 7</small></dd></div>
                <div><dt>Average</dt><dd>{trackedDays > 0 ? formatNumber(averageSteps) : "—"}<small>&nbsp;steps a day</small></dd></div>
            </dl>
            <div class="exercise stor-tone-move">
                <p class="lab"><i></i>Exercise · this week</p>
                <p class="big">
                    <DataValue>{formatNumber(exerciseMinutes)}</DataValue>
                    <small><DataValue>{exerciseTarget > 0 ? `of ${formatNumber(exerciseTarget)} min` : "min"}</DataValue></small>
                    {#if toGo}<span class="to-go">{toGo}</span>{/if}
                </p>
                <HealthBudgetBar {parts} target={exerciseTarget} tone="move" unit="min" label={ladderLabel} left={() => ""} />
                {#if exerciseTarget <= 0}<p class="sup">{workouts} {workouts === 1 ? "workout" : "workouts"} this week</p>{/if}
            </div>
            <CommandOnly>
                <Button variant="ghost" size="sm" class="-ml-3" onclick={onEditGoals}>Edit goals</Button>
            </CommandOnly>
        {/if}
    </div>
</section>

<style>
    .facts {
        display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; margin: 16px 0 6px; padding-top: 14px;
        border-top: 1px solid color-mix(in srgb, var(--stor-border) 70%, transparent);
    }
    .facts > div { padding: 8px 0; }
    .facts dt { font-size: 12px; font-weight: 500; color: var(--stor-muted-text); }
    .facts dd { margin: 2px 0 0; font-size: 18px; font-weight: 650; letter-spacing: -.015em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .facts dd small { font-size: 11.5px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .exercise { margin-top: 8px; padding-top: 14px; border-top: 1px solid color-mix(in srgb, var(--stor-border) 70%, transparent); }
    .lab { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--stor-muted-text); }
    .lab i { display: block; width: 8px; height: 8px; border-radius: 50%; background: var(--tone); }
    .big { margin: 6px 0 14px; font-size: 28px; font-weight: 650; line-height: 1.1; letter-spacing: -.03em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .big small { margin-left: 6px; font-size: 14px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .to-go { margin-left: 6px; font-size: 13px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .sup { margin-top: 8px; font-size: 12px; color: var(--stor-muted-text); }
</style>
