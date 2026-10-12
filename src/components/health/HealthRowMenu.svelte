<script lang="ts">
    import { DropdownMenu } from "bits-ui";
    import IconDotsVertical from "~icons/mdi/dots-vertical";
    import IconPencil from "~icons/mdi/pencil-outline";
    import IconTrash from "~icons/mdi/trash-can-outline";

    /** Edit and delete for one row, folded into a single trigger where two icon buttons would crowd a phone. */
    let {
        name,
        onEdit,
        onDelete,
    }: {
        name: string;
        onEdit: () => void;
        onDelete: () => void;
    } = $props();

    const itemClass =
        "flex cursor-default items-center gap-2 px-3 py-2 text-sm text-[var(--stor-ink)] outline-none data-[highlighted]:bg-[var(--stor-surface-muted)]";
</script>

<DropdownMenu.Root>
    <DropdownMenu.Trigger
        class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--stor-muted-text)] transition hover:bg-[var(--stor-surface-muted)] hover:text-[var(--stor-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stor-focus)]"
        aria-label="Actions for {name}"
    >
        <IconDotsVertical class="h-5 w-5" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
        <DropdownMenu.Content
            side="bottom"
            align="end"
            sideOffset={4}
            loop
            class="stor-menu z-[var(--stor-layer-menu)] w-40 overflow-hidden py-1"
        >
            <DropdownMenu.Item class={itemClass} onSelect={onEdit}>
                <IconPencil class="h-4 w-4 shrink-0 text-[var(--stor-muted-text)]" />
                Edit
            </DropdownMenu.Item>
            <DropdownMenu.Separator class="my-1 h-px bg-[var(--stor-border)]" />
            <DropdownMenu.Item class="{itemClass} text-[var(--stor-negative)]" onSelect={onDelete}>
                <IconTrash class="h-4 w-4 shrink-0" />
                Delete
            </DropdownMenu.Item>
        </DropdownMenu.Content>
    </DropdownMenu.Portal>
</DropdownMenu.Root>
