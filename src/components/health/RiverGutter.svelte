<script lang="ts">
    import { riverPaths, riverPercent, type RiverCell } from "../../health/river.js";
    import type { HealthTone } from "../../health/day.js";

    /**
     * One row's slice of a gutter beside the log: the running total as a stepped
     * area growing away from the log, a dotted line at the target and, when it
     * is on, the usual pace. The slice that ends the line names the total.
     */
    let {
        cell,
        side,
        tone,
        target,
        scale,
        budget = false,
        label = "",
    }: {
        /** Null past the end of the line: only the target shows. */
        cell: RiverCell | null;
        side: "left" | "right";
        tone: HealthTone;
        target: number;
        /** The value at the far edge of the gutter. */
        scale: number;
        /** A budget marks what lies beyond its target in amber; a minimum does not. */
        budget?: boolean;
        /** The total, named where the line ends. */
        label?: string;
    } = $props();

    const uid = $props.id();
    const paths = $derived(cell ? riverPaths(cell, side) : null);
    const targetAt = $derived(target > 0 ? (side === "left" ? 100 - riverPercent(target, scale) : riverPercent(target, scale)) : null);
    const endShare = $derived(cell ? cell.after : 0);
    // The side of the target line that is "beyond" the budget, in gutter units.
    const beyond = $derived.by(() => {
        if (!budget || targetAt === null) return null;
        return side === "left" ? { x: 0, width: targetAt } : { x: targetAt, width: 100 - targetAt };
    });
    const overEnd = $derived(budget && target > 0 && cell !== null && cell.end && cell.after > riverPercent(target, scale));
    // A total near the far edge names itself on the inner side so the label stays in view.
    const inward = $derived(endShare > 68);
</script>

<div class="gutter {side} stor-tone-{tone}" aria-hidden="true">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {#if beyond}<defs><clipPath id="{uid}-over"><rect x={beyond.x} y="0" width={beyond.width} height="100" /></clipPath></defs>{/if}
        {#if targetAt !== null}<line class="target" x1={targetAt} x2={targetAt} y1="0" y2="100" />{/if}
        {#if paths}
            <path class="area" d={paths.area} />
            <path class="line" d={paths.line} />
            {#if beyond}
                <path class="over-area" d={paths.area} clip-path="url(#{uid}-over)" />
                <path class="over-line" d={paths.line} clip-path="url(#{uid}-over)" />
            {/if}
            {#if paths.usual}<path class="usual" d={paths.usual} />{/if}
        {/if}
    </svg>
    {#if cell?.end}
        <span class="dot" class:over={overEnd} style:left="{side === 'left' ? 100 - cell.after : cell.after}%"></span>
        {#if label}
            <span class="value" class:inward style:left="{side === 'left' ? 100 - cell.after : cell.after}%">{label}</span>
        {/if}
    {/if}
</div>

<style>
    .gutter { position: absolute; inset: 0; min-width: 0; }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .target { stroke: var(--stor-muted-text); stroke-opacity: .45; stroke-width: 1; stroke-dasharray: 2 3; vector-effect: non-scaling-stroke; }
    .area { fill: color-mix(in srgb, var(--tone) 15%, transparent); }
    .line { fill: none; stroke: var(--tone); stroke-width: 2; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .over-area { fill: color-mix(in srgb, var(--stor-warning) 32%, transparent); }
    .over-line { fill: none; stroke: var(--stor-warning); stroke-width: 2; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .usual { fill: none; stroke: var(--stor-muted-text); stroke-opacity: .7; stroke-width: 1.5; stroke-dasharray: 1.5 3.5; stroke-linecap: round; vector-effect: non-scaling-stroke; }
    .dot {
        position: absolute; top: 50%; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; border-radius: 50%;
        background: var(--tone); box-shadow: 0 0 0 3px var(--stor-surface);
    }
    .dot.over { background: var(--stor-warning); }
    .value {
        position: absolute; top: 50%; transform: translate(0, -50%); white-space: nowrap;
        font-size: 12px; font-weight: 650; color: var(--stor-ink); font-variant-numeric: tabular-nums;
    }
    /* Beyond the total: outward from the log. */
    .left .value { transform: translate(calc(-100% - 12px), -50%); }
    .right .value { transform: translate(12px, -50%); }
    .left .value.inward { transform: translate(12px, -50%); }
    .right .value.inward { transform: translate(calc(-100% - 12px), -50%); }
</style>
