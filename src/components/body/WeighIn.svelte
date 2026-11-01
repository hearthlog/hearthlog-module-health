<script lang="ts">
    import { executeLocalCommand, queryDatabase } from "@hearthlog/sdk/data";
    import type { AddWeightlogEvent } from "@hearthlog/sdk/data";
    import { notify, refreshPageData } from "@hearthlog/sdk/runtime";
    import { formatFixed } from "@hearthlog/sdk/format";
    import IconMinus from "~icons/mdi/minus";
    import IconPlus from "~icons/mdi/plus";
    import { shiftLocalDate } from "../../calories/logic.js";

    /**
     * A weigh-in that starts at the last weight: most mornings it is a nudge or
     * two of 0.1 kg and Save. The trend it would make shows before saving.
     * Height comes from the last weigh-in; the first one asks for it.
     */
    let { date, onSaved }: { date: string; onSaved?: () => void } = $props();

    let weight = $state<number | null>(null);
    let height = $state<number | null>(null);
    let last = $state<{ weight: number; date: string } | null>(null);
    /** Weigh-ins of the six days before, for the trend the new one would make. */
    let week = $state<number[]>([]);
    let saving = $state(false);
    let loaded = $state(false);
    const fieldId = $props.id();

    $effect(() => {
        const day = date;
        let current = true;
        loaded = false;
        void queryDatabase(async (repositories) => {
            const [latest, trend] = await Promise.all([
                repositories.weightLogs.getLatestWeightLog(day),
                repositories.weightLogs.getWeightTrend(shiftLocalDate(day, -6), day),
            ]);
            return { latest, trend };
        }).then(({ latest, trend }) => {
            if (!current) return;
            last = latest ? { weight: Number(latest.weight), date: String(latest.date).slice(0, 10) } : null;
            height = latest ? Number(latest.height) || null : null;
            weight = last?.weight ?? null;
            week = trend.weighIns.map((point) => point.weight);
            loaded = true;
        }).catch(() => {
            if (current) loaded = true;
        });
        return () => { current = false; };
    });

    const change = $derived(weight !== null && last ? weight - last.weight : null);
    const trend = $derived(weight !== null && weight > 0 ? [...week, weight].reduce((sum, value) => sum + value, 0) / (week.length + 1) : null);
    const valid = $derived(weight !== null && weight > 0 && height !== null && height > 0);

    function nudge(direction: 1 | -1): void {
        weight = Math.max(0.1, Number(((weight ?? last?.weight ?? 70) + direction * 0.1).toFixed(1)));
    }

    async function save(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (!valid || saving || weight === null || height === null) return;
        saving = true;
        // The shell names the saved weigh-in and offers Undo.
        const add: AddWeightlogEvent = { id: crypto.randomUUID(), type: "WEIGHTLOG_ADDED", timestamp: Date.now(), payload: { id: crypto.randomUUID(), weight, height, date, notes: "" } };
        try {
            await executeLocalCommand(add);
            await refreshPageData("app:weight-logs");
            onSaved?.();
        } catch (error) {
            console.error("Failed to save weigh-in:", error);
            notify.error("The weigh-in could not be saved. Your value is still here.");
        } finally {
            saving = false;
        }
    }
</script>

<form class="weigh" onsubmit={save}>
    <div class="stepper">
        <button type="button" aria-label="0.1 kg less" onclick={() => nudge(-1)} disabled={!loaded}><IconMinus class="h-5 w-5" /></button>
        <label for={fieldId} class="val">
            <span class="sr-only">Weight in kilograms</span>
            <input id={fieldId} type="number" inputmode="decimal" min="0" step="0.1" placeholder="0.0" bind:value={weight} />
            <span class="u">kg</span>
        </label>
        <button type="button" aria-label="0.1 kg more" onclick={() => nudge(1)} disabled={!loaded}><IconPlus class="h-5 w-5" /></button>
    </div>
    <p class="facts">
        {#if last}
            <span>{last.date === date ? "Earlier today" : "Last"} {formatFixed(last.weight, 1)}</span>
            {#if change !== null}<span class:pos={change < 0} class:neg={change > 0}>{change === 0 ? "no change" : `${formatFixed(change, 1, { signed: true })} kg`}</span>{/if}
        {:else if loaded}
            <span>Your first weigh-in</span>
        {/if}
        {#if trend !== null && week.length > 0}<span>Trend would be {formatFixed(trend, 1)}</span>{/if}
    </p>
    {#if loaded && !(height && height > 0)}
        <label class="height">Height <input type="number" inputmode="numeric" min="50" max="250" step="1" bind:value={height} placeholder="cm" /> cm</label>
    {/if}
    <button type="submit" class="save" disabled={!valid || saving}>{saving ? "Saving…" : valid ? `Save ${formatFixed(weight ?? 0, 1)} kg` : "Save"}</button>
</form>

<style>
    .weigh { display: flex; flex-direction: column; gap: 10px; }
    .stepper { display: flex; align-items: center; gap: 10px; }
    .stepper button { display: grid; width: 48px; height: 48px; flex-shrink: 0; place-items: center; border-radius: 14px; color: var(--stor-ink); background: var(--stor-surface-muted); }
    .stepper button:hover { background: var(--stor-surface-hover); }
    .val { display: flex; min-width: 0; flex: 1; align-items: baseline; justify-content: center; gap: 6px; border-bottom: 2px solid var(--stor-health-body); }
    .val input { width: 100%; min-width: 0; border: 0; background: transparent; text-align: center; font-size: 38px; font-weight: 650; letter-spacing: -.03em; color: var(--stor-ink); font-variant-numeric: tabular-nums; outline: none; }
    .u { font-size: 15px; color: var(--stor-muted-text); }
    .facts { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .facts .pos { color: var(--stor-positive); }
    .facts .neg { color: var(--stor-ink); }
    .height { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--stor-ink); }
    .height input { width: 84px; height: 36px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--stor-field-border, var(--stor-border)); background: var(--stor-surface); font-size: 14px; }
    .save { height: 44px; border-radius: 12px; font-size: 14.5px; font-weight: 600; color: var(--stor-action-text, #fff); background: var(--stor-action); }
    .save:hover { background: var(--stor-action-hover); }
    .save:disabled { opacity: .5; }
</style>
