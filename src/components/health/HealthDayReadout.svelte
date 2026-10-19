<script lang="ts">
    import { DataValue, Metric } from "@hearthlog/sdk/ui";
    import HealthRing from "./HealthRing.svelte";
    import { formatFixed, formatNumber } from "@hearthlog/sdk/format";
    import {
        bmiSummary,
        eatStatus,
        goalProgress,
        moveStatus,
        weighStatus,
        weightChangeLabel,
        type HealthSources,
    } from "../../health/day.js";
    import type { HealthDayBlock } from "../../health/day-blocks.js";

    /**
     * The day's band: Eat against its budget ring, Move and Weigh as figures,
     * each with one support line. The log below carries the story; this only
     * says where the day stands.
     */
    let {
        date,
        today,
        sources,
        day,
        loading,
        class: className = "",
    }: {
        date: string;
        today: string;
        sources: HealthSources;
        /** The day's numbers; missing while the day loads. */
        day?: Pick<HealthDayBlock, "eat" | "move" | "body">;
        loading: boolean;
        class?: string;
    } = $props();

    const eat = $derived(day?.eat ?? { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, target: 0 });
    const move = $derived(day?.move ?? { steps: 0, stepsTarget: 0, exerciseMinutes: 0, activeCalories: 0 });
    const eatGoal = $derived(goalProgress(eat.calories, eat.target, "budget"));
    const moveGoal = $derived(goalProgress(move.steps, move.stepsTarget, "minimum"));
    const body = $derived(day?.body ?? null);
    const bodyChange = $derived(weightChangeLabel(body?.delta ?? null));

    const eatLong = $derived(eat.target > 0 ? `${eatStatus(eat.calories, eat.target)} of ${formatNumber(eat.target)}` : "");
    const eatLabel = $derived(`${formatNumber(eat.calories)}${eat.target > 0 ? ` of ${formatNumber(eat.target)}` : ""} kcal`);
    const moveLong = $derived(move.stepsTarget > 0 && move.steps < move.stepsTarget ? `${moveStatus(move.steps, move.stepsTarget)} of ${formatNumber(move.stepsTarget)}` : moveStatus(move.steps, move.stepsTarget));
</script>

<section class="stor-panel hero {className}" aria-label="Day summary">
    {#if sources.meals}
        <article class="tile eat" aria-label="Eat">
            {#if eat.target > 0}
                <div class="eat-ring">
                    <HealthRing
                        ratio={eatGoal.ratio}
                        tone="eat"
                        value={formatNumber(eat.calories)}
                        unit="kcal"
                        label={eatLabel}
                        center={loading ? "" : `${Math.round((eatGoal.ratio ?? 0) * 100)}%`}
                        empty={eat.calories === 0}
                    />
                </div>
            {/if}
            <Metric label="Eat" size="lg" unit="kcal" detail={loading ? "" : eat.target > 0 ? eatLong : eat.calories === 0 ? "Nothing logged" : ""} class={eatGoal.tone === "over" ? "over" : ""}>
                <DataValue>{formatNumber(eat.calories)}</DataValue>
            </Metric>
        </article>
    {/if}
    {#if sources.activity}
        <article class="tile" aria-label="Move">
            <Metric label="Move" size="lg" unit="steps" detail={loading ? "" : move.stepsTarget > 0 ? moveLong : move.steps === 0 ? "Nothing logged" : ""}>
                <DataValue>{formatNumber(move.steps)}</DataValue>
            </Metric>
        </article>
    {/if}
    {#if sources.body}
        <article class="tile" aria-label="Weigh">
            <Metric
                label="Weigh"
                size="lg"
                unit="kg"
                detail={loading ? "" : body ? (bodyChange ? `${bodyChange}${bmiSummary(body.weight, body.height) ? ` · ${bmiSummary(body.weight, body.height)}` : ""}` : weighStatus(body.date, date, today)) : "No weigh-in yet"}
            >
                <DataValue>{body ? formatFixed(body.weight, 1) : "—"}</DataValue>
            </Metric>
        </article>
    {/if}
</section>

<style>
    /* The band keeps three columns; a column too narrow for the ring beside its figure stacks it above. */
    .hero { container-type: inline-size; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
    .tile { position: relative; display: flex; min-width: 0; flex-direction: column; justify-content: center; gap: 10px; padding: 14px 14px 16px; }
    .tile + .tile::before { content: ""; position: absolute; top: 14px; bottom: 14px; left: 0; width: 1px; background: var(--stor-border); }
    .eat-ring { --ring-size: 48px; }
    .tile :global(.stor-metric-support) { overflow-wrap: anywhere; }
    .tile :global(.stor-metric.over .stor-metric-support) { color: var(--stor-warning); }
    /* A phone's three columns are about 115px each: the figures step down so "6 000 steps" fits. */
    @container (max-width: 25rem) {
        .tile { padding: 12px 10px 13px; }
        .tile :global(.stor-metric-value) { font-size: 20px; line-height: 24px; }
    }
    @container (min-width: 44rem) {
        .tile { flex-direction: row; align-items: center; gap: 16px; padding: 22px 26px 24px; }
        .tile + .tile::before { top: 22px; bottom: 22px; }
        .eat-ring { --ring-size: 72px; }
    }
</style>
