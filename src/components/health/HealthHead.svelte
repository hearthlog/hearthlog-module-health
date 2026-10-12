<script lang="ts">
    import type { Snippet } from "svelte";

    /**
     * A Health page's title in the serif, with its primary action beside it from
     * `lg`; phones use the floating action pill instead.
     */
    let { title, action }: { title: string; action?: Snippet } = $props();
</script>

<div class="head">
    <h2 class="stor-serif-title title">{title}</h2>
    {#if action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
    .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding: 4px 4px 0; }
    .title { font-size: 26px; font-weight: 500; line-height: 1.1; letter-spacing: -.014em; color: var(--stor-ink); }
    .action { display: none; flex-shrink: 0; }
    @media (min-width: 640px) { .title { font-size: 30px; } }
    @media (min-width: 1024px) { .action { display: block; } }
</style>
