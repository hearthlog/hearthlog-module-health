<script lang="ts">
    import { riverScale } from "../../health/river.js";
    import { formatNumber } from "@hearthlog/sdk/format";
    import type { HealthTone } from "../../health/day.js";

    /**
     * A running total across the day, lying down: time runs left to right and
     * the total steps up at every entry. A dotted line marks the target, an
     * optional dotted curve the usual pace, and today's chart ends at now.
     */
    let {
        title,
        tone,
        steps,
        target,
        nowTime,
        usual = null,
        startHour,
        endHour,
        axis = false,
        width,
    }: {
        title: string;
        tone: HealthTone;
        /** Each entry's time (`HH:mm`) and the running total after it, in order. */
        steps: readonly { time: string; total: number }[];
        target: number;
        /** `HH:mm` on today, where the line stops; null on other days. */
        nowTime: string | null;
        /** The usual total by time of day, in order. */
        usual?: readonly { time: string; kcal: number }[] | null;
        startHour: number;
        endHour: number;
        /** Draws the hour labels under the plot. */
        axis?: boolean;
        width: number;
    } = $props();

    const pad = { left: 2, right: 8, top: 8, bottom: 2 };
    const plotHeight = 74;
    const height = $derived(pad.top + plotHeight + pad.bottom + (axis ? 18 : 0));
    const plotWidth = $derived(Math.max(1, width - pad.left - pad.right));
    const minutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    const start = $derived(startHour * 60);
    const span = $derived(endHour * 60 - startHour * 60);
    const x = (time: string | number): number => pad.left + (((typeof time === "number" ? time : minutes(time)) - start) / span) * plotWidth;

    const current = $derived(steps.at(-1)?.total ?? 0);
    const scale = $derived(riverScale(target, current, ...(usual ?? []).map((point) => point.kcal)));
    const y = (value: number): number => pad.top + (1 - Math.min(1, value / scale)) * plotHeight;
    const base = $derived(pad.top + plotHeight);

    // Stepped path: level, then a jump at each entry, then level until now (or the end of the day).
    const reachX = $derived(nowTime ? x(nowTime) : x(endHour * 60));
    const line = $derived.by(() => {
        let path = `M${x(start)} ${y(0)}`;
        for (const step of steps) path += `H${x(step.time)}V${y(step.total)}`;
        return `${path}H${reachX}`;
    });
    const area = $derived(`${line}V${base}H${x(start)}Z`);
    // The usual pace is sampled around the clock; only the part inside the axis is drawn.
    const usualInside = $derived((usual ?? []).filter((point) => minutes(point.time) >= start && minutes(point.time) <= start + span));
    const usualLine = $derived(usualInside.length > 1 ? usualInside.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.time)} ${y(point.kcal)}`).join("") : "");
    const ticks = $derived(Array.from({ length: Math.floor((endHour - startHour) / 3) + 1 }, (_, index) => startHour + index * 3));
</script>

<div class="chart stor-tone-{tone}">
    <div class="top">
        <b>{title}</b>
        {#if target > 0}<span>target {formatNumber(target)}</span>{/if}
    </div>
    <svg {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label="{title} through the day, {formatNumber(current)} so far">
        {#if target > 0}<line class="target" x1={pad.left} x2={width - pad.right} y1={y(target)} y2={y(target)} />{/if}
        <line class="base" x1={pad.left} x2={width - pad.right} y1={base} y2={base} />
        <path class="area" d={area} />
        <path class="line" d={line} />
        {#if usualLine}<path class="usual" d={usualLine} />{/if}
        {#if nowTime}
            <line class="now" x1={reachX} x2={reachX} y1={pad.top} y2={base} />
            <circle class="dot" cx={reachX} cy={y(current)} r="5" />
        {/if}
        {#if axis}
            {#each ticks as hour (hour)}
                <text class="tick" x={x(hour * 60)} y={height - 3} text-anchor="middle">{String(hour).padStart(2, "0")}</text>
            {/each}
        {/if}
    </svg>
</div>

<style>
    .chart { display: block; }
    .top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 4px; font-size: 12px; color: var(--stor-muted-text); }
    .top b { font-size: 13px; font-weight: 650; color: var(--stor-ink); }
    svg { display: block; overflow: visible; }
    .target { stroke: var(--stor-muted-text); stroke-opacity: .5; stroke-width: 1; stroke-dasharray: 2 3; }
    .base { stroke: color-mix(in srgb, var(--stor-border) 80%, transparent); stroke-width: 1; }
    .area { fill: color-mix(in srgb, var(--tone) 14%, transparent); }
    .line { fill: none; stroke: var(--tone); stroke-width: 2; stroke-linejoin: round; }
    .usual { fill: none; stroke: var(--stor-muted-text); stroke-opacity: .75; stroke-width: 1.5; stroke-dasharray: 1.5 3.5; stroke-linecap: round; stroke-linejoin: round; }
    .now { stroke: var(--stor-accent); stroke-opacity: .5; stroke-width: 1; }
    .dot { fill: var(--tone); stroke: var(--stor-surface); stroke-width: 2.5; }
    .tick { font-size: 11px; fill: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
</style>
