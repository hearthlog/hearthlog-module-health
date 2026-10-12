<script lang="ts">
    import { formatNumber } from "@hearthlog/sdk/format";
    import type { HealthTone } from "../../health/day.js";

    /**
     * One bar cut into the parts of a target: meals against the day's calories,
     * sessions against the week's minutes. What is left is hatched; past the
     * target the parts keep their share and the excess is hatched amber, with
     * a notch where the target was.
     */
    let {
        parts,
        target,
        tone,
        label,
        unit = "",
        left = (rest: number) => `${formatNumber(rest)} left`,
    }: {
        parts: readonly { key: string; label: string; value: number }[];
        /** Zero draws the parts alone. */
        target: number;
        tone: HealthTone;
        /** Written after each part's value; calories read bare, minutes read `35 min`. */
        unit?: string;
        /** Spoken form of the whole bar; the visible labels are hidden from readers. */
        label: string;
        /** The hatched remainder's label; return an empty string when the caption says it already. */
        left?: (rest: number) => string;
    } = $props();

    // Parts without a value take no room, so an empty slot leaves no sliver.
    const shown = $derived(parts.filter((part) => part.value > 0));
    const sum = $derived(shown.reduce((total, part) => total + part.value, 0));
    const rest = $derived(target > sum ? target - sum : 0);
    const excess = $derived(target > 0 && sum > target ? sum - target : 0);
    // Shades step down along the bar so neighbouring parts stay apart without a legend.
    const mixes = [100, 74, 52, 36];
</script>

<div class="budget stor-tone-{tone}" role="img" aria-label={label}>
    <div class="bar">
        <div class="segs">
            {#each shown as part, index (part.key)}
                <span class="seg" style:flex="{part.value} 0 0"><i style:--mix="{mixes[Math.min(index, mixes.length - 1)]}%"></i></span>
            {/each}
            {#if rest > 0}<span class="seg" style:flex="{rest} 0 0"><i class="rest"></i></span>{/if}
        </div>
        {#if excess > 0}
            <span class="excess" style:width="{(excess / sum) * 100}%"></span>
            <span class="notch" style:left="{(target / sum) * 100}%"></span>
        {/if}
    </div>
    <div class="labels" aria-hidden="true">
        {#each shown as part (part.key)}
            <span class="lab" style:flex="{part.value} 0 0"><b title={part.label}>{part.label}</b><i>{formatNumber(part.value)}{unit ? ` ${unit}` : ""}</i></span>
        {/each}
        {#if rest > 0}
            {@const text = left(rest)}
            <span class="lab rest" style:flex="{rest} 0 0">{#if text}<b>{text}</b>{/if}</span>
        {/if}
    </div>
</div>

<style>
    .budget { display: flex; width: 100%; flex-direction: column; gap: 8px; }
    .bar { position: relative; height: 16px; border-radius: 6px; background: color-mix(in srgb, var(--tone) 12%, var(--stor-surface)); }
    .segs { display: flex; height: 100%; }
    .seg { display: block; min-width: 6px; }
    .seg > i { display: block; height: 100%; margin-right: 3px; border-radius: 6px; background: color-mix(in srgb, var(--tone) var(--mix), var(--stor-surface)); }
    .seg:last-child > i { margin-right: 0; }
    .seg > i.rest {
        background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--tone) 18%, var(--stor-surface)) 0 4px, color-mix(in srgb, var(--tone) 8%, var(--stor-surface)) 4px 8px);
    }
    .excess {
        position: absolute; top: 0; right: 0; bottom: 0; border-radius: 0 6px 6px 0;
        background: repeating-linear-gradient(135deg, var(--stor-warning) 0 2.5px, color-mix(in srgb, var(--stor-warning-soft) 82%, transparent) 2.5px 6px);
    }
    .notch { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--stor-ink); }
    .labels { display: flex; }
    .lab { display: flex; min-width: 0; flex-direction: column; gap: 1px; overflow: hidden; padding-left: 2px; font-size: 11px; line-height: 1.25; color: var(--stor-muted-text); }
    .lab b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--stor-ink); }
    .lab i { font-style: normal; font-variant-numeric: tabular-nums; }
    .lab.rest { padding-left: 14px; }
    .lab.rest b { color: var(--stor-muted-text); }
</style>
