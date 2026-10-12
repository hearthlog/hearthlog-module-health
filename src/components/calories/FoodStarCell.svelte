<script lang="ts">
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import type { FoodItem } from "../../data/calories.js";
    import IconStar from "~icons/mdi/star";
    import IconStarOutline from "~icons/mdi/star-outline";

    /** The favorite switch of a food in the library table. */
    let { food, onToggle }: { food: FoodItem; onToggle: () => void } = $props();

    const favorite = $derived(Boolean(food.favorite));
</script>

<CommandOnly>
    <button
        type="button"
        class="star"
        class:on={favorite}
        aria-pressed={favorite}
        aria-label={favorite ? `Unfavorite ${food.name}` : `Favorite ${food.name}`}
        onclick={onToggle}
    >
        {#if favorite}<IconStar class="h-[18px] w-[18px]" />{:else}<IconStarOutline class="h-[18px] w-[18px]" />{/if}
    </button>
</CommandOnly>

<style>
    .star { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; color: var(--stor-muted-text); }
    .star.on { color: var(--stor-accent-text); }
    .star:hover { background: var(--stor-surface-muted); color: var(--stor-ink); }
    .star:focus-visible { outline: 2px solid var(--stor-focus); outline-offset: 1px; }
</style>
