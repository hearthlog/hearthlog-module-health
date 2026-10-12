<script lang="ts">
    import { CommandDrawer } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import { Input } from "@hearthlog/sdk/ui";
    import type { MealSlotView, StoredMealSlot } from "../../calories/logic.js";
    import {
        commitMealSlotEvents,
        mealSlotAddEvent,
        mealSlotBootstrapEvents,
        mealSlotUpdateEvent,
    } from "../../calories/slot-commands.js";
    import type { AppEvent } from "@hearthlog/sdk/data";
    import { notify } from "@hearthlog/sdk/runtime";
    import IconArrowDown from "~icons/mdi/arrow-down";
    import IconArrowUp from "~icons/mdi/arrow-up";
    import IconEyeOffOutline from "~icons/mdi/eye-off-outline";
    import IconEyeOutline from "~icons/mdi/eye-outline";
    import IconPencilOutline from "~icons/mdi/pencil-outline";
    import IconDrag from "~icons/mdi/drag-horizontal-variant";
    import IconPlus from "~icons/mdi/plus";
    import { Switch } from "@hearthlog/sdk/ui";

    /**
     * The diary keeps the four canonical meals implicit until the first
     * customization. Every mutation then materializes all of them in the same
     * batch, which is what makes hiding a built-in meal stick instead of the
     * default silently reappearing.
     */
    let {
        show = false,
        slots,
        storedSlots,
        onClose,
    }: {
        show?: boolean;
        slots: MealSlotView[];
        storedSlots: StoredMealSlot[];
        onClose: () => void;
    } = $props();

    let newLabel = $state("");
    let editingId = $state<string | null>(null);
    let editingLabel = $state("");
    let saving = $state(false);

    const visibleCount = $derived(slots.filter((slot) => !slot.archived).length);

    function bootstrapEvents() {
        return mealSlotBootstrapEvents(storedSlots);
    }

    async function run(events: AppEvent[], message: string, undo?: () => AppEvent[]): Promise<void> {
        if (events.length === 0 || saving) return;
        saving = true;
        try {
            await commitMealSlotEvents(events);
            // Every change saves at once; Undo writes the change back.
            notify.success(message, undo ? { label: "Undo", run: () => void commitMealSlotEvents(undo()).catch(() => notify.error("Could not undo")) } : undefined);
        } catch (error) {
            console.error("Failed to update meal slots:", error);
            notify.error("Could not update meal slots");
        } finally {
            saving = false;
        }
    }

    async function addSlot(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        const label = newLabel.trim();
        if (!label) return;
        const sortOrder = slots.reduce(
            (maximum, slot) => Math.max(maximum, slot.sortOrder),
            -1,
        ) + 1;
        newLabel = "";
        const added = mealSlotAddEvent(label, sortOrder);
        const addedId = (added.payload as { id: string }).id;
        await run(
            [...bootstrapEvents(), added],
            `“${label}” added`,
            () => [mealSlotUpdateEvent(addedId, { archived: true })],
        );
    }

    function startRename(slot: MealSlotView): void {
        editingId = slot.id;
        editingLabel = slot.label;
    }

    function cancelRename(): void {
        editingId = null;
        editingLabel = "";
    }

    async function commitRename(): Promise<void> {
        const slot = slots.find((candidate) => candidate.id === editingId);
        const label = editingLabel.trim();
        cancelRename();
        if (!slot || !label || label === slot.label) return;
        await run(
            [...bootstrapEvents(), mealSlotUpdateEvent(slot.id, { label })],
            `Renamed to “${label}”`,
            () => [mealSlotUpdateEvent(slot.id, { label: slot.label })],
        );
    }

    async function toggleArchived(slot: MealSlotView): Promise<void> {
        await run(
            [...bootstrapEvents(), mealSlotUpdateEvent(slot.id, { archived: !slot.archived })],
            slot.archived ? `“${slot.label}” shown` : `“${slot.label}” hidden`,
            () => [mealSlotUpdateEvent(slot.id, { archived: slot.archived })],
        );
    }

    /** Moves a slot one position and normalizes every sort order to its rank. */
    async function moveSlot(index: number, delta: number): Promise<void> {
        const targetIndex = index + delta;
        if (delta === 0) return;
        if (targetIndex < 0 || targetIndex >= slots.length) return;
        const reordered = [...slots];
        const [moved] = reordered.splice(index, 1);
        reordered.splice(targetIndex, 0, moved);
        const events = reordered.flatMap((slot, position) =>
            slot.sortOrder === position ? [] : [mealSlotUpdateEvent(slot.id, { sortOrder: position })]);
        const before = slots.map((slot) => ({ id: slot.id, sortOrder: slot.sortOrder }));
        await run([...bootstrapEvents(), ...events], `“${moved.label}” moved`, () => before.map((slot) => mealSlotUpdateEvent(slot.id, { sortOrder: slot.sortOrder })));
    }

    // ---------------------------------------------------------------- phones
    // Drag the handle to reorder, edit the name in place, a switch to show; each change saves at once.
    // The phone form layout is the form layout at every width (docs/design-concepts/desktop-backport-2026-10-05).
    const phone = { current: true };
    let dragIndex = $state<number | null>(null);
    let dragOffset = $state(0);
    let dragStartY = 0;
    let rowHeight = 56;
    let names = $state<Record<string, string>>({});
    $effect(() => {
        if (!show) return;
        names = Object.fromEntries(slots.map((slot) => [slot.id, slot.label]));
    });

    function dragStart(event: PointerEvent, index: number): void {
        if (saving) return;
        dragIndex = index;
        dragStartY = event.clientY;
        dragOffset = 0;
        const row = (event.currentTarget as HTMLElement).closest("li");
        rowHeight = row?.getBoundingClientRect().height || 56;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    function dragMove(event: PointerEvent): void {
        if (dragIndex === null) return;
        dragOffset = event.clientY - dragStartY;
    }
    function dragEnd(): void {
        if (dragIndex === null) return;
        const from = dragIndex;
        const to = Math.max(0, Math.min(slots.length - 1, from + Math.round(dragOffset / rowHeight)));
        dragIndex = null;
        dragOffset = 0;
        void moveSlot(from, to - from);
    }
    async function renameInPlace(slot: MealSlotView): Promise<void> {
        const label = (names[slot.id] ?? "").trim();
        if (!label) { names[slot.id] = slot.label; return; }
        if (label === slot.label) return;
        editingId = slot.id;
        editingLabel = label;
        await commitRename();
    }
</script>

<CommandDrawer
    {show}
    title={phone.current ? "Meals" : "Meal slots"}
    onClose={onClose}
>
    {#if phone.current}
        <ul class="flex flex-col" aria-label="Meals">
            {#each slots as slot, index (slot.id)}
                <li class="relative flex min-h-14 items-center gap-2 border-b border-[color-mix(in_srgb,var(--stor-border)_62%,transparent)] bg-[var(--stor-surface-sheet,var(--stor-surface))] {dragIndex === index ? 'z-10 rounded-xl shadow-[var(--stor-elevation-3)]' : ''}"
                    style:transform={dragIndex === index ? `translateY(${dragOffset}px)` : undefined}>
                    <button type="button" class="grid h-11 w-9 shrink-0 touch-none place-items-center text-[var(--stor-muted-text)]" aria-label={`Drag ${slot.label} to reorder`}
                        onpointerdown={(event) => dragStart(event, index)} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={dragEnd}
                        onkeydown={(event) => { if (event.key === "ArrowUp") { event.preventDefault(); void moveSlot(index, -1); } else if (event.key === "ArrowDown") { event.preventDefault(); void moveSlot(index, 1); } }}>
                        <IconDrag class="h-5 w-5" />
                    </button>
                    <input class="h-11 min-w-0 flex-1 bg-transparent text-[15.5px] font-medium outline-none {slot.archived ? 'text-[var(--stor-muted-text)]' : 'text-[var(--stor-ink)]'}" aria-label={`Name of ${slot.label}`}
                        bind:value={names[slot.id]} onblur={() => void renameInPlace(slot)} onkeydown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
                    <Switch class="w-auto shrink-0" label="" ariaLabel={`Show ${slot.label}`} checked={!slot.archived} disabled={saving || (!slot.archived && visibleCount <= 1)} onCheckedChange={() => void toggleArchived(slot)} />
                </li>
            {/each}
        </ul>
        <form class="flex items-center gap-2 pt-2" onsubmit={addSlot}>
            <span class="w-9 shrink-0"></span>
            <input class="h-11 min-w-0 flex-1 bg-transparent text-[15.5px] outline-none placeholder:text-[var(--stor-muted-text)]" placeholder="Add a meal" aria-label="New meal" bind:value={newLabel} />
            <button type="submit" class="grid h-11 w-11 place-items-center rounded-xl text-[var(--stor-accent-text)] disabled:opacity-40" aria-label="Add meal" disabled={!newLabel.trim() || saving}><IconPlus class="h-6 w-6" /></button>
        </form>
        <p class="mt-2 text-xs text-[var(--stor-muted-text)]">Drag to reorder · tap a name to rename · the switch shows or hides it</p>
    {:else}
    <ul class="space-y-2">
        {#each slots as slot, index (slot.id)}
            <li
                class="flex items-center gap-2 rounded-xl bg-[var(--stor-surface-muted)] px-2 py-2 {slot.archived
                    ? 'opacity-70'
                    : ''}"
            >
                <div class="flex shrink-0 flex-col">
                    <Button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7"
                        aria-label={`Move ${slot.label} up`}
                        disabled={index === 0 || saving}
                        onclick={() => void moveSlot(index, -1)}
                    >
                        <IconArrowUp class="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7"
                        aria-label={`Move ${slot.label} down`}
                        disabled={index === slots.length - 1 || saving}
                        onclick={() => void moveSlot(index, 1)}
                    >
                        <IconArrowDown class="h-4 w-4" />
                    </Button>
                </div>

                {#if editingId === slot.id}
                    <Input
                        class="min-w-0 flex-1"
                        aria-label={`New name for ${slot.label}`}
                        bind:value={editingLabel}
                        onkeydown={(event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                void commitRename();
                            } else if (event.key === "Escape") {
                                cancelRename();
                            }
                        }}
                    />
                    <Button size="sm" disabled={saving} onclick={() => void commitRename()}>Save</Button>
                    <Button variant="ghost" size="sm" onclick={cancelRename}>Cancel</Button>
                {:else}
                    <div class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-semibold text-stone-900">{slot.label}</span>
                        {#if slot.archived}
                            <span class="text-xs text-stone-500">Hidden from the add flow</span>
                        {/if}
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Rename ${slot.label}`}
                        disabled={saving}
                        onclick={() => startRename(slot)}
                    >
                        <IconPencilOutline class="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${slot.archived ? "Show" : "Hide"} ${slot.label}`}
                        disabled={saving || (!slot.archived && visibleCount <= 1)}
                        title={!slot.archived && visibleCount <= 1
                            ? "Keep at least one visible meal"
                            : undefined}
                        onclick={() => void toggleArchived(slot)}
                    >
                        {#if slot.archived}
                            <IconEyeOutline class="h-4 w-4" />
                        {:else}
                            <IconEyeOffOutline class="h-4 w-4" />
                        {/if}
                    </Button>
                {/if}
            </li>
        {/each}
    </ul>

    <form class="mt-4 flex items-center gap-2 border-t border-[var(--stor-border)] pt-4" onsubmit={addSlot}>
        <Input
            id="meal-slot-new-label"
            class="min-w-0 flex-1"
            placeholder="e.g. Pre-workout"
            aria-label="New meal slot"
            bind:value={newLabel}
        />
        <Button type="submit" variant="secondary" disabled={!newLabel.trim() || saving}>Add meal</Button>
    </form>
    {/if}
</CommandDrawer>
