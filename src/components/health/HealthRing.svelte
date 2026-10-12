<script lang="ts">
    import { DataValue } from "@hearthlog/sdk/ui";
    import type { HealthTone } from "../../health/day.js";
    import IconCheck from "~icons/mdi/check";

    /**
     * A goal ring in its domain colour. Past a budget the ring keeps its sweep:
     * the domain colour runs to the target, the excess is amber, and a notch
     * marks the target. A minimum that is reached earns a check, not a colour.
     */
    let {
        ratio,
        tone,
        value,
        unit,
        label,
        size = 112,
        met = false,
        empty = false,
    }: {
        /** Share of the target reached, uncapped; null without a target. */
        ratio: number | null;
        tone: HealthTone;
        value: string;
        unit: string;
        /** Spoken form, for example "1 290 of 2 100 kcal". */
        label: string;
        size?: number;
        met?: boolean;
        /** Nothing to draw yet: a dashed track instead of an arc. */
        empty?: boolean;
    } = $props();

    const radius = 45;
    const length = 2 * Math.PI * radius;
    const over = $derived(ratio !== null && ratio > 1);
    // Where the domain colour stops: the whole sweep, or the target when over budget.
    const share = $derived(ratio === null ? 0 : over ? 1 / ratio : Math.max(0, ratio));
    const notch = $derived.by(() => {
        const angle = share * 2 * Math.PI;
        const point = (r: number) => [50 + r * Math.sin(angle), 50 - r * Math.cos(angle)] as const;
        const [x1, y1] = point(radius - 7);
        const [x2, y2] = point(radius + 7);
        return { x1, y1, x2, y2 };
    });
</script>

<div class="stor-health-ring stor-tone-{tone}" style:--size="{size}px" role="img" aria-label={label}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="track" cx="50" cy="50" r={radius} />
        {#if empty || ratio === null}<circle class="dash" cx="50" cy="50" r={radius} />{/if}
        {#if over}
            <circle class="arc excess" cx="50" cy="50" r={radius} stroke-dasharray="{length * (1 - share)} {length}" stroke-dashoffset={-length * share} />
        {/if}
        {#if share > 0 && !empty}
            <circle class="arc" cx="50" cy="50" r={radius} stroke-dasharray="{length * Math.min(1, share)} {length}" />
        {/if}
        {#if over}<line class="notch" x1={notch.x1} y1={notch.y1} x2={notch.x2} y2={notch.y2} />{/if}
    </svg>
    <div class="center">
        <b class="value"><DataValue>{value}</DataValue></b>
        <span class="unit">{unit}</span>
    </div>
    {#if met}<span class="tick"><IconCheck class="h-3.5 w-3.5" aria-hidden="true" /></span>{/if}
</div>

<style>
    /* A parent may set --ring-size (for a container query); the size prop is the fallback. */
    .stor-health-ring { --s: var(--ring-size, var(--size)); position: relative; flex: none; width: var(--s); height: var(--s); }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .track {
        fill: color-mix(in srgb, var(--tone) 8%, var(--stor-surface));
        stroke: color-mix(in srgb, var(--tone) 20%, var(--stor-surface));
        stroke-width: 10;
    }
    .dash { fill: none; stroke: var(--stor-border); stroke-width: 1.5; stroke-dasharray: 1.5 5; stroke-linecap: round; }
    .arc {
        fill: none; stroke: var(--tone); stroke-width: 10; stroke-linecap: round;
        transform: rotate(-90deg); transform-origin: 50% 50%;
        transition: stroke-dasharray 500ms ease, stroke-dashoffset 500ms ease;
    }
    .arc.excess { stroke: var(--stor-warning); }
    .notch { stroke: var(--stor-surface); stroke-width: 2; stroke-linecap: round; }
    .center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; line-height: 1.1; }
    .value { display: block; font-size: calc(var(--s) * .21); font-weight: 650; letter-spacing: -.02em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .unit { display: block; margin-top: 2px; font-size: 11px; color: var(--stor-muted-text); }
    .tick {
        position: absolute; right: 2%; bottom: 2%; display: grid; place-items: center; width: 24px; height: 24px;
        border-radius: 50%; background: var(--stor-positive); color: var(--stor-surface); box-shadow: 0 0 0 3px var(--stor-surface);
    }
    @media (prefers-reduced-motion: reduce) { .arc { transition: none; } }
</style>
