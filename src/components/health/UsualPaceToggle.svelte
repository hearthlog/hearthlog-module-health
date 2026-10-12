<script lang="ts">
    /** The switch for the dotted usual pace: off until someone wants to compare a day with the ones before. */
    let { pressed, onToggle, label = "your usual pace" }: { pressed: boolean; onToggle: () => void; label?: string } = $props();
</script>

<button type="button" class="usual" aria-pressed={pressed} onclick={onToggle}>
    <i aria-hidden="true"></i>{label}
</button>

<style>
    .usual {
        display: inline-flex; align-items: center; gap: 8px; height: 28px; padding: 0 10px; border-radius: 999px;
        font-size: 11.5px; font-weight: 600; color: var(--stor-muted-text);
    }
    .usual i { display: block; width: 18px; border-top: 2px dotted currentColor; opacity: .8; }
    .usual[aria-pressed="true"] { color: var(--stor-ink); background: var(--stor-surface-muted); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--stor-border) 60%, transparent); }
    .usual:hover { color: var(--stor-ink); }
    .usual:focus-visible { outline: 2px solid var(--stor-focus); outline-offset: 2px; }
</style>
