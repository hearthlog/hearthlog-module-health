<script lang="ts">
    import { monotonePath, type ChartPoint } from "../../health/charts.js";
    import type { HealthTone } from "../../health/day.js";

    /** A smoothed line with an area and an emphasised end. Points are scaled to the box. */
    let {
        points,
        tone,
        label,
        width = 150,
        height = 46,
        pad = 6,
    }: {
        points: readonly ChartPoint[];
        tone: HealthTone;
        /** Spoken form, for example "Weight over the last 30 days". */
        label: string;
        width?: number;
        height?: number;
        pad?: number;
    } = $props();

    const scaled = $derived.by((): ChartPoint[] => {
        if (points.length === 0) return [];
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
        const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
        const xSpan = x1 - x0 || 1;
        const ySpan = y1 - y0 || 1;
        return points.map((point) => ({
            x: pad + ((point.x - x0) / xSpan) * (width - pad * 2),
            // A flat series sits mid-height instead of hugging an edge.
            y: y1 === y0 ? height / 2 : pad + (1 - (point.y - y0) / ySpan) * (height - pad * 2),
        }));
    });
    const line = $derived(monotonePath(scaled));
    const first = $derived(scaled[0]);
    const last = $derived(scaled[scaled.length - 1]);
</script>

<svg class="spark stor-tone-{tone}" viewBox="0 0 {width} {height}" {width} {height} role="img" aria-label={label}>
    {#if scaled.length > 1 && first && last}
        <path class="area" d="{line}L{last.x} {height}L{first.x} {height}Z" />
        <path class="line" d={line} />
    {/if}
    {#if last}
        <circle class="halo" cx={last.x} cy={last.y} r="6" />
        <circle class="dot" cx={last.x} cy={last.y} r="3.2" />
    {/if}
</svg>

<style>
    .spark { display: block; max-width: 100%; height: auto; overflow: visible; }
    .area { fill: color-mix(in srgb, var(--tone) 16%, transparent); }
    .line { fill: none; stroke: var(--tone); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .halo { fill: var(--tone); opacity: .2; }
    .dot { fill: var(--tone); stroke: var(--stor-surface); stroke-width: 1.6; }
</style>
