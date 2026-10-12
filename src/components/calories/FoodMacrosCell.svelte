<script lang="ts">
    import type { FoodItem } from "../../data/calories.js";
    import { formatFixed } from "@hearthlog/sdk/format";

    /** Grams of protein, carbs and fat per 100 g, in three columns that line up row to row. */
    let { food }: { food: FoodItem } = $props();
</script>

<span class="grams">
    <span>{formatFixed(food.protein_per_100g, 1)}</span>
    <span>{formatFixed(food.carbs_per_100g, 1)}</span>
    <span>{formatFixed(food.fat_per_100g, 1)}</span>
</span>

<style>
    .grams { display: grid; width: 10rem; margin-left: auto; grid-template-columns: repeat(3, 1fr); text-align: right; white-space: nowrap; font-size: 13px; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
</style>
