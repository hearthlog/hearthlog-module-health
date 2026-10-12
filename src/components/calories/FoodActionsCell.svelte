<script lang="ts">
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import HealthRowMenu from "../health/HealthRowMenu.svelte";
    import { Button } from "@hearthlog/sdk/ui";
    import type { FoodItem } from "../../data/calories.js";
    import IconPencil from "~icons/mdi/pencil-outline";
    import IconTrash from "~icons/mdi/trash-can-outline";

    /** Edit and delete for a food: two buttons from `lg`, one menu where two would crowd a phone. */
    let { food, onEdit, onDelete }: { food: FoodItem; onEdit: () => void; onDelete: () => void } = $props();
</script>

<div class="flex justify-end">
    <CommandOnly>
        <div class="flex lg:hidden"><HealthRowMenu name={food.name} {onEdit} {onDelete} /></div>
        <div class="hidden items-center gap-0.5 lg:flex">
            <Button variant="ghost" size="icon" aria-label={`Edit ${food.name}`} onclick={onEdit}><IconPencil class="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" aria-label={`Delete ${food.name}`} onclick={onDelete}><IconTrash class="h-4 w-4" /></Button>
        </div>
    </CommandOnly>
</div>
