<script lang="ts">
    import { DataValue } from "@hearthlog/sdk/ui";
    import { formatFixed, formatNumber } from "@hearthlog/sdk/format";
    import {
        bmiSummary,
        eatStatus,
        eatStatusShort,
        goalProgress,
        moveStatus,
        moveStatusShort,
        weighStatus,
        weightChangeLabel,
        weightChangeShort,
        type HealthSources,
    } from "../../health/day.js";
    import type { HealthDayBlock } from "../../health/day-blocks.js";

    /**
     * The day's three numbers with their standing in one line each and a thin
     * meter under calories and steps. The log below carries the story; this
     * only says where the day stands.
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
    const moveLong = $derived(move.stepsTarget > 0 && move.steps < move.stepsTarget ? `${moveStatus(move.steps, move.stepsTarget)} of ${formatNumber(move.stepsTarget)}` : moveStatus(move.steps, move.stepsTarget));
</script>

<section class="stor-panel hero {className}" aria-label="Day summary">
    {#if sources.meals}
        <article class="tile stor-tone-eat" aria-label="Eat">
            <p class="label"><i class="dot"></i>Eat</p>
            <p class="big"><DataValue>{formatNumber(eat.calories)}</DataValue><small>kcal</small></p>
            {#if !loading}
                <p class="sup" class:warn={eatGoal.tone === "over"}>
                    {#if eat.target > 0}<span class="long">{eatLong}</span><span class="short">{eatStatusShort(eat.calories, eat.target)}</span>{:else if eat.calories === 0}Nothing logged{:else}&nbsp;{/if}
                </p>
            {/if}
            {#if eat.target > 0}<i class="thin" aria-hidden="true"><b class:over={eatGoal.tone === "over"} style:width="{Math.min(1, eatGoal.ratio ?? 0) * 100}%"></b></i>{/if}
        </article>
    {/if}
    {#if sources.activity}
        <article class="tile stor-tone-move" aria-label="Move">
            <p class="label"><i class="dot"></i>Move</p>
            <p class="big"><DataValue>{formatNumber(move.steps)}</DataValue><small>steps</small></p>
            {#if !loading}
                <p class="sup" class:pos={moveGoal.tone === "met"}>
                    {#if move.stepsTarget > 0}<span class="long">{moveLong}</span><span class="short">{moveStatusShort(move.steps, move.stepsTarget)}</span>{:else if move.steps === 0}Nothing logged{:else}&nbsp;{/if}
                </p>
            {/if}
            {#if move.stepsTarget > 0}<i class="thin" aria-hidden="true"><b style:width="{Math.min(1, moveGoal.ratio ?? 0) * 100}%"></b></i>{/if}
        </article>
    {/if}
    {#if sources.body}
        <article class="tile stor-tone-body" aria-label="Weigh">
            <p class="label"><i class="dot"></i>Weigh</p>
            <p class="big"><DataValue>{body ? formatFixed(body.weight, 1) : "—"}</DataValue><small>kg</small></p>
            {#if !loading}
                <p class="sup">
                    {#if body}
                        {#if bodyChange}<span class="long">{bodyChange}{#if bmiSummary(body.weight, body.height)} · {bmiSummary(body.weight, body.height)}{/if}</span><span class="short">{weightChangeShort(body.delta)}</span>{:else}{weighStatus(body.date, date, today)}{/if}
                    {:else}No weigh-in yet{/if}
                </p>
            {/if}
        </article>
    {/if}
</section>

<style>
    /* Phones and tablets keep three compact columns; a panel that spans the page spreads them out. */
    .hero { container-type: inline-size; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
    .tile { position: relative; min-width: 0; padding: 14px 14px 16px; }
    .tile + .tile::before { content: ""; position: absolute; top: 14px; bottom: 14px; left: 0; width: 1px; background: color-mix(in srgb, var(--stor-border) 70%, transparent); }
    .label { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--stor-muted-text); }
    .dot { display: block; width: 8px; height: 8px; border-radius: 50%; background: var(--tone); }
    .big { margin-top: 6px; font-size: 23px; font-weight: 650; line-height: 1.1; letter-spacing: -.025em; color: var(--stor-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .big small { margin-left: 4px; font-size: 11px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .sup { margin-top: 3px; font-size: 12px; line-height: 1.35; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .sup.warn { color: var(--stor-warning); }
    .sup.pos { color: var(--stor-positive); }
    .long { display: none; }
    .thin { display: none; }

    /* A phone's three columns are about 115px each: the figures step down so "6 000 steps" fits. */
    @container (max-width: 25rem) {
        .tile { padding: 12px 10px 13px; }
        .tile + .tile::before { top: 12px; bottom: 12px; }
        .label { gap: 6px; font-size: 11.5px; }
        .big { margin-top: 4px; font-size: 20px; }
        .big small { margin-left: 3px; font-size: 10.5px; }
        .sup { font-size: 11.5px; }
    }

    @container (min-width: 44rem) {
        .tile { padding: 22px 26px 24px; }
        .tile + .tile::before { top: 22px; bottom: 22px; }
        .big { margin-top: 8px; font-size: 32px; letter-spacing: -.03em; }
        .big small { margin-left: 6px; font-size: 14px; }
        .sup { margin-top: 4px; font-size: 12.5px; }
        .long { display: inline; }
        .short { display: none; }
        .thin {
            display: block; height: 4px; margin-top: 14px; overflow: hidden; border-radius: 2px;
            background: color-mix(in srgb, var(--tone) 18%, var(--stor-surface));
        }
        .thin b { display: block; height: 100%; border-radius: 2px; background: var(--tone); }
        .thin b.over { background: repeating-linear-gradient(135deg, var(--tone) 0 3px, var(--stor-warning) 3px 5px); }
    }
</style>
