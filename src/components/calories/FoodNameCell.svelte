<script lang="ts">
    import type { FoodItem } from "../../data/calories.js";
    import { formatNumber } from "@hearthlog/sdk/format";
    import IconAlert from "~icons/mdi/alert-circle-outline";

    /**
     * A food's name over its brand and serving. Phones have no column for the
     * energy, so it joins the support line there.
     */
    let { food, onSelect }: { food: FoodItem; /** Opens the food's detail; without it the name is plain text. */ onSelect?: () => void } = $props();

    const detail = $derived(
        [food.brand, `${formatNumber(food.default_serving_g, 1)} g${food.serving_label ? ` · ${food.serving_label}` : ""}`].filter(Boolean).join(" · "),
    );
    const incomplete = $derived(Boolean(food.source_missing_nutrients) && food.source_missing_nutrients !== "[]");
</script>

{#snippet text()}
    <b title={food.name}>{food.name}{#if incomplete}<span class="warn" title="Some source nutrition values are unavailable"><IconAlert class="h-3.5 w-3.5" aria-label="Some source nutrition values are unavailable" /></span>{/if}</b>
    <i>{detail}<span class="kcal">{" · "}{formatNumber(food.calories_per_100g, 1)} kcal / 100 g</span></i>
{/snippet}

{#if onSelect}
    <button type="button" class="name pick" onclick={onSelect}>{@render text()}</button>
{:else}
    <span class="name">{@render text()}</span>
{/if}

<style>
    .name { display: flex; min-width: 0; flex-direction: column; }
    .pick { width: 100%; text-align: left; }
    .pick:hover b { text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--stor-ink) 35%, transparent); text-underline-offset: 3px; }
    .name b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; color: var(--stor-ink); }
    .name i { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-style: normal; color: var(--stor-muted-text); }
    .warn { display: inline-flex; margin-left: 6px; vertical-align: -2px; color: var(--stor-warning); }
    @media (min-width: 640px) { .kcal { display: none; } }
</style>
