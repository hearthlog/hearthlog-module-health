<script lang="ts">
    import QuickActivityLog from "./QuickActivityLog.svelte";
    import { ChoiceChips } from "@hearthlog/sdk/ui";
    import { shiftLocalDate } from "../../calories/logic.js";
    import IconChevronRight from "~icons/mdi/chevron-right";
    import { MediaQuery } from "svelte/reactivity";
    import { formatNumber as formatCount } from "@hearthlog/sdk/format";
    import { untrack } from "svelte";
    const drawerId = $props.id();
    const drawerFormId0 = drawerId + "-0";
    const drawerFormId1 = drawerId + "-1";

    import { DataValue } from "@hearthlog/sdk/ui";
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    import { goto } from "$app/navigation";
    import { refreshPageData as invalidate } from "@hearthlog/sdk/runtime";
    import { page } from "$app/state";
    import {
        ACTIVITY_INTENSITIES,
        ACTIVITY_KINDS,
        activityKindLabel,
        calculateActivityCalories,
        validateActivityEntryDraft,
        validateActivityGoalDraft,
        type ActivityEntryDraft,
        type ActivityGoalDraft,
        type ActivityIntensity,
        type ActivityKind,
    } from "../../activities/logic.js";
    import {
        normalizeLocalDateTime,
        toLocalDateString,
        toLocalDateTimeString,
    } from "../../calories/logic.js";
    import { queryDatabase } from "@hearthlog/sdk/data";
    import { CommandConfirmDialog } from "@hearthlog/sdk/ui";
    import { CommandDrawer } from "@hearthlog/sdk/ui";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { MobilePageAction } from "@hearthlog/sdk/ui";
    import HealthDaysShell from "./HealthDaysShell.svelte";
    import HealthDaysList from "./HealthDaysList.svelte";
    import ActivityDayBlock from "./ActivityDayBlock.svelte";
    import ActivityWeekPanel from "./ActivityWeekPanel.svelte";
    import { BucketStore } from "@hearthlog/sdk/endless";
    import { dayBlocks } from "../../health/day-blocks.js";
    import { healthDayAxis } from "../../health/day-list.js";
    import { emptyHealthWeek } from "../../health/week-data.js";
    import { WeekFollower } from "../../health/week-follow.svelte.js";
    import {
        loadActivityDay,
        loadActivitySide,
        type ActivityDayBlock as ActivityDay,
        type ActivityPageData,
    } from "../../activities/page-data.js";
    import type { EndlessAxis } from "@hearthlog/sdk/endless";
    import { tenant } from "@hearthlog/sdk/runtime";
    import { Button } from "@hearthlog/sdk/ui";
    import { DateTimePicker } from "@hearthlog/sdk/ui";
    import { Field } from "@hearthlog/sdk/ui";
    import { Input } from "@hearthlog/sdk/ui";
    import { Select } from "@hearthlog/sdk/ui";
    import { Textarea } from "@hearthlog/sdk/ui";
    import type { ActivityEntry, ActivityGoal } from "../../data/activities.js";
    import {
        type AddActivityEntryEvent,
        type AddActivityGoalEvent,
        type RemoveActivityEntryEvent,
        type UpdateActivityEntryEvent,
        type UpdateActivityGoalEvent,
    } from "@hearthlog/sdk/data";
    import { executeLocalCommand } from "@hearthlog/sdk/data";
    import { runCommandAction } from "@hearthlog/sdk/runtime";
    import { appClock } from "@hearthlog/sdk/runtime";
    import { notify } from "@hearthlog/sdk/runtime";
    import IconPlus from "~icons/mdi/plus";

    /**
     * The Activity page: an endless list of days, each with its steps, active
     * energy and diary, and beside it the week for the day in view. The
     * drawers log, edit and set goals for whichever day they were opened from.
     */
    let { data, loading = false, revision }: {
        data: ActivityPageData;
        /** True only before the first load has been applied. */
        loading?: boolean;
        /** Counts applied loads; the days on screen read again when it changes. */
        revision: number;
    } = $props();

    const boundaryToday = $derived(toLocalDateString(appClock.now()));
    const kindOptions = ACTIVITY_KINDS.map((kind) => ({
        value: kind,
        label: activityKindLabel(kind),
    }));
    const intensityOptions = ACTIVITY_INTENSITIES.map((intensity) => ({
        value: intensity,
        label: intensity.charAt(0).toUpperCase() + intensity.slice(1),
    }));

    let latestWeightKg = $derived((data.latestWeightLog?.weight ?? null) as number | null);

    // The list keeps its keys while it is open, so its axis is drawn once, from the first load.
    let drawn: EndlessAxis | undefined;
    const axis = $derived(loading ? null : (drawn ??= healthDayAxis(untrack(() => data.today), untrack(() => data.firstLogged))));
    const blocks = new BucketStore<ActivityDay>(dayBlocks(loadActivityDay), "Could not read Activity days");
    let days = $state<ReturnType<typeof HealthDaysList>>();

    // The day at the top edge; the strip, the week panel, and the Log button follow it.
    let visible = $state(untrack(() => data.selectedDate));
    let weekOpen = $state(false);
    /** How far the days sit past the day in view, so the strip follows a swipe. */
    let shift = $state(0);
    const side = new WeekFollower((repositories, date) => loadActivitySide(repositories, tenant.features, date), "Could not read the Activity week");
    let sideRevision = -1;
    $effect(() => {
        const date = visible;
        const current = revision;
        if (loading) return;
        if (current !== sideRevision) {
            sideRevision = current;
            untrack(() => side.refresh(date));
            return;
        }
        // A short pause, so a fast scroll reads the week it stops in, not every week it passes.
        const timer = setTimeout(() => side.follow(date), 120);
        return () => clearTimeout(timer);
    });
    const sideData = $derived(side.get(visible));

    let entryDrawerOpen = $state(false);
    let goalDrawerOpen = $state(false);
    let editingEntryId = $state<string | null>(null);
    let deleteEntry = $state<ActivityEntry | null>(null);
    let savingEntry = $state(false);
    let savingGoal = $state(false);
    let entryErrors = $state<Record<string, string>>({});
    // Phones ask for the activity and its number first; active calories and notes fold until asked for or wrong.
    const phone = new MediaQuery("max-width: 767px");
    // The phone form layout is the form layout at every width (docs/design-concepts/desktop-backport-2026-10-05).
    const compactForm = true;
    let entryDetailsOpen = $state(false);
    const foldOptional = $derived(compactForm && !entryDetailsOpen && !entryErrors.manualActiveCalories);

    // Phone goals: chips, Other for your own number, and your 30-day average (SQL) beside the steps.
    let stepsOther = $state(false);
    let minutesOther = $state(false);
    let averageSteps = $state(0);
    $effect(() => {
        if (!goalDrawerOpen || !compactForm) return;
        const end = goalDraft.effectiveFrom;
        const start = shiftLocalDate(end, -30);
        stepsOther = !!goalDraft.stepsTarget && ![6000, 8000, 10000].includes(Number(goalDraft.stepsTarget));
        minutesOther = !!goalDraft.exerciseMinutesTarget && ![75, 150, 300].includes(Number(goalDraft.exerciseMinutesTarget));
        void queryDatabase((repositories) => repositories.activities.getActivityTrend(start, end))
            .then((trend) => { averageSteps = trend.averageSteps; })
            .catch(() => { averageSteps = 0; });
    });
    $effect(() => { if (!entryDrawerOpen) entryDetailsOpen = false; });
    let goalErrors = $state<Record<string, string>>({});
    let handledNewEntryRequest = $state("");
    let entryDraft = $state<ActivityEntryDraft>(emptyEntryDraft("steps", untrack(() => data.selectedDate)));
    let goalDraft = $state<ActivityGoalDraft>(emptyGoalDraft(untrack(() => data.selectedDate), null));
    let caloriePreview = $derived(calculateActivityCalories(entryDraft, latestWeightKg));

    $effect(() => {
        if (loading) return;
        const requestKey = page.url.searchParams.has("newEntry")
            ? `${page.url.pathname}${page.url.search}`
            : "";
        if (!requestKey) {
            handledNewEntryRequest = "";
            return;
        }
        if (requestKey === handledNewEntryRequest) return;
        // The address names the day (the Log sheet sends it); the day in view may not have settled yet.
        if (runCommandAction(() => startCreateEntry(undefined, page.url.searchParams.get("date") || visible))) handledNewEntryRequest = requestKey;
    });

    function emptyEntryDraft(kind: ActivityKind = "steps", date: string = visible): ActivityEntryDraft {
        const loggedAt = date === boundaryToday
            ? toLocalDateTimeString()
            : `${date}T12:00`;
        return entryDraftForKind(kind, loggedAt);
    }

    function entryDraftForKind(kind: ActivityKind, loggedAt: string): ActivityEntryDraft {
        if (kind === "steps") {
            return {
                name: "Steps",
                kind,
                amount: null,
                unit: "steps",
                durationMinutes: null,
                intensity: "moderate",
                loggedAt,
                manualActiveCalories: null,
                notes: "",
            };
        }
        if (kind === "workout") {
            return {
                name: "Gym workout",
                kind,
                amount: 1,
                unit: "session",
                durationMinutes: null,
                intensity: "moderate",
                loggedAt,
                manualActiveCalories: null,
                notes: "",
            };
        }
        return {
            name: "",
            kind,
            amount: null,
            unit: "",
            durationMinutes: null,
            intensity: "moderate",
            loggedAt,
            manualActiveCalories: null,
            notes: "",
        };
    }

    function emptyGoalDraft(date: string, source: ActivityGoal | null): ActivityGoalDraft {
        return {
            effectiveFrom: date,
            stepsTarget: source?.steps_target || null,
            exerciseMinutesTarget: source?.exercise_minutes_target || null,
        };
    }

    /** Phones log steps and workouts through the short form over the page. */
    let quickActivity = $state<string | null>(null);
    function logActivity(): void {
        if (phone.current) quickActivity = visible;
        else startCreateEntry();
    }

    function startCreateEntry(kind: ActivityKind = "steps", date: string = visible) {
        editingEntryId = null;
        entryDraft = emptyEntryDraft(kind, date);
        entryErrors = {};
        entryDrawerOpen = true;
    }

    function startEditEntry(entry: ActivityEntry) {
        const kind = ACTIVITY_KINDS.includes(entry.kind as ActivityKind)
            ? entry.kind as ActivityKind
            : "custom";
        const intensity = ACTIVITY_INTENSITIES.includes(entry.intensity as ActivityIntensity)
            ? entry.intensity as ActivityIntensity
            : "moderate";
        editingEntryId = entry.id;
        entryDraft = {
            name: entry.name,
            kind,
            amount: entry.amount,
            unit: entry.unit,
            durationMinutes: entry.duration_minutes || null,
            intensity,
            loggedAt: normalizeLocalDateTime(entry.logged_at),
            manualActiveCalories: entry.calorie_source === "manual"
                ? entry.active_calories
                : null,
            notes: entry.notes ?? "",
        };
        entryErrors = {};
        entryDrawerOpen = true;
    }

    function changeActivityKind(value: string) {
        const kind = ACTIVITY_KINDS.includes(value as ActivityKind)
            ? value as ActivityKind
            : "custom";
        const next = entryDraftForKind(kind, entryDraft.loggedAt);
        entryDraft = {
            ...next,
            notes: entryDraft.notes,
            manualActiveCalories: entryDraft.manualActiveCalories,
        };
        entryErrors = {};
    }

    function closeEntryDrawer() {
        entryDrawerOpen = false;
        editingEntryId = null;
        entryErrors = {};
        if (!page.url.searchParams.has("newEntry")) return;
        const next = new URL(page.url.href);
        next.searchParams.delete("newEntry");
        void goto(`${next.pathname}${next.search}${next.hash}`, {
            replace: true,
            reset: false,
            });
    }

    /** Goals apply from a day onward, so the drawer reads what is in force there and what was saved for exactly that day. */
    async function openGoalDrawer(date: string = visible) {
        const [goal, sameDateGoal] = await queryDatabase((repositories) => Promise.all([
            repositories.activities.getLatestActivityGoal(date),
            repositories.activities.getActivityGoalForDate(date),
        ]));
        goalDraft = emptyGoalDraft(date, sameDateGoal ?? goal);
        goalErrors = {};
        goalDrawerOpen = true;
    }

    async function saveEntry(event: SubmitEvent) {
        event.preventDefault();
        if (savingEntry) return;
        entryErrors = validateActivityEntryDraft(entryDraft);
        if (Object.keys(entryErrors).length > 0) return;

        savingEntry = true;
        const calories = calculateActivityCalories(entryDraft, latestWeightKg);
        const payload = {
            name: entryDraft.name.trim(),
            kind: entryDraft.kind,
            amount: Number(entryDraft.amount),
            unit: entryDraft.unit.trim(),
            durationMinutes: Number(entryDraft.durationMinutes ?? 0),
            intensity: entryDraft.intensity,
            loggedAt: normalizeLocalDateTime(entryDraft.loggedAt),
            activeCalories: calories.activeCalories,
            calorieSource: calories.source,
            calculationMethod: calories.method,
            calculationWeightKg: calories.weightKg,
            notes: entryDraft.notes.trim(),
        };

        try {
            if (editingEntryId) {
                const updateEvent: UpdateActivityEntryEvent = {
                    id: crypto.randomUUID(),
                    type: "ACTIVITY_ENTRY_UPDATED",
                    timestamp: Date.now(),
                    payload: { id: editingEntryId, ...payload },
                };
                await executeLocalCommand(updateEvent);
                notify.success("Activity updated");
            } else {
                const addEvent: AddActivityEntryEvent = {
                    id: crypto.randomUUID(),
                    type: "ACTIVITY_ENTRY_ADDED",
                    timestamp: Date.now(),
                    payload: { id: crypto.randomUUID(), ...payload, source: "" },
                };
                await executeLocalCommand(addEvent);
                notify.success("Activity saved");
            }
            closeEntryDrawer();
            await invalidate("app:activities");
        } catch (error) {
            console.error("Failed to save activity:", error);
            notify.error("Could not save the activity");
        } finally {
            savingEntry = false;
        }
    }

    async function saveGoal(event: SubmitEvent) {
        event.preventDefault();
        if (savingGoal) return;
        goalErrors = validateActivityGoalDraft(goalDraft);
        if (Object.keys(goalErrors).length > 0) return;

        savingGoal = true;
        const sameDateGoal = await queryDatabase((repositories) =>
            repositories.activities.getActivityGoalForDate(goalDraft.effectiveFrom),
        );
        const payload = {
            effectiveFrom: goalDraft.effectiveFrom,
            stepsTarget: Number(goalDraft.stepsTarget ?? 0),
            exerciseMinutesTarget: Number(goalDraft.exerciseMinutesTarget ?? 0),
        };

        try {
            if (sameDateGoal) {
                const updateEvent: UpdateActivityGoalEvent = {
                    id: crypto.randomUUID(),
                    type: "ACTIVITY_GOAL_UPDATED",
                    timestamp: Date.now(),
                    payload: { id: sameDateGoal.id, ...payload },
                };
                await executeLocalCommand(updateEvent);
            } else {
                const addEvent: AddActivityGoalEvent = {
                    id: crypto.randomUUID(),
                    type: "ACTIVITY_GOAL_ADDED",
                    timestamp: Date.now(),
                    payload: { id: crypto.randomUUID(), ...payload },
                };
                await executeLocalCommand(addEvent);
            }
            goalDrawerOpen = false;
            notify.success("Activity goals saved");
            await invalidate("app:activities");
        } catch (error) {
            console.error("Failed to save activity goals:", error);
            notify.error("Could not save activity goals");
        } finally {
            savingGoal = false;
        }
    }

    async function removeEntry() {
        if (!deleteEntry) return;
        const entryId = deleteEntry.id;
        deleteEntry = null;
        try {
            const removeEvent: RemoveActivityEntryEvent = {
                id: crypto.randomUUID(),
                type: "ACTIVITY_ENTRY_REMOVED",
                timestamp: Date.now(),
                payload: { id: entryId },
            };
            await executeLocalCommand(removeEvent);
            notify.success("Activity removed");
            await invalidate("app:activities");
        } catch (error) {
            console.error("Failed to remove activity:", error);
            notify.error("Could not remove the activity");
        }
    }

    function formatDate(value: string, options: Intl.DateTimeFormatOptions): string {
        const [year, month, day] = value.split("-").map(Number);
        return new Intl.DateTimeFormat("en-US", options).format(
            new Date(year, month - 1, day, 12, 0, 0),
        );
    }

    function formatNumber(value: number): string {
        return formatCount(value);
    }
</script>

<svelte:head>
    <title>Activity | Health | {tenant.title}</title>
</svelte:head>

<HealthDaysShell
    active="activities"
    date={visible}
    today={boundaryToday}
    week={sideData?.week ?? emptyHealthWeek(visible)}
    targets={sideData?.targets ?? { calories: 0, steps: 0 }}
    sources={data.sources}
    onNavigate={(date) => days?.goTo(date, "smooth")}
    {shift}
    bind:weekOpen
>
    {#snippet action()}
        <CommandOnly>
            <Button onclick={() => startCreateEntry()} disabled={savingEntry}>
                <IconPlus class="h-4 w-4" />
                Log activity
            </Button>
        </CommandOnly>
    {/snippet}
    {#snippet list()}
        {#if axis}
            <HealthDaysList
                bind:this={days}
                bind:visible
                bind:shift
                {axis}
                store={blocks}
                today={boundaryToday}
                opening={data.selectedDate}
                {revision}
                blocked={entryDrawerOpen || goalDrawerOpen || deleteEntry !== null || weekOpen}
                label="Activity days"
            >
                {#snippet block(date, day)}
                    <ActivityDayBlock
                        {date}
                        inView={date === visible}
                        today={boundaryToday}
                        {day}
                        onLog={(kind, logDate) => startCreateEntry(kind, logDate)}
                        onEdit={startEditEntry}
                        onDelete={(entry) => (deleteEntry = entry)}
                        onSetGoals={(goalDate) => void openGoalDrawer(goalDate)}
                        onWeek={() => (weekOpen = true)}
                    />
                {/snippet}
            </HealthDaysList>
        {:else}
            <DataPlaceholder rows={6} label="Loading days" />
        {/if}
    {/snippet}
    {#snippet aside()}
        <ActivityWeekPanel
            week={sideData?.week ?? emptyHealthWeek(visible)}
            selected={visible}
            today={boundaryToday}
            target={sideData?.goal?.steps_target ?? 0}
            daysAtGoal={sideData?.trend.daysAtGoal ?? 0}
            averageSteps={sideData?.trend.averageSteps ?? 0}
            trackedDays={sideData?.trend.trackedDays ?? 0}
            exerciseMinutes={sideData?.trend.weekTotals.exerciseMinutes ?? 0}
            exerciseTarget={sideData?.goal?.exercise_minutes_target ?? 0}
            workouts={sideData?.trend.weekTotals.workoutSessions ?? 0}
            sessions={sideData?.sessions ?? []}
            loading={sideData === undefined}
            onEditGoals={() => void openGoalDrawer()}
        />
    {/snippet}
</HealthDaysShell>

<MobilePageAction hideWhenModalOpen isModalOpen={entryDrawerOpen || goalDrawerOpen}>
    <Button class="h-12 w-full text-[15px]" onclick={logActivity} disabled={savingEntry}>
        <IconPlus class="h-5 w-5" /> <span class="stor-action-label">{savingEntry ? "Saving…" : "Log activity"}</span>
    </Button>
</MobilePageAction>

<CommandDrawer
    show={entryDrawerOpen}
    title={editingEntryId ? "Edit activity" : "Log activity"}
    description={compactForm ? undefined : "Track behavior first. Active calories are optional context, not a daily target."}
    onClose={closeEntryDrawer}
>
    <form id={drawerFormId0} class="space-y-4" onsubmit={saveEntry}>
        <Field label="Activity type" htmlFor="activity-kind" required error={entryErrors.kind}>
            <Select id="activity-kind" value={entryDraft.kind} options={kindOptions} onValueChange={changeActivityKind} />
        </Field>

        {#if entryDraft.kind === "steps"}
            <Field label="Steps" htmlFor="activity-steps" required error={entryErrors.amount}>
                <Input id="activity-steps" type="number" min="1" step="1" bind:value={entryDraft.amount} placeholder="e.g. 7500" autofocus />
            </Field>
        {:else if entryDraft.kind === "workout"}
            <div class="grid gap-3 sm:grid-cols-2">
                <Field label="Workout name" htmlFor="activity-name" required error={entryErrors.name}>
                    <Input id="activity-name" bind:value={entryDraft.name} placeholder="e.g. Strength training" autofocus />
                </Field>
                <Field label="Duration" htmlFor="activity-duration" hint="Minutes" required error={entryErrors.durationMinutes}>
                    <Input id="activity-duration" type="number" min="1" step="1" bind:value={entryDraft.durationMinutes} placeholder="e.g. 45" />
                </Field>
            </div>
            <Field label="Intensity" htmlFor="activity-intensity" required error={entryErrors.intensity}>
                <Select id="activity-intensity" value={entryDraft.intensity} options={intensityOptions} onValueChange={(value) => entryDraft.intensity = value as ActivityIntensity} />
            </Field>
        {:else}
            <div class="grid gap-3 sm:grid-cols-2">
                <Field label="Activity name" htmlFor="activity-name" required error={entryErrors.name}>
                    <Input id="activity-name" bind:value={entryDraft.name} placeholder="e.g. Yoga or gardening" autofocus />
                </Field>
                <Field label="Amount" htmlFor="activity-amount" required error={entryErrors.amount}>
                    <Input id="activity-amount" type="number" min="0.1" step="0.1" bind:value={entryDraft.amount} placeholder="e.g. 1" />
                </Field>
                <Field label="Unit" htmlFor="activity-unit" required error={entryErrors.unit}>
                    <Input id="activity-unit" bind:value={entryDraft.unit} placeholder="e.g. class, km, laps" />
                </Field>
                <Field label="Duration" htmlFor="activity-duration" hint="Optional minutes" error={entryErrors.durationMinutes}>
                    <Input id="activity-duration" type="number" min="0" step="1" bind:value={entryDraft.durationMinutes} placeholder="Optional" />
                </Field>
            </div>
        {/if}

        {#if foldOptional}
            <!-- Phones fold active calories and notes; an error in them opens the fold. -->
            <button type="button" class="flex min-h-11 items-center gap-1 text-sm font-semibold text-[var(--stor-accent-text)]" aria-expanded="false" onclick={() => (entryDetailsOpen = true)}>
                Active calories, notes<IconChevronRight class="h-4 w-4" />
            </button>
        {:else}
        <section class="rounded-xl bg-[var(--stor-surface-muted)] p-3">
            <div class="flex items-start justify-between gap-3">
                <div>
                    <p class="text-sm font-semibold text-[var(--stor-ink)]">Active calories</p>
                    {#if caloriePreview.source === "estimated"}
                        <p class="mt-1 text-xs leading-5 text-[var(--stor-muted-text)]">About <DataValue>{formatNumber(caloriePreview.activeCalories)}</DataValue> kcal from <DataValue>{formatNumber(caloriePreview.weightKg)}</DataValue> kg body weight. This estimate is stored with the entry.</p>
                    {:else if entryDraft.manualActiveCalories !== null}
                        <p class="mt-1 text-xs leading-5 text-[var(--stor-muted-text)]">Manual value used instead of an estimate.</p>
                    {:else if entryDraft.kind === "custom"}
                        <p class="mt-1 text-xs leading-5 text-[var(--stor-muted-text)]">Custom activities need a manual value if you want to record active calories.</p>
                    {:else}
                        <p class="mt-1 text-xs leading-5 text-[var(--stor-muted-text)]">Add a current body weight or enter a manual value to record active calories.</p>
                    {/if}
                </div>
                {#if caloriePreview.source !== "none"}
                    <span class="tabular-nums text-sm font-semibold tabular-nums text-[var(--stor-ink)]"><DataValue>{formatNumber(caloriePreview.activeCalories)}</DataValue> kcal</span>
                {/if}
            </div>
        </section>

        <Field label="Active calories" htmlFor="activity-active-calories" hint="Optional. Overrides the automatic estimate." error={entryErrors.manualActiveCalories}>
            <Input id="activity-active-calories" type="number" min="0" step="1" bind:value={entryDraft.manualActiveCalories} placeholder="Optional kcal" />
        </Field>
        {/if}
        <Field label="Date and time" htmlFor="activity-logged-at" required error={entryErrors.loggedAt}>
            <DateTimePicker id="activity-logged-at" bind:value={entryDraft.loggedAt} />
        </Field>
        {#if !foldOptional}
            <Field label="Notes" htmlFor="activity-notes">
                <Textarea id="activity-notes" bind:value={entryDraft.notes} placeholder="Optional context" />
            </Field>
        {/if}
        </form>
    {#snippet footer()}
            <Button variant="secondary" onclick={closeEntryDrawer}>Cancel</Button>
            <Button type="submit" form={drawerFormId0} disabled={savingEntry}>{savingEntry ? "Saving…" : editingEntryId ? "Save changes" : "Save activity"}</Button>

    {/snippet}
</CommandDrawer>

<CommandDrawer
    show={goalDrawerOpen}
    title={compactForm ? "Goals" : "Activity goals"}
    onClose={() => goalDrawerOpen = false}
>
    <form id={drawerFormId1} class="flex flex-col gap-4" onsubmit={saveGoal}>
        {#if compactForm}
            <!-- Phones: common targets as chips, your own 30-day average under the steps, Other for any number. -->
            <div class="flex flex-col gap-1.5">
                <span class="text-sm font-medium text-[var(--stor-ink)]">Steps a day</span>
                <ChoiceChips label="Steps a day" options={[6000, 8000, 10000].map((value) => ({ value, label: formatNumber(value) }))} value={Number(goalDraft.stepsTarget) || null} onChange={(value) => { goalDraft.stepsTarget = value; stepsOther = false; }} more="Other" onMore={() => (stepsOther = true)} moreActive={stepsOther} />
                {#if stepsOther}<Input type="number" inputmode="numeric" min="0" step="1" bind:value={goalDraft.stepsTarget} placeholder="Steps" class="mt-1" />{/if}
                {#if averageSteps > 0}<p class="text-xs text-[var(--stor-muted-text)]">Your last 30 days: {formatNumber(Math.round(averageSteps))} a day</p>{/if}
                {#if goalErrors.stepsTarget}<p class="text-sm text-[var(--stor-negative)]" role="alert">{goalErrors.stepsTarget}</p>{/if}
            </div>
            <div class="flex flex-col gap-1.5">
                <span class="text-sm font-medium text-[var(--stor-ink)]">Exercise a week</span>
                <ChoiceChips label="Exercise a week" options={[75, 150, 300].map((value) => ({ value, label: `${value} min` }))} value={Number(goalDraft.exerciseMinutesTarget) || null} onChange={(value) => { goalDraft.exerciseMinutesTarget = value; minutesOther = false; }} more="Other" onMore={() => (minutesOther = true)} moreActive={minutesOther} />
                {#if minutesOther}<Input type="number" inputmode="numeric" min="0" step="1" bind:value={goalDraft.exerciseMinutesTarget} placeholder="Minutes" class="mt-1" />{/if}
                {#if goalErrors.exerciseMinutesTarget}<p class="text-sm text-[var(--stor-negative)]" role="alert">{goalErrors.exerciseMinutesTarget}</p>{/if}
            </div>
            <p class="text-xs text-[var(--stor-muted-text)]">From {formatDate(goalDraft.effectiveFrom, { day: "numeric", month: "short" })}</p>
        {/if}
        <div class="rounded-xl bg-[var(--stor-surface-muted)] p-3 {compactForm ? 'hidden' : ''}">
            <div class="text-xs font-semibold uppercase tracking-wide text-[var(--stor-muted-text)]">Effective from</div>
            <div class="mt-1 font-semibold text-[var(--stor-ink)]">{formatDate(goalDraft.effectiveFrom, { dateStyle: "long" })}</div>
            <input type="hidden" bind:value={goalDraft.effectiveFrom} />
            {#if goalErrors.effectiveFrom}<p class="mt-1 text-xs font-medium text-red-600">{goalErrors.effectiveFrom}</p>{/if}
        </div>
        {#if !compactForm}
        <Field label="Daily steps target" htmlFor="activity-goal-steps" hint="Optional" error={goalErrors.stepsTarget}>
            <Input id="activity-goal-steps" type="number" min="0" step="1" bind:value={goalDraft.stepsTarget} placeholder="e.g. 8000" autofocus />
        </Field>
        <Field label="Weekly exercise target" htmlFor="activity-goal-minutes" hint="Minutes · optional" error={goalErrors.exerciseMinutesTarget}>
            <Input id="activity-goal-minutes" type="number" min="0" step="1" bind:value={goalDraft.exerciseMinutesTarget} placeholder="e.g. 150" />
        </Field>
        <p class="rounded-xl bg-[var(--stor-surface-muted)] px-3 py-2.5 text-xs leading-5 text-[var(--stor-muted-text)]">Active calories stay a useful estimate, not a target. Nutrition’s fixed daily calorie target is kept separate.</p>
        {/if}
        </form>
    {#snippet footer()}
            <Button variant="secondary" onclick={() => goalDrawerOpen = false}>Cancel</Button>
            <Button type="submit" form={drawerFormId1} disabled={savingGoal}>{savingGoal ? "Saving…" : compactForm && (goalDraft.stepsTarget || goalDraft.exerciseMinutesTarget) ? `Set ${[goalDraft.stepsTarget ? `${formatNumber(Number(goalDraft.stepsTarget))} steps` : "", goalDraft.exerciseMinutesTarget ? `${goalDraft.exerciseMinutesTarget} min` : ""].filter(Boolean).join(" · ")}` : "Save goals"}</Button>

    {/snippet}
</CommandDrawer>

<CommandConfirmDialog
    show={Boolean(deleteEntry)}
    title="Remove activity?"
    message={deleteEntry ? `${deleteEntry.name} will be removed from this diary. This cannot be undone with this dialog.` : ""}
    onConfirm={removeEntry}
    onCancel={() => deleteEntry = null}
/>

<QuickActivityLog show={quickActivity !== null} date={quickActivity ?? visible} today={boundaryToday} onClose={() => (quickActivity = null)} />
