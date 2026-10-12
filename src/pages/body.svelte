<script lang="ts">
    import QuickWeighIn from "../components/health/QuickWeighIn.svelte";
    /** The phone pill opens the one-number weigh-in over the page. */
    let quickWeighOpen = $state(false);
    import { PhoneGlance } from "@hearthlog/sdk/ui";
    const drawerId = $props.id();
    const drawerFormId0 = drawerId + "-0";

    import { untrack } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { parseSelectedDate, toLocalDateString } from "../calories/logic.js";
    import { runCommandAction as runWorkspaceCommandAction } from "@hearthlog/sdk/runtime";
    import { DataValue } from "@hearthlog/sdk/ui";
    import { providePageResource } from "@hearthlog/sdk/runtime";
    import { PageDataStatus } from "@hearthlog/sdk/ui";
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    import { EmptyState } from "@hearthlog/sdk/ui";
    import { bmiStore } from "../store/bmi-store.svelte.js";
    import {
        type AddWeightlogEvent,
        type RemoveWeightlogEvent,
    } from "@hearthlog/sdk/data";
    import { executeLocalCommand } from "@hearthlog/sdk/data";
    import { refreshPageData as invalidate } from "@hearthlog/sdk/runtime";
    import { appClock } from "@hearthlog/sdk/runtime";
    import HealthPageHeader from "../components/health/HealthPageHeader.svelte";
    import HealthHead from "../components/health/HealthHead.svelte";
    import WeightChart from "../components/health/WeightChart.svelte";
    import WeighInsTable from "../components/health/WeighInsTable.svelte";
    import { DatePicker } from "@hearthlog/sdk/ui";
    import { notify } from "@hearthlog/sdk/runtime";
    import { CommandConfirmDialog } from "@hearthlog/sdk/ui";
    import { CommandDrawer } from "@hearthlog/sdk/ui";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import { MobilePageAction } from "@hearthlog/sdk/ui";
    import IconPlus from "~icons/mdi/plus";
    import { formatFixed } from "@hearthlog/sdk/format";
    import { tenant } from "@hearthlog/sdk/runtime";
    import { bmiSummary, weightChangeLabel } from "../health/day.js";
    import {
        WEIGHT_RANGES,
        weighedLabel,
        weightPaceLabel,
        type WeightPageData,
        type WeightRange,
    } from "../health/weight.js";
    import type { WeighInRow } from "../data/weight-logs.js";

    let { data: routeData } = $props();
    const resource = $derived(routeData.pageResource);
    const data = $derived(resource.data as WeightPageData);
    providePageResource(() => resource);

    const historyDateFormatter = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });

    let newWeightDate = $state("");
    let newWeightValue = $state<number | null>(null);
    let newHeightValue = $state<number | null>(null);

    let savingEntry = $state(false);
    let removingEntryId = $state<string | null>(null);
    let logDrawerOpen = $state(false);
    let deleteEntry = $state<WeighInRow | null>(null);

    const today = $derived(toLocalDateString(appClock.now()));
    const latest = $derived(data.latest);
    // Phones open on 30 days, so a month of weigh-ins fills the narrow chart.
    let range = $state<WeightRange>(typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? 30 : 90);
    const trend = $derived(data.trends[range]);
    const rangePhrase = $derived(WEIGHT_RANGES.find((option) => option.value === range)?.phrase ?? "");
    const latestDate = $derived(latest ? String(latest.date).slice(0, 10) : "");
    const chips = $derived([
        weightChangeLabel(data.delta),
        weightPaceLabel(data.pace),
        latest ? bmiSummary(latest.weight, latest.height) : "",
    ].filter(Boolean));
    const chartLabel = $derived(
        trend.mean.length > 1
            ? `Weight over ${rangePhrase}, from ${formatFixed(trend.mean[0].mean, 1)} to ${formatFixed(trend.mean[trend.mean.length - 1].mean, 1)} kilograms`
            : `Weight over ${rangePhrase}`,
    );

    let canSaveWeight = $derived(
        newWeightValue !== null &&
            Number.isFinite(newWeightValue) &&
            newWeightValue > 0 &&
            newHeightValue !== null &&
            Number.isFinite(newHeightValue) &&
            newHeightValue > 0 &&
            !savingEntry,
    );

    $effect(() => {
        if (resource.loading) return;
        const row = data.latest;
        bmiStore.setDatabaseView(
            row ? [{ id: row.id, weight: row.weight, height: row.height, date: row.date, notes: row.notes }] : [],
        );
        if (!untrack(() => newWeightDate)) newWeightDate = data.defaultDate;

        return () => {
            bmiStore.clearDatabaseView();
        };
    });

    function formatHistoryDate(date: string): string {
        const parsed = new Date(`${date}T12:00:00`);
        return Number.isNaN(parsed.getTime())
            ? date
            : historyDateFormatter.format(parsed);
    }

    function prefillLogWeight() {
        newWeightValue = bmiStore.weight;
        newHeightValue = bmiStore.height;
    }

    function openLogDrawer(date?: string) {
        prefillLogWeight();
        // A saved entry must not seed the next one's date: start at today unless a day was asked for.
        newWeightDate = date ?? data.defaultDate;
        logDrawerOpen = true;
    }

    /** Closing the drawer also drops the one-shot `?newWeighIn=1&date=…` that opened it. */
    function closeLogDrawer() {
        logDrawerOpen = false;
        if (!page.url.searchParams.has("newWeighIn")) return;
        const next = new URL(page.url.href);
        next.searchParams.delete("newWeighIn");
        next.searchParams.delete("date");
        void goto(`${next.pathname}${next.search}${next.hash}`, { replace: true, reset: false });
    }

    let handledNewWeighIn = $state("");
    $effect(() => {
        if (resource.loading) return;
        const requestKey = page.url.searchParams.has("newWeighIn") ? `${page.url.pathname}${page.url.search}` : "";
        if (!requestKey) {
            handledNewWeighIn = "";
            return;
        }
        if (requestKey === handledNewWeighIn) return;
        const requestedDate = page.url.searchParams.get("date");
        const date = requestedDate ? parseSelectedDate(requestedDate, data.defaultDate) : undefined;
        if (runWorkspaceCommandAction(() => openLogDrawer(date))) handledNewWeighIn = requestKey;
    });

    async function logWeight() {
        const weight = newWeightValue;
        const height = newHeightValue;
        if (
            weight === null ||
            !Number.isFinite(weight) ||
            weight <= 0 ||
            height === null ||
            !Number.isFinite(height) ||
            height <= 0 ||
            savingEntry
        ) return;

        savingEntry = true;

        const entryId = crypto.randomUUID();
        const event: AddWeightlogEvent = {
            id: crypto.randomUUID(),
            type: "WEIGHTLOG_ADDED",
            timestamp: Date.now(),
            payload: {
                id: entryId,
                weight,
                height,
                date: newWeightDate,
                notes: "",
            },
        };

        try {
            await executeLocalCommand(event);

            bmiStore.setHeight(height);

            await invalidate("app:weight-logs");

            newWeightValue = null;
            newHeightValue = null;
            closeLogDrawer();
            notify.success("Weight entry saved");
        } catch (error) {
            console.error("Failed to log weight:", error);
            notify.error("Could not save the weight entry");
        } finally {
            savingEntry = false;
        }
    }

    async function removeEntry(id: string) {
        if (removingEntryId) return;
        removingEntryId = id;
        const event: RemoveWeightlogEvent = {
            id: crypto.randomUUID(),
            type: "WEIGHTLOG_REMOVED",
            timestamp: Date.now(),
            payload: { id },
        };

        try {
            await executeLocalCommand(event);
            await invalidate("app:weight-logs");
            notify.success("Weight entry removed");
        } catch (error) {
            console.error("Failed to remove weight entry:", error);
            notify.error("Could not remove the weight entry");
        } finally {
            removingEntryId = null;
        }
    }

    async function confirmRemoveEntry() {
        if (!deleteEntry) return;
        const id = deleteEntry.id;
        deleteEntry = null;
        await removeEntry(id);
    }
</script>

<svelte:head>
    <title>Body | Health | {tenant.title}</title>
</svelte:head>

<PageDataStatus {resource} />

<div class="stor-refined w-full overflow-x-hidden">
    <HealthPageHeader active="body" />

    <div class="stor-page p-2.5 sm:p-3">
        <!-- Phones: the top bar names the page and carries the latest weight. -->
        <div class="max-md:hidden"><HealthHead title="Body">
            {#snippet action()}
                <CommandOnly>
                    <Button onclick={() => openLogDrawer()} aria-label="Add weigh-in" disabled={savingEntry}>
                        <IconPlus class="h-4 w-4" />
                        Add weigh-in
                    </Button>
                </CommandOnly>
            {/snippet}
        </HealthHead></div>

        {#if !resource.loading && !latest}
            <EmptyState title="No weight history yet" description="Log your first weight to start a private trend.">
                <CommandOnly>
                    <Button size="sm" onclick={() => openLogDrawer()}>Log first weight</Button>
                </CommandOnly>
            </EmptyState>
        {:else}
            <div class="layout">
                <section class="stor-panel hero stor-tone-body" aria-label="Weight">
                    <p class="lab md:hidden" style:grid-area="lab"><i></i>Weight</p>
                    <div class="top max-md:hidden">
                        <p class="lab"><i></i>Weight</p>
                        <p class="big">
                            <DataValue>{latest ? formatFixed(latest.weight, 1) : ""}</DataValue>
                            <small><DataValue>{latest ? `kg · ${weighedLabel(latestDate, today)}` : ""}</DataValue></small>
                        </p>
                    </div>
                    <!-- Phones pick the range from a small chip on the chart. -->
                    <label class="range-chip md:hidden">
                        <span class="sr-only">Weight range</span>
                        <select bind:value={range} class="range-select">
                            {#each WEIGHT_RANGES as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
                        </select>
                    </label>
                    <div class="stor-segmented-control range inline-grid grid-cols-4 max-md:!hidden" aria-label="Weight range">
                        {#each WEIGHT_RANGES as option (option.value)}
                            <button type="button" aria-pressed={range === option.value} onclick={() => range = option.value} class="stor-segmented-option">{option.label}</button>
                        {/each}
                    </div>
                    {#if !resource.loading && chips.length > 0}
                        <div class="chips max-md:!hidden">
                            {#each chips as chip (chip)}<span class="chip">{chip}</span>{/each}
                        </div>
                    {/if}
                    <div class="plot">
                        {#if resource.loading}
                            <DataPlaceholder rows={5} />
                        {:else}
                            <WeightChart
                                weighIns={trend.weighIns}
                                mean={trend.mean}
                                from={trend.from}
                                to={latestDate}
                                band={bmiStore.idealWeightRange}
                                label={chartLabel}
                            />
                        {/if}
                    </div>
                </section>

                <section class="stor-panel measure max-md:hidden" aria-labelledby="body-measurements-title">
                    <header class="stor-panel-header">
                        <h2 id="body-measurements-title" class="font-semibold text-[var(--stor-ink)]">Measurements</h2>
                        <CommandOnly>
                            <Button class="-mr-2" variant="ghost" size="sm" onclick={() => openLogDrawer()}>Edit</Button>
                        </CommandOnly>
                    </header>
                    <div class="px-[var(--stor-panel-padding)] pb-[var(--stor-panel-padding)]">
                        <!-- Stable read-only hooks keep saved measurements observable to tests and assistive tooling. -->
                        <input id="height" type="hidden" value={bmiStore.height ?? ""} />
                        <input id="weight" type="hidden" value={bmiStore.weight ?? ""} />

                        {@render bodyFacts()}
                    </div>
                </section>

                <section class="stor-panel weighins min-w-0" aria-labelledby="body-weighins-title">
                    <header class="stor-panel-header">
                        <h2 id="body-weighins-title" class="font-semibold text-[var(--stor-ink)]">Weigh-ins</h2>
                        {#if !resource.loading && data.total > 0}<span class="text-xs text-[var(--stor-muted-text)]">{data.total} {data.total === 1 ? "entry" : "entries"}</span>{/if}
                    </header>
                    {#if resource.loading}
                        <div class="px-[var(--stor-panel-padding)] pb-[var(--stor-panel-padding)]"><DataPlaceholder rows={5} compact /></div>
                    {:else}
                        <div class="px-[calc(var(--stor-panel-padding)-0.75rem)]">
                            <WeighInsTable
                                total={data.total}
                                {today}
                                revision={resource.revision}
                                busyId={removingEntryId}
                                onDelete={(row) => (deleteEntry = row)}
                            />
                        </div>
                    {/if}
                </section>
            </div>
        {/if}
    </div>
</div>

{#snippet bodyFacts()}
                        <dl class="facts">
                            <div><dt>Height</dt><dd><DataValue>{bmiStore.height !== null ? formatFixed(bmiStore.height, 0) : "—"}</DataValue>{#if bmiStore.height !== null}<small>&nbsp;cm</small>{/if}</dd></div>
                            <div><dt>BMI</dt><dd><DataValue>{bmiStore.bmi !== null ? formatFixed(bmiStore.bmi, 1) : "—"}</DataValue></dd></div>
                            <div>
                                <dt>Reference range</dt>
                                <dd>
                                    <DataValue>{bmiStore.idealWeightRange ? `${formatFixed(bmiStore.idealWeightRange.min, 1)}–${formatFixed(bmiStore.idealWeightRange.max, 1)}` : "—"}</DataValue>{#if bmiStore.idealWeightRange}<small>&nbsp;kg</small>{/if}
                                </dd>
                            </div>
                        </dl>
                        <p class="note">BMI is a screening estimate, not a diagnosis.</p>
{/snippet}

{#if latest}
    <PhoneGlance label="Weight" value={formatFixed(latest.weight, 1)} unit="kg" title="Body">
        <div class="stor-tone-body flex flex-col gap-3">
            <p class="big"><DataValue>{formatFixed(latest.weight, 1)}</DataValue><small>kg · {weighedLabel(latestDate, today)}</small></p>
            {#if chips.length > 0}<div class="chips">{#each chips as chip (chip)}<span class="chip">{chip}</span>{/each}</div>{/if}
            {@render bodyFacts()}
        </div>
    </PhoneGlance>
{/if}

<QuickWeighIn show={quickWeighOpen} date={today} {today} onClose={() => (quickWeighOpen = false)} />

<MobilePageAction hideWhenModalOpen isModalOpen={logDrawerOpen || quickWeighOpen}>
    <Button class="h-12 w-full text-[15px]" onclick={() => (quickWeighOpen = true)} aria-label="Add weigh-in" disabled={savingEntry}>
        <IconPlus class="h-5 w-5" /> <span class="stor-action-label">{savingEntry ? "Saving…" : "Add weigh-in"}</span>
    </Button>
</MobilePageAction>
<CommandDrawer
    show={logDrawerOpen}
    title="Add weigh-in"
    description="Save a dated weight entry for your history and trend chart."
    onClose={closeLogDrawer}
>
    <form id={drawerFormId0}
        class="space-y-4"
        onsubmit={(event) => {
            event.preventDefault();
            void logWeight();
        }}
    >
        <label class="block text-sm font-semibold text-[var(--stor-ink)]">
            Date
            <DatePicker
                bind:value={newWeightDate}
                class="mt-1.5 text-sm"
                placeholder="Choose weigh-in date"
            />
        </label>

        <label class="block text-sm font-semibold text-[var(--stor-ink)]">
            Height
            <div class="relative mt-1.5">
                <input
                    id="log-height"
                    type="number"
                    min="0"
                    step="1"
                    class="h-11 w-full rounded-xl border border-[var(--stor-field-border)] bg-[var(--stor-surface-muted)] px-3 pr-12 text-base text-[var(--stor-ink)] outline-none transition focus:border-[var(--stor-focus)] focus:ring-2 focus:ring-[var(--stor-selected)] sm:h-9 sm:text-sm"
                    bind:value={newHeightValue}
                    placeholder="Height to save"
                />
                <span class="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-[var(--stor-muted-text)]">cm</span>
            </div>
        </label>

        <label class="block text-sm font-semibold text-[var(--stor-ink)]">
            Weight
            <div class="relative mt-1.5">
                <input
                    type="number"
                    min="0"
                    step="0.1"
                    class="h-11 w-full rounded-xl border border-[var(--stor-field-border)] bg-[var(--stor-surface-muted)] px-3 pr-12 text-base text-[var(--stor-ink)] outline-none transition focus:border-[var(--stor-focus)] focus:ring-2 focus:ring-[var(--stor-selected)] sm:h-9 sm:text-sm"
                    bind:value={newWeightValue}
                    placeholder="Weight to save"
                />
                <span class="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-[var(--stor-muted-text)]">kg</span>
            </div>
        </label>

        </form>
    {#snippet footer()}
            <Button variant="secondary" size="sm" onclick={closeLogDrawer} disabled={savingEntry}>
                Cancel
            </Button>
            <Button type="submit" form={drawerFormId0} disabled={!canSaveWeight}>
                {savingEntry ? "Saving..." : "Save entry"}
            </Button>

    {/snippet}
</CommandDrawer>

<CommandConfirmDialog
    show={!!deleteEntry}
    title="Delete weigh-in?"
    message={deleteEntry
        ? `Delete the ${formatHistoryDate(deleteEntry.date)} entry at ${formatFixed(deleteEntry.weight, 1)} kg?`
        : "Delete this weight entry?"}
    onConfirm={confirmRemoveEntry}
    onCancel={() => (deleteEntry = null)}
/>

<style>
    /* One column on phones, in reading order; the measurements sit beside the chart from lg. */
    .layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--stor-section-gap); grid-template-areas: "hero" "measure" "weighins"; }
    @media (min-width: 1024px) {
        .layout { grid-template-columns: minmax(0, 2.2fr) minmax(0, .9fr); grid-template-areas: "hero measure" "weighins ."; align-items: start; }
    }
    .hero { grid-area: hero; display: grid; gap: 14px; padding: 18px 18px 12px; grid-template-columns: minmax(0, 1fr); grid-template-areas: "top" "chips" "range" "plot"; }
    @media (min-width: 640px) {
        .hero { padding: 22px 24px 14px; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "top range" "chips chips" "plot plot"; }
    }
    .top { grid-area: top; }
    .range { grid-area: range; align-self: end; justify-self: start; }
    .chips { grid-area: chips; display: flex; flex-wrap: wrap; gap: 8px; }
    .plot { grid-area: plot; margin: 0 -8px 0 -4px; min-width: 0; }
    @media (min-width: 640px) { .range { justify-self: end; } }
    .lab { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--stor-muted-text); }
    .lab i { display: block; width: 8px; height: 8px; border-radius: 50%; background: var(--tone); }
    .big { margin-top: 6px; font-size: 34px; font-weight: 650; line-height: 1.05; letter-spacing: -.035em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    @media (min-width: 640px) { .big { font-size: 40px; } }
    .big small { margin-left: 10px; font-size: 14px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .chip {
        display: inline-flex; height: 26px; align-items: center; padding: 0 10px; border-radius: 999px; white-space: nowrap;
        font-size: 12px; font-weight: 600; color: var(--stor-ink); background: var(--stor-surface-muted);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--stor-border) 60%, transparent);
    }
    .measure { grid-area: measure; }
    .weighins { grid-area: weighins; }
    .facts { margin: 0; }
    .facts > div { padding: 10px 0; }
    .facts > div + div { border-top: 1px solid color-mix(in srgb, var(--stor-border) 60%, transparent); }
    .facts dt { font-size: 12px; font-weight: 500; color: var(--stor-muted-text); }
    .facts dd { margin: 2px 0 0; font-size: 18px; font-weight: 650; letter-spacing: -.015em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .facts dd small { font-size: 11.5px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .note { margin-top: 8px; font-size: 12px; color: var(--stor-muted-text); }
    .range-chip { grid-area: range; justify-self: end; }
    .range-select {
        height: 34px; padding: 0 28px 0 12px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--stor-ink);
        background: var(--stor-surface-muted) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%235b6b7b' d='M7.41 8.58 12 13.17l4.59-4.59L18 10l-6 6-6-6z'/%3E%3C/svg%3E") no-repeat right 8px center / 16px;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--stor-border) 60%, transparent); appearance: none; -webkit-appearance: none; border: 0;
    }
    /* Phones: the chart first with its range chip beside the label, then the weigh-ins as a plain list. */
    @media (max-width: 767px) {
        .hero { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "lab range" "plot plot"; padding: 14px 16px 10px; }
        .hero .top { grid-area: lab; }
        .weighins :global(thead), .weighins :global(td:last-child), .weighins :global(th:last-child) { display: none; }
    }
</style>
