<script lang="ts">
    import { format, parseISO } from "date-fns";
    import { CommandDrawer } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import { Input } from "@hearthlog/sdk/ui";
    import { Textarea } from "@hearthlog/sdk/ui";
    import { executeLocalCommand } from "@hearthlog/sdk/data";
    import { queryDatabase } from "@hearthlog/sdk/data";
    import type { AddActivityEntryEvent } from "@hearthlog/sdk/data";
    import { normalizeLocalDateTime } from "../../calories/logic.js";
    import {
        ACTIVITY_INTENSITIES,
        calculateActivityCalories,
        validateActivityEntryDraft,
        type ActivityEntryDraft,
        type ActivityIntensity,
    } from "../../activities/logic.js";
    import { refreshPageData } from "@hearthlog/sdk/runtime";
    import { notify } from "@hearthlog/sdk/runtime";
    import { formatNumber } from "@hearthlog/sdk/format";
    import IconChevronRight from "~icons/mdi/chevron-right";

    /**
     * Logging steps or a workout over the page you are on (phones): the kind,
     * the number, and the time from the day; active calories and notes fold.
     * Custom activities stay on the Activity page's full form.
     */
    let { show, date, today, onClose }: { show: boolean; date: string; today: string; onClose: () => void } = $props();

    let kind = $state<"steps" | "workout">("steps");
    let steps = $state<number | null>(null);
    let workoutName = $state("Gym workout");
    let minutes = $state<number | null>(null);
    let intensity = $state<ActivityIntensity>("moderate");
    let time = $state("");
    let manualActiveCalories = $state<number | null>(null);
    let notes = $state("");
    let detailsOpen = $state(false);
    let timeOpen = $state(false);
    let weightKg = $state<number | null>(null);
    let errors = $state<Record<string, string>>({});
    let saving = $state(false);
    let submissionId = crypto.randomUUID();

    const chip = (on: boolean) => `h-9 rounded-full px-3.5 text-sm font-medium ${on ? "bg-[var(--stor-accent-soft)] font-semibold text-[var(--stor-accent-strong)]" : "bg-[var(--stor-surface-muted)] text-[var(--stor-ink)]"}`;
    const INTENSITY_LABELS: Record<ActivityIntensity, string> = { light: "Light", moderate: "Moderate", vigorous: "Vigorous" };

    // The number field takes focus once the sheet has settled, so the keypad comes up with it.
    $effect(() => {
        if (!show) return;
        let frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => document.querySelector<HTMLInputElement>("#quick-activity-form input[inputmode]")?.focus());
        });
        return () => cancelAnimationFrame(frame);
    });

    let opened = false;
    $effect(() => {
        if (show && !opened) {
            opened = true;
            kind = "steps";
            steps = null;
            workoutName = "Gym workout";
            minutes = null;
            intensity = "moderate";
            time = date === today ? format(new Date(), "HH:mm") : "12:00";
            manualActiveCalories = null;
            notes = "";
            detailsOpen = false;
            timeOpen = false;
            errors = {};
            submissionId = crypto.randomUUID();
            void queryDatabase((repositories) => repositories.weightLogs.getLatestWeightLog(date))
                .then((log) => { weightKg = log ? Number(log.weight) : null; })
                .catch(() => { weightKg = null; });
        } else if (!show) {
            opened = false;
        }
    });

    const draft = $derived<ActivityEntryDraft>(kind === "steps"
        ? { name: "Steps", kind, amount: steps, unit: "steps", durationMinutes: null, intensity: "moderate", loggedAt: `${date}T${time || "12:00"}`, manualActiveCalories, notes }
        : { name: workoutName, kind, amount: 1, unit: "session", durationMinutes: minutes, intensity, loggedAt: `${date}T${time || "12:00"}`, manualActiveCalories, notes });
    const estimate = $derived(calculateActivityCalories(draft, weightKg));

    async function save(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (saving) return;
        errors = validateActivityEntryDraft(draft);
        if (errors.manualActiveCalories) detailsOpen = true;
        if (Object.keys(errors).length > 0) return;
        saving = true;
        const addEvent: AddActivityEntryEvent = {
            id: crypto.randomUUID(),
            type: "ACTIVITY_ENTRY_ADDED",
            timestamp: Date.now(),
            payload: {
                id: crypto.randomUUID(),
                name: draft.name.trim(),
                kind: draft.kind,
                amount: Number(draft.amount),
                unit: draft.unit,
                durationMinutes: Number(draft.durationMinutes ?? 0),
                intensity: draft.intensity,
                loggedAt: normalizeLocalDateTime(draft.loggedAt),
                activeCalories: estimate.activeCalories,
                calorieSource: estimate.source,
                calculationMethod: estimate.method,
                calculationWeightKg: estimate.weightKg,
                notes: draft.notes.trim(),
                source: "",
            },
        };
        try {
            await executeLocalCommand(addEvent, { submissionId });
            onClose();
            notify.success(kind === "steps" ? `${formatNumber(Number(steps))} steps logged` : `${workoutName.trim()} logged`);
            await refreshPageData("app:activities");
        } catch (error) {
            console.error("Failed to log activity:", error);
            errors = { form: "The activity could not be saved. Your values are still here." };
        } finally {
            saving = false;
        }
    }

    const whenLabel = $derived(`${date === today ? "Today" : format(parseISO(date), "EEE d MMM")} at ${time}`);
</script>

<CommandDrawer {show} title="Log activity" {onClose}>
    <form id="quick-activity-form" class="flex flex-col gap-4" onsubmit={save}>
        <button type="button" class="self-start text-[13px] font-medium text-[var(--stor-muted-text)] underline decoration-dotted underline-offset-4" aria-expanded={timeOpen} onclick={() => (timeOpen = !timeOpen)}>{whenLabel}</button>
        {#if timeOpen}
            <label class="block text-sm font-medium text-[var(--stor-ink)]">Time<Input type="time" bind:value={time} class="mt-1.5" /></label>
        {/if}

        <div class="stor-segmented-control grid grid-cols-2" role="group" aria-label="Activity type">
            <button type="button" class="stor-segmented-option min-h-11" aria-pressed={kind === "steps"} onclick={() => (kind = "steps")}>Steps</button>
            <button type="button" class="stor-segmented-option min-h-11" aria-pressed={kind === "workout"} onclick={() => (kind = "workout")}>Workout</button>
        </div>

        {#if kind === "steps"}
            <label class="block">
                <span class="sr-only">Steps</span>
                <div class="relative">
                    <Input type="number" inputmode="numeric" min="0" step="1" bind:value={steps} placeholder="0" class="!h-16 !rounded-none !border-0 !border-b-2 !border-[var(--stor-action)] !bg-transparent !px-0 !text-[36px] !font-semibold !shadow-none" aria-invalid={!!errors.amount} />
                    <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center text-base text-[var(--stor-muted-text)]">steps</span>
                </div>
            </label>
            {#if errors.amount}<p class="-mt-2 text-sm text-[var(--stor-negative)]" role="alert">{errors.amount}</p>{/if}
        {:else}
            <div class="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                <label class="block"><span class="sr-only">Workout</span><Input bind:value={workoutName} placeholder="Workout" aria-invalid={!!errors.name} /></label>
                <label class="block"><span class="sr-only">Minutes</span>
                    <div class="relative"><Input type="number" inputmode="numeric" min="0" step="1" bind:value={minutes} placeholder="min" class="pr-10" aria-invalid={!!errors.durationMinutes} />{#if minutes !== null}<span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-[var(--stor-muted-text)]">min</span>{/if}</div>
                </label>
            </div>
            {#if errors.name || errors.durationMinutes}<p class="-mt-2 text-sm text-[var(--stor-negative)]" role="alert">{errors.name ?? errors.durationMinutes}</p>{/if}
            <div class="flex flex-wrap gap-2" role="group" aria-label="Intensity">
                {#each ACTIVITY_INTENSITIES as level (level)}
                    <button type="button" class={chip(intensity === level)} aria-pressed={intensity === level} onclick={() => (intensity = level)}>{INTENSITY_LABELS[level]}</button>
                {/each}
            </div>
        {/if}

        {#if detailsOpen}
            <label class="block text-sm font-medium text-[var(--stor-ink)]">
                Active calories
                <Input type="number" inputmode="numeric" min="0" step="1" bind:value={manualActiveCalories} placeholder={estimate.source === "estimated" ? `About ${formatNumber(estimate.activeCalories)} kcal` : "kcal"} class="mt-1.5" />
            </label>
            {#if errors.manualActiveCalories}<p class="-mt-2 text-sm text-[var(--stor-negative)]" role="alert">{errors.manualActiveCalories}</p>{/if}
            <Textarea bind:value={notes} placeholder="Notes" rows={2} />
        {:else}
            <button type="button" class="flex items-center gap-1 self-start text-sm font-semibold text-[var(--stor-accent-text)]" aria-expanded="false" onclick={() => (detailsOpen = true)}>
                {estimate.source === "estimated" ? `About ${formatNumber(estimate.activeCalories)} kcal · notes` : "Active calories, notes"}<IconChevronRight class="h-4 w-4" />
            </button>
        {/if}
        {#if errors.form}<p class="text-sm text-[var(--stor-negative)]" role="alert">{errors.form}</p>{/if}
    </form>
    {#snippet footer()}
        <Button type="submit" form="quick-activity-form" class="flex-1" disabled={saving}>{saving ? "Saving…" : kind === "steps" ? "Log steps" : "Log workout"}</Button>
    {/snippet}
</CommandDrawer>
