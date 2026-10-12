<script lang="ts">
    import type { Snippet } from "svelte";

    /** The "now" marker of today's timeline: the time, a dot on the rail, and a line across. */
    let {
        time,
        first = false,
        last = false,
        lead,
        trail,
    }: {
        time: string;
        first?: boolean;
        last?: boolean;
        /** Slices of the river gutters beside the log; only shown in a wide day. */
        lead?: Snippet;
        trail?: Snippet;
    } = $props();
</script>

<li class="now" class:first class:last class:river={Boolean(lead || trail)}>
    {#if lead}<div class="lead">{@render lead()}</div>{/if}
    <span class="time"><span class="sr-only">Now, </span>{time}</span>
    <span class="dot" aria-hidden="true"></span>
    <span class="line" aria-hidden="true"></span>
    {#if trail}<div class="trail">{@render trail()}</div>{/if}
</li>

<style>
    .now { position: relative; display: grid; grid-template-columns: 42px 36px minmax(0, 1fr); align-items: center; column-gap: 14px; min-height: 30px; }
    .now::before { content: ""; position: absolute; top: 0; bottom: 0; left: 74px; width: 2px; background: var(--stor-border); opacity: .8; }
    .now.first::before { top: 50%; }
    .now.last::before { bottom: 50%; }
    .now.first.last::before { display: none; }
    .time { text-align: right; font-size: 12px; font-weight: 650; color: var(--stor-accent-text); font-variant-numeric: tabular-nums; }
    .dot {
        position: relative; z-index: 1; justify-self: center; width: 10px; height: 10px; border-radius: 50%; background: var(--stor-accent);
        box-shadow: 0 0 0 3px var(--stor-surface), 0 0 0 5px var(--stor-accent-soft);
    }
    .line { grid-column: 3 / -1; height: 1px; background: color-mix(in srgb, var(--stor-accent) 45%, transparent); }
    .lead, .trail { display: none; }
    @container health-day (min-width: 32rem) {
        .now.river { grid-template-columns: var(--gutter-l) 42px 36px minmax(0, 1fr) var(--gutter-r); }
        .now.river::before { left: calc(var(--gutter-l) + 14px + 74px); }
        .lead, .trail { position: relative; display: block; align-self: stretch; }
        .lead { grid-column: 1; }
        .trail { grid-column: 5; }
        .river .line { grid-column: 4; }
    }
</style>
