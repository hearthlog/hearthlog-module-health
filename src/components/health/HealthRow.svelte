<script lang="ts">
    import type { Component, Snippet } from "svelte";
    import type { HealthTone } from "../../health/day.js";

    /**
     * The row everything you log shares: time, a tile in the domain colour, a
     * name with at most one support line, and an amount in one right-aligned
     * column. The rail is drawn per row so it starts and ends at a tile.
     */
    let {
        time,
        datetime,
        tone,
        icon,
        name,
        detail = "",
        amount = "",
        unit = "",
        first = false,
        last = false,
        ghost = false,
        action,
        actions,
        lead,
        trail,
    }: {
        /** `HH:mm`, or empty for a row without a time. */
        time?: string;
        datetime?: string;
        tone: HealthTone;
        icon: Component;
        name: string;
        detail?: string;
        amount?: string;
        unit?: string;
        first?: boolean;
        last?: boolean;
        /** A slot still to fill: dashed tile and quieter name. */
        ghost?: boolean;
        /** Replaces the amount, for example the Log button of a ghost row. */
        action?: Snippet;
        /** Row controls after the amount; from `sm` they appear on hover and focus. */
        actions?: Snippet;
        /** Slices of the river gutters beside the log; only shown in a wide day. */
        lead?: Snippet;
        trail?: Snippet;
    } = $props();

    const Icon = $derived(icon);
</script>

<li class="row stor-tone-{tone}" class:first class:last class:ghost class:has-actions={Boolean(actions)} class:river={Boolean(lead || trail)}>
    {#if lead}<div class="lead">{@render lead()}</div>{/if}
    {#if time}<time class="time" {datetime}>{time}</time>{:else}<span></span>{/if}
    <span class="tile" aria-hidden="true"><Icon class="h-5 w-5" /></span>
    <span class="text">
        <span class="name">{name}</span>
        {#if detail}<span class="detail">{detail}</span>{/if}
    </span>
    {#if action}
        <span class="end">{@render action()}</span>
    {:else if amount}
        <span class="amount"><b>{amount}</b>{#if unit}<span class="unit">{unit}</span>{/if}</span>
    {:else if actions}
        <span></span>
    {/if}
    {#if actions}<span class="acts">{@render actions()}</span>{/if}
    {#if trail}<div class="trail">{@render trail()}</div>{/if}
</li>

<style>
    .row {
        position: relative; display: grid; grid-template-columns: 42px 36px minmax(0, 1fr) auto; align-items: center;
        column-gap: 14px; min-height: 58px; padding-block: 7px;
    }
    /* Each row draws its own stretch of the rail, so it starts and ends at a tile. */
    .row::before { content: ""; position: absolute; top: 0; bottom: 0; left: 74px; width: 2px; background: var(--stor-border); opacity: .8; }
    .row.first::before { top: 50%; }
    .row.last::before { bottom: 50%; }
    .row.first.last::before { display: none; }
    .time { font-size: 12px; text-align: right; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .tile {
        position: relative; z-index: 1; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px;
        background: color-mix(in srgb, var(--tone) 15%, var(--stor-surface)); color: var(--tone);
        box-shadow: 0 0 0 4px var(--stor-surface);
    }
    .ghost .tile { background: transparent; color: var(--stor-muted-text); box-shadow: 0 0 0 4px var(--stor-surface), inset 0 0 0 1.5px var(--stor-border); }
    .text { display: flex; min-width: 0; flex-direction: column; }
    .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; line-height: 1.3; color: var(--stor-ink); }
    .ghost .name { font-weight: 500; color: var(--stor-muted-text); }
    .detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 1.3; color: var(--stor-muted-text); }
    .amount { white-space: nowrap; text-align: right; font-size: 14px; font-variant-numeric: tabular-nums; }
    .amount b { font-weight: 650; color: var(--stor-ink); }
    .unit { margin-left: 3px; font-size: 11px; font-weight: 500; color: var(--stor-muted-text); }
    .end { justify-self: end; }
    .row.has-actions { grid-template-columns: 42px 36px minmax(0, 1fr) auto auto; }
    .acts { display: flex; justify-content: flex-end; margin-right: -6px; }
    @media (min-width: 640px) {
        .acts { opacity: 0; transition: opacity 120ms ease; }
        .row:hover .acts, .row:focus-within .acts { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) { .acts { transition: none; } }
    .lead, .trail { display: none; }
    /* In a wide day the river gutters flank the log; each row owns a full-height slice of both. */
    @container health-day (min-width: 32rem) {
        .row.river { grid-template-columns: var(--gutter-l) 42px 36px minmax(0, 1fr) auto var(--gutter-r); }
        .row.river::before { left: calc(var(--gutter-l) + 14px + 74px); }
        .lead, .trail { position: relative; display: block; align-self: stretch; margin-block: -7px; }
        .lead { grid-column: 1; }
        .trail { grid-column: 6; }
    }
</style>
