<script lang="ts">
    import { DropdownMenu } from "bits-ui";
    import type { MealSlotView } from "../../calories/logic.js";
    import IconChevronRight from "~icons/mdi/chevron-right";
    import IconContentCopy from "~icons/mdi/content-copy";
    import IconCalendarArrowLeft from "~icons/mdi/calendar-arrow-left";
    import IconCalendarArrowRight from "~icons/mdi/calendar-arrow-right";
    import IconSwapHorizontal from "~icons/mdi/swap-horizontal";
    import IconDotsVertical from "~icons/mdi/dots-vertical";
    import IconPencil from "~icons/mdi/pencil-outline";
    import IconTrash from "~icons/mdi/trash-can-outline";

    /**
     * Row overflow for the diary. Moving is the primary action — it is the one
     * users asked to reach in a single gesture — so it gets its own trigger
     * instead of hiding behind the edit drawer. On phones the row passes
     * `onEdit` and `onDelete` too, so one trigger replaces the icon row.
     */
    let {
        entryName,
        movableSlots,
        onMove,
        onMoveDay,
        onDuplicate,
        onEdit,
        onDelete,
        triggerClass = "",
    }: {
        entryName: string;
        /** Slots the entry can move to; already excludes its current slot. */
        movableSlots: MealSlotView[];
        onMove: (slotId: string) => void;
        onMoveDay: (days: number) => void;
        onDuplicate: () => void;
        onEdit?: () => void;
        onDelete?: () => void;
        triggerClass?: string;
    } = $props();

    const itemClass =
        "flex cursor-default items-center gap-2 px-3 py-2 text-sm text-[var(--stor-ink)] outline-none data-[highlighted]:bg-[var(--stor-surface-muted)] data-[disabled]:opacity-45";
    const triggerBase =
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--stor-muted-text)] transition hover:bg-[var(--stor-surface-muted)] hover:text-[var(--stor-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stor-focus)]";
</script>

<DropdownMenu.Root>
    <DropdownMenu.Trigger
        class="{triggerBase} {triggerClass}"
        aria-label={onEdit || onDelete ? `Actions for ${entryName}` : `Move or copy ${entryName}`}
    >
        {#if onEdit || onDelete}<IconDotsVertical class="h-5 w-5" />{:else}<IconSwapHorizontal class="h-4 w-4" />{/if}
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
        <DropdownMenu.Content
            side="bottom"
            align="end"
            sideOffset={4}
            loop
            class="stor-menu z-[var(--stor-layer-menu)] w-48 overflow-hidden py-1"
        >
            {#if onEdit}
                <DropdownMenu.Item class={itemClass} onSelect={onEdit}>
                    <IconPencil class="h-4 w-4 shrink-0 text-[var(--stor-muted-text)]" />
                    Edit
                </DropdownMenu.Item>
                <DropdownMenu.Separator class="my-1 h-px bg-[var(--stor-border)]" />
            {/if}
            {#if movableSlots.length > 0}
                <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger class="{itemClass} justify-between font-medium">
                        Move to
                        <IconChevronRight class="h-4 w-4 shrink-0 text-[var(--stor-muted-text)]" />
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.SubContent
                        class="stor-menu z-[var(--stor-layer-menu-sub)] w-48 overflow-hidden py-1"
                    >
                        {#each movableSlots as slot (slot.id)}
                            <DropdownMenu.Item
                                class={itemClass}
                                onSelect={() => onMove(slot.id)}
                            >
                                {slot.label}
                            </DropdownMenu.Item>
                        {/each}
                    </DropdownMenu.SubContent>
                </DropdownMenu.Sub>
            {/if}
            <DropdownMenu.Item class={itemClass} onSelect={() => onMoveDay(-1)}>
                <IconCalendarArrowLeft class="h-4 w-4 shrink-0 text-[var(--stor-muted-text)]" />
                Previous day
            </DropdownMenu.Item>
            <DropdownMenu.Item class={itemClass} onSelect={() => onMoveDay(1)}>
                <IconCalendarArrowRight class="h-4 w-4 shrink-0 text-[var(--stor-muted-text)]" />
                Next day
            </DropdownMenu.Item>
            <DropdownMenu.Separator class="my-1 h-px bg-[var(--stor-border)]" />
            <DropdownMenu.Item class={itemClass} onSelect={onDuplicate}>
                <IconContentCopy class="h-4 w-4 shrink-0 text-[var(--stor-muted-text)]" />
                Duplicate
            </DropdownMenu.Item>
            {#if onDelete}
                <DropdownMenu.Separator class="my-1 h-px bg-[var(--stor-border)]" />
                <DropdownMenu.Item class="{itemClass} text-[var(--stor-negative)]" onSelect={onDelete}>
                    <IconTrash class="h-4 w-4 shrink-0" />
                    Delete
                </DropdownMenu.Item>
            {/if}
        </DropdownMenu.Content>
    </DropdownMenu.Portal>
</DropdownMenu.Root>
