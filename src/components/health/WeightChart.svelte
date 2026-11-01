<script lang="ts">
    import { dayNumber, monotonePath, monthStartDays, niceTicks } from "../../health/charts.js";
    import { formatShortDate } from "../../health/day.js";
    import { formatFixed } from "@hearthlog/sdk/format";
    import type { WeightMeanPoint, WeightPoint } from "../../data/weight-logs.js";

    /**
     * Weight over time in the Body colour: the seven-day mean as a smooth line,
     * each weigh-in as a hollow point, the latest one named. A soft band marks
     * the reference range when it reaches the plot. Hovering names a weigh-in.
     * With a goal, its weight is a dashed line, the plan a dotted one, and the
     * trend carries on dashed at its actual pace to where it meets the goal.
     */
    let {
        weighIns,
        mean,
        from,
        to,
        band = null,
        goal = null,
        plan = null,
        projection = null,
        today = null,
        label,
    }: {
        weighIns: readonly WeightPoint[];
        mean: readonly WeightMeanPoint[];
        /** The first and last day of the range shown. */
        from: string;
        to: string;
        /** Weights at BMI 18.5 and 24.9 for the current height. */
        band?: { min: number; max: number } | null;
        /** The goal weight. */
        goal?: number | null;
        /** The planned line, from the goal's start to its date. */
        plan?: { from: string; fromKg: number; to: string; toKg: number } | null;
        /** The trend carried on at its actual pace, from its last point. */
        projection?: { from: string; fromKg: number; to: string; toKg: number } | null;
        /** Marks today when the axis runs past it. */
        today?: string | null;
        /** Spoken form, for example "Weight over the last 90 days". */
        label: string;
    } = $props();

    const pad = { top: 26, right: 14, bottom: 26, left: 44 };
    let width = $state(640);
    const height = $derived(width < 520 ? 224 : 268);
    const plotWidth = $derived(Math.max(1, width - pad.left - pad.right));
    const plotHeight = $derived(height - pad.top - pad.bottom);

    const firstDay = $derived(dayNumber(from));
    const lastDay = $derived(dayNumber(to));
    const spanDays = $derived(lastDay - firstDay);
    const x = (day: number): number => pad.left + ((day - firstDay) / (spanDays || 1)) * plotWidth;

    // The vertical scale fits the drawn values with some air; a reference range close below them is kept in view.
    const scale = $derived.by(() => {
        const values = [
            ...weighIns.map((point) => point.weight),
            ...mean.map((point) => point.mean),
            ...(goal ? [goal] : []),
            ...(projection ? [projection.toKg] : []),
        ];
        if (values.length === 0) return { low: 0, high: 1 };
        let lo = values[0];
        let hi = values[0];
        for (const value of values) {
            if (value < lo) lo = value;
            if (value > hi) hi = value;
        }
        const air = Math.max(0.5, (hi - lo) * 0.16);
        let low = lo - air;
        if (band && band.max < lo && lo - band.max <= Math.max(2, (hi - lo) * 1.5)) low = Math.min(low, band.max - air * 0.6);
        return { low, high: hi + air };
    });
    const y = (weight: number): number => pad.top + (1 - (weight - scale.low) / (scale.high - scale.low)) * plotHeight;

    const yTicks = $derived(niceTicks(scale.low, scale.high, Math.min(7, Math.max(3, Math.floor(plotHeight / 42)))));
    const bandBox = $derived.by(() => {
        if (!band || band.max < scale.low || band.min > scale.high) return null;
        const top = y(Math.min(band.max, scale.high));
        const bottom = y(Math.max(band.min, scale.low));
        return { top, height: bottom - top, labelY: Math.max(top + 13, pad.top + 13) };
    });

    /** A straight line between two dated weights, cut to the days on the axis. */
    function segment(line: { from: string; fromKg: number; to: string; toKg: number } | null) {
        if (!line) return null;
        const start = dayNumber(line.from);
        const end = dayNumber(line.to);
        const at = (day: number) => line.fromKg + ((line.toKg - line.fromKg) * (day - start)) / Math.max(1, end - start);
        const a = Math.max(firstDay, start);
        const b = Math.min(lastDay, end);
        return b > a ? { x1: x(a), y1: y(at(a)), x2: x(b), y2: y(at(b)) } : null;
    }
    const planLine = $derived(segment(plan));
    const projectionLine = $derived(segment(projection));
    const todayX = $derived(today && dayNumber(today) < lastDay && dayNumber(today) > firstDay ? x(dayNumber(today)) : null);

    const linePoints = $derived(mean.map((point) => ({ x: x(dayNumber(point.date)), y: y(point.mean) })));
    const line = $derived(monotonePath(linePoints));
    // A crowded range would turn hollow points into noise; the mean line carries it.
    const showPoints = $derived(weighIns.length <= Math.max(60, plotWidth / 6));
    const latest = $derived(weighIns[weighIns.length - 1] ?? null);
    const latestX = $derived(latest ? x(dayNumber(latest.date)) : 0);
    const labelEnd = $derived(latestX > width - 56);
    // The name sits on the side of the point the line does not run through.
    const labelBelow = $derived(latest !== null && mean.length > 0 && latest.weight <= mean[mean.length - 1].mean);
    const labelY = $derived(latest ? Math.min(y(latest.weight) + (labelBelow ? 25 : -12), pad.top + plotHeight - 3) : 0);

    const monthLabel = (day: number): string => new Intl.DateTimeFormat("en-US", spanDays <= 130
        ? { month: "short", day: "numeric", timeZone: "UTC" }
        : { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(day * 86_400_000));
    // Month starts thinned to keep their labels apart, then the last day closes the axis.
    const xTicks = $derived.by(() => {
        const minGap = spanDays <= 130 ? 62 : 76;
        const kept: { text: string; at: number; end: boolean }[] = [];
        let previous = pad.left + 8;
        for (const day of monthStartDays(firstDay, lastDay)) {
            const at = x(day);
            if (at - previous >= minGap) {
                kept.push({ text: monthLabel(day), at, end: false });
                previous = at;
            }
        }
        const endAt = x(lastDay);
        while (kept.length > 0 && endAt - kept[kept.length - 1].at < minGap) kept.pop();
        kept.push({ text: formatShortDate(to, to), at: endAt, end: true });
        return kept;
    });

    // Hover names the weigh-in nearest the pointer.
    let hovered = $state<number | null>(null);
    function track(event: PointerEvent): void {
        const box = (event.currentTarget as SVGRectElement).getBoundingClientRect();
        const day = firstDay + ((event.clientX - box.left) / box.width) * spanDays;
        let best = -1;
        let distance = Infinity;
        weighIns.forEach((point, index) => {
            const gap = Math.abs(dayNumber(point.date) - day);
            if (gap < distance) { distance = gap; best = index; }
        });
        hovered = best === -1 ? null : best;
    }
    const tag = $derived.by(() => {
        if (hovered === null || !weighIns[hovered]) return null;
        const point = weighIns[hovered];
        const text = `${formatShortDate(point.date, to)} · ${formatFixed(point.weight, 1)} kg`;
        const boxWidth = text.length * 6.3 + 16;
        const at = x(dayNumber(point.date));
        return { text, at, top: y(point.weight), boxWidth, left: Math.min(Math.max(at - boxWidth / 2, pad.left), width - pad.right - boxWidth) };
    });
</script>

<div class="chart stor-tone-body" bind:clientWidth={width}>
    <svg {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label={label}>
        {#each yTicks as tick (tick)}
            <line class="grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text class="axis" x={pad.left - 8} y={y(tick) + 3.5} text-anchor="end">{formatFixed(tick, 1)}</text>
        {/each}
        {#if bandBox}
            <rect class="band" x={pad.left} y={bandBox.top} width={plotWidth} height={bandBox.height} />
            {#if band}<text class="band-label" x={pad.left + 8} y={bandBox.labelY}>Reference range · up to {formatFixed(band.max, 1)} kg</text>{/if}
        {/if}
        {#each xTicks as tick (tick.at)}
            <text class="axis" x={tick.at} y={height - 7} text-anchor={tick.end ? "end" : "middle"}>{tick.text}</text>
        {/each}
        {#if goal}
            <line class="goal" x1={pad.left} x2={width - pad.right} y1={y(goal)} y2={y(goal)} />
            <text class="goal-label" x={pad.left + 6} y={y(goal) - 6}>Goal {formatFixed(goal, 1)} kg</text>
        {/if}
        {#if planLine}<line class="plan" x1={planLine.x1} y1={planLine.y1} x2={planLine.x2} y2={planLine.y2} />{/if}
        {#if projectionLine}<line class="projection" x1={projectionLine.x1} y1={projectionLine.y1} x2={projectionLine.x2} y2={projectionLine.y2} />{/if}
        {#if todayX !== null}
            <line class="today" x1={todayX} x2={todayX} y1={pad.top} y2={pad.top + plotHeight} />
            <text class="today-label" x={todayX + 4} y={pad.top + 10}>Today</text>
        {/if}
        {#if linePoints.length > 1}<path class="line" d={line} />{/if}
        {#if showPoints}
            {#each weighIns as point}
                <circle class="point" cx={x(dayNumber(point.date))} cy={y(point.weight)} r="3.2" />
            {/each}
        {/if}
        {#if latest}
            <circle class="halo" cx={latestX} cy={y(latest.weight)} r="8" />
            <circle class="dot" cx={latestX} cy={y(latest.weight)} r="4.2" />
            <text class="value" x={labelEnd ? latestX + 5 : latestX} y={labelY} text-anchor={labelEnd ? "end" : "middle"}>{formatFixed(latest.weight, 1)}</text>
        {/if}
        {#if tag}
            <line class="guide" x1={tag.at} x2={tag.at} y1={pad.top} y2={pad.top + plotHeight} />
            <circle class="pick" cx={tag.at} cy={tag.top} r="4.6" />
            <rect class="tag" x={tag.left} y={pad.top - 24} width={tag.boxWidth} height="20" rx="7" />
            <text class="tag-text" x={tag.left + tag.boxWidth / 2} y={pad.top - 10} text-anchor="middle">{tag.text}</text>
        {/if}
        <rect class="hit" x={pad.left} y={pad.top} width={plotWidth} height={plotHeight} role="presentation" onpointermove={track} onpointerleave={() => hovered = null} />
    </svg>
</div>

<style>
    .chart { width: 100%; }
    svg { display: block; overflow: visible; touch-action: pan-y; }
    .grid { stroke: color-mix(in srgb, var(--stor-border) 60%, transparent); stroke-width: 1; }
    .axis { font-size: 11px; fill: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .band { fill: color-mix(in srgb, var(--stor-positive) 9%, transparent); }
    .band-label { font-size: 10.5px; font-weight: 600; fill: var(--stor-positive); }
    .line { fill: none; stroke: var(--tone); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .point { fill: var(--stor-surface); stroke: var(--tone); stroke-width: 1.4; }
    .halo { fill: var(--tone); opacity: .18; }
    .dot { fill: var(--tone); stroke: var(--stor-surface); stroke-width: 2; }
    .value { font-size: 14px; font-weight: 650; fill: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .guide { stroke: var(--stor-muted-text); stroke-opacity: .4; stroke-dasharray: 2 3; }
    .pick { fill: var(--tone); stroke: var(--stor-surface); stroke-width: 2; }
    .tag { fill: var(--stor-ink); }
    .tag-text { font-size: 11px; font-weight: 600; fill: var(--stor-surface); font-variant-numeric: tabular-nums; }
    .hit { fill: transparent; }
    .goal { stroke: var(--stor-ink); stroke-opacity: .55; stroke-width: 1.2; stroke-dasharray: 6 4; }
    .goal-label { font-size: 11px; font-weight: 600; fill: var(--stor-muted-text); }
    .plan { stroke: var(--stor-muted-text); stroke-width: 1.4; stroke-dasharray: 1.5 4; stroke-linecap: round; }
    .projection { stroke: var(--tone); stroke-width: 2; stroke-dasharray: 6 5; stroke-linecap: round; opacity: .8; }
    .today { stroke: var(--stor-now); stroke-width: 1.4; }
    .today-label { font-size: 10.5px; font-weight: 600; fill: var(--stor-now); }
</style>
