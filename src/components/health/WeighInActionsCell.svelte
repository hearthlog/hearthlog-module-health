<script lang="ts">
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import IconTrash from "~icons/mdi/trash-can-outline";

    /** Removing a weigh-in; the page confirms before anything is written. */
    let { label, busy = () => false, onDelete }: {
        /** Names the weigh-in for assistive technology, for example `Sep 24`. */
        label: string;
        /** A getter, because the table builds its cells once and the removal state moves on. */
        busy?: () => boolean;
        onDelete: () => void;
    } = $props();
</script>

<div class="flex justify-end">
    <CommandOnly>
        <Button variant="ghost" size="icon" aria-label="Remove {label} entry" disabled={busy()} onclick={onDelete}>
            <IconTrash class="h-4 w-4" />
        </Button>
    </CommandOnly>
</div>
