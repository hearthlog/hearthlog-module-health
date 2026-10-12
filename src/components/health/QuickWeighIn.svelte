<script lang="ts">
    import { format, parseISO } from "date-fns";
    import { CommandDrawer } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import { Input } from "@hearthlog/sdk/ui";
    import { executeLocalCommand } from "@hearthlog/sdk/data";
    import { queryDatabase } from "@hearthlog/sdk/data";
    import type { AddWeightlogEvent } from "@hearthlog/sdk/data";
    import { refreshPageData } from "@hearthlog/sdk/runtime";
    import { notify } from "@hearthlog/sdk/runtime";
    import { formatFixed } from "@hearthlog/sdk/format";

    /**
     * A weigh-in is one number. Height comes from the last weigh-in and shows
     * as a line you can open; the first weigh-in asks for it.
     */
    let { show, date, today, onClose }: { show: boolean; date: string; today: string; onClose: () => void } = $props();

    let weight = $state<number | null>(null);
    let height = $state<number | null>(null);
    let lastWeight = $state<number | null>(null);
    let heightOpen = $state(false);
    let error = $state("");
    let saving = $state(false);
    let submissionId = crypto.randomUUID();

    // The number field takes focus once the sheet has settled, so the keypad comes up with it.
    $effect(() => {
        if (!show) return;
        let frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => document.querySelector<HTMLInputElement>("#quick-weigh-form input[inputmode]")?.focus());
        });
        return () => cancelAnimationFrame(frame);
    });

    let opened = false;
    $effect(() => {
        if (show && !opened) {
            opened = true;
            weight = null;
            error = "";
            heightOpen = false;
            submissionId = crypto.randomUUID();
            void queryDatabase((repositories) => repositories.weightLogs.getLatestWeightLog(date))
                .then((log) => {
                    height = log ? Number(log.height) || null : null;
                    lastWeight = log ? Number(log.weight) || null : null;
                    if (!height) heightOpen = true;
                })
                .catch(() => { heightOpen = true; });
        } else if (!show) {
            opened = false;
        }
    });

    async function save(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (saving) return;
        if (weight === null || !Number.isFinite(weight) || weight <= 0) { error = "Enter your weight."; return; }
        if (height === null || !Number.isFinite(height) || height <= 0) { heightOpen = true; error = "Enter your height."; return; }
        saving = true;
        error = "";
        const addEvent: AddWeightlogEvent = {
            id: crypto.randomUUID(),
            type: "WEIGHTLOG_ADDED",
            timestamp: Date.now(),
            payload: { id: crypto.randomUUID(), weight, height, date, notes: "" },
        };
        try {
            await executeLocalCommand(addEvent, { submissionId });
            onClose();
            notify.success(`${formatFixed(weight, 1)} kg saved`);
            await refreshPageData("app:weight-logs");
        } catch (failure) {
            console.error("Failed to save weigh-in:", failure);
            error = "The weigh-in could not be saved. Your value is still here.";
        } finally {
            saving = false;
        }
    }
</script>

<CommandDrawer {show} title="Weigh-in" {onClose}>
    <form id="quick-weigh-form" class="flex flex-col gap-4" onsubmit={save}>
        <p class="text-[13px] font-medium text-[var(--stor-muted-text)]">{date === today ? "Today" : format(parseISO(date), "EEE d MMM")}{lastWeight ? ` · last ${formatFixed(lastWeight, 1)} kg` : ""}</p>
        <label class="block">
            <span class="sr-only">Weight</span>
            <div class="relative">
                <Input type="number" inputmode="decimal" min="0" step="0.1" bind:value={weight} placeholder="0,0" class="!h-16 !rounded-none !border-0 !border-b-2 !border-[var(--stor-action)] !bg-transparent !px-0 !text-[36px] !font-semibold !shadow-none" />
                <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center text-base text-[var(--stor-muted-text)]">kg</span>
            </div>
        </label>
        {#if heightOpen}
            <label class="block text-sm font-medium text-[var(--stor-ink)]">
                Height
                <div class="relative mt-1.5"><Input type="number" inputmode="numeric" min="0" step="1" bind:value={height} placeholder="cm" class="pr-12" /><span class="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-[var(--stor-muted-text)]">cm</span></div>
            </label>
        {:else if height}
            <button type="button" class="self-start text-sm font-semibold text-[var(--stor-accent-text)]" onclick={() => (heightOpen = true)}>Height {formatFixed(height, 0)} cm</button>
        {/if}
        {#if error}<p class="text-sm text-[var(--stor-negative)]" role="alert">{error}</p>{/if}
    </form>
    {#snippet footer()}
        <Button type="submit" form="quick-weigh-form" class="flex-1" disabled={saving}>{saving ? "Saving…" : weight ? `Save ${formatFixed(weight, 1)} kg` : "Save weigh-in"}</Button>
    {/snippet}
</CommandDrawer>
