<script lang="ts">
    import { formatNumber as formatCount } from "@hearthlog/sdk/format";
    import { onDestroy, onMount } from "svelte";
    import {
        KalApiError,
        lookupKalFoodByEan,
        type KalEanLookupResponse,
    } from "../../api/kal.js";
    import {
        BarcodeCameraError,
        decodeBarcodePhoto,
        isValidEanInput,
        normalizeEanInput,
        startBarcodeCamera,
        type BarcodeScannerControls,
    } from "../../calories/browser-barcode.js";
    import { hasKnownCalories, KAL_SOURCE_PROVIDER } from "../../calories/external-food.js";
    import type { FoodItem } from "@hearthlog/sdk/data";
    import { Button } from "@hearthlog/sdk/ui";
    import { Input } from "@hearthlog/sdk/ui";
    import IconBarcodeScan from "~icons/mdi/barcode-scan";
    import IconCamera from "~icons/mdi/camera-outline";
    import IconFlash from "~icons/mdi/flash-outline";
    import IconFlashOff from "~icons/mdi/flash-off-outline";
    import IconImage from "~icons/mdi/image-outline";
    import IconRefresh from "~icons/mdi/refresh";

    type ScannerPurpose = "log" | "library";
    type ScannerStage = "ready" | "starting" | "scanning" | "lookup" | "result" | "not-found" | "error";

    let {
        purpose,
        localFoods,
        onSelectLocal,
        onSelectExternal,
        onSearchByName,
        onManualFood,
        onCancel,
    }: {
        purpose: ScannerPurpose;
        localFoods: FoodItem[];
        onSelectLocal: (food: FoodItem) => void | Promise<void>;
        onSelectExternal: (result: KalEanLookupResponse) => void | Promise<void>;
        onSearchByName: () => void;
        onManualFood: (ean: string) => void;
        onCancel: () => void;
    } = $props();

    let videoElement = $state<HTMLVideoElement>();
    let photoInput = $state<HTMLInputElement>();
    let cameraControls = $state<BarcodeScannerControls | null>(null);
    let lookupController: AbortController | null = null;
    let stage = $state<ScannerStage>("ready");
    let cameraMessage = $state("");
    let photoMessage = $state("");
    let manualEan = $state("");
    let manualError = $state("");
    let scannedEan = $state("");
    let lookupMessage = $state("");
    let localResult = $state<FoodItem | null>(null);
    let externalResult = $state<KalEanLookupResponse | null>(null);
    let torchOn = $state(false);
    let resolving = false;
    let cameraRunId = 0;

    const statusMessage = $derived(
        stage === "starting"
            ? "Starting camera…"
            : stage === "scanning"
              ? "Camera ready. Hold the barcode inside the frame."
              : stage === "lookup"
                ? `Looking up barcode ${scannedEan}…`
                : stage === "result"
                  ? "Product found. Review it before continuing."
                  : stage === "not-found"
                    ? `No catalog product was found for ${scannedEan}.`
                    : stage === "error"
                      ? lookupMessage
                      : cameraMessage || "Scan with the camera, choose a photo, or enter the barcode number.",
    );

    onMount(() => {
        void startCamera();
    });

    onDestroy(() => {
        stopCamera();
        lookupController?.abort();
    });

    function formatNumber(value: number): string {
        return formatCount(value, 1);
    }

    function stopCamera(): void {
        cameraRunId += 1;
        cameraControls?.stop();
        cameraControls = null;
        torchOn = false;
    }

    function resetResult(): void {
        lookupController?.abort();
        lookupController = null;
        localResult = null;
        externalResult = null;
        lookupMessage = "";
        photoMessage = "";
        resolving = false;
    }

    async function startCamera(): Promise<void> {
        if (!videoElement) return;
        stopCamera();
        const runId = cameraRunId;
        resetResult();
        cameraMessage = "";
        stage = "starting";
        try {
            const nextControls = await startBarcodeCamera(videoElement, (ean) => {
                void resolveEan(ean);
            });
            if (runId !== cameraRunId) {
                nextControls.stop();
                return;
            }
            cameraControls = nextControls;
            if (stage === "starting") stage = "scanning";
        } catch (error) {
            if (runId !== cameraRunId) return;
            stage = "ready";
            cameraMessage = error instanceof BarcodeCameraError
                ? error.message
                : "The camera could not be started. Use a photo or enter the barcode instead.";
        }
    }

    async function switchTorch(): Promise<void> {
        if (!cameraControls?.torchAvailable) return;
        const next = !torchOn;
        try {
            await cameraControls.switchTorch(next);
            torchOn = next;
        } catch {
            cameraMessage = "The flashlight is not available on this camera.";
        }
    }

    function matchingLocalFood(ean: string): FoodItem | undefined {
        return localFoods.find((food) =>
            Boolean(food.source_ean) && normalizeEanInput(food.source_ean) === ean);
    }

    function matchingImportedFood(result: KalEanLookupResponse): FoodItem | undefined {
        return localFoods.find((food) =>
            food.source_provider === KAL_SOURCE_PROVIDER && food.source_id === result.food.guid);
    }

    async function resolveEan(value: string): Promise<void> {
        const ean = normalizeEanInput(value);
        if (!isValidEanInput(ean) || resolving) return;

        resolving = true;
        stopCamera();
        resetResult();
        resolving = true;
        scannedEan = ean;
        manualEan = ean;
        manualError = "";
        stage = "lookup";

        const localFood = matchingLocalFood(ean);
        if (localFood) {
            localResult = localFood;
            stage = "result";
            resolving = false;
            return;
        }

        const controller = new AbortController();
        lookupController = controller;
        try {
            const result = await lookupKalFoodByEan(ean, { signal: controller.signal });
            if (controller.signal.aborted) return;
            const importedFood = matchingImportedFood(result);
            if (importedFood) localResult = importedFood;
            else externalResult = result;
            stage = "result";
        } catch (error) {
            if (controller.signal.aborted) return;
            if (error instanceof KalApiError && error.status === 404) {
                stage = "not-found";
            } else {
                lookupMessage = lookupErrorMessage(error);
                stage = "error";
            }
        } finally {
            if (lookupController === controller) lookupController = null;
            resolving = false;
        }
    }

    function lookupErrorMessage(error: unknown): string {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
            return "You’re offline. Saved barcode matches still work, but catalog lookup needs a connection.";
        }
        if (error instanceof KalApiError) {
            if (error.status === 408) return "Barcode lookup timed out. Check your connection and try again.";
            if (error.status === 429) return "The catalog is receiving too many requests. Wait a moment and retry.";
            if (error.status === 0) return "The online food catalog is unavailable. Try again or continue manually.";
        }
        return "The barcode could not be looked up. Try again or continue with another method.";
    }

    function submitManualEan(event: SubmitEvent): void {
        event.preventDefault();
        const ean = normalizeEanInput(manualEan);
        manualEan = ean;
        if (!isValidEanInput(ean)) {
            manualError = "Enter 8 to 14 digits.";
            return;
        }
        manualError = "";
        void resolveEan(ean);
    }

    async function selectPhoto(event: Event): Promise<void> {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;

        stopCamera();
        resetResult();
        stage = "lookup";
        scannedEan = "";
        photoMessage = "Reading barcode from photo…";
        try {
            const ean = await decodeBarcodePhoto(file);
            photoMessage = "";
            await resolveEan(ean);
        } catch (error) {
            stage = "ready";
            photoMessage = error instanceof Error ? error.message : "The photo could not be read.";
        }
    }

    async function confirmResult(): Promise<void> {
        if (localResult) await onSelectLocal(localResult);
        else if (externalResult && hasKnownCalories(externalResult.food)) {
            await onSelectExternal(externalResult);
        }
    }

    function scanAgain(): void {
        scannedEan = "";
        manualEan = "";
        manualError = "";
        void startCamera();
    }
</script>

<div class="space-y-4" data-testid="food-barcode-scanner">
    <div class="flex items-start gap-3 rounded-xl bg-[var(--stor-surface-muted)] p-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--stor-accent-soft)] text-[var(--stor-accent-strong)]">
            <IconBarcodeScan class="h-5 w-5" />
        </span>
        <div class="min-w-0">
            <h3 class="font-semibold text-stone-950">Scan a packaged food</h3>
            <p class="mt-0.5 text-xs leading-relaxed text-[var(--stor-muted-text)]">
                Camera frames and photos stay on this device. Only the barcode number is used for lookup.
            </p>
        </div>
    </div>

    <p class="sr-only" aria-live="polite">{statusMessage}</p>

    {#if stage === "ready" || stage === "starting" || stage === "scanning"}
        <div class="overflow-hidden rounded-xl bg-stone-950 ">
            <div class="relative aspect-[4/3]">
                <video
                    bind:this={videoElement}
                    class="h-full w-full object-cover"
                    muted
                    playsinline
                    aria-label="Live barcode camera preview"
                ></video>
                <div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/10 p-8" aria-hidden="true">
                    <div class="h-28 w-full max-w-sm rounded-xl border-2 border-white/90 "></div>
                </div>
                {#if stage === "starting"}
                    <div class="absolute inset-0 flex items-center justify-center bg-stone-950/55 text-sm font-semibold text-white">Starting camera…</div>
                {/if}
            </div>
            <div class="flex items-center justify-between gap-3 px-3 py-2.5 text-xs text-stone-200">
                <span>{stage === "scanning" ? "Hold the barcode steady inside the frame" : "Rear camera preferred"}</span>
                {#if cameraControls?.torchAvailable}
                    <Button variant="ghost" size="sm" class="text-white hover:bg-white/10 hover:text-white" onclick={switchTorch} aria-label={torchOn ? "Turn flashlight off" : "Turn flashlight on"}>
                        {#if torchOn}<IconFlashOff class="h-4 w-4" /> Off{:else}<IconFlash class="h-4 w-4" /> Light{/if}
                    </Button>
                {/if}
            </div>
        </div>

        {#if cameraMessage}
            <p class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800" role="status">{cameraMessage}</p>
        {/if}
        {#if photoMessage}
            <p class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800" role="status">{photoMessage}</p>
        {/if}

        <div class="grid grid-cols-2 gap-2">
            <Button variant="secondary" onclick={() => photoInput?.click()}><IconImage class="h-4 w-4" /> Use photo</Button>
            {#if stage === "scanning" || stage === "starting"}
                <Button variant="secondary" onclick={() => { stopCamera(); stage = "ready"; }}><IconCamera class="h-4 w-4" /> Stop camera</Button>
            {:else}
                <Button variant="secondary" onclick={startCamera}><IconCamera class="h-4 w-4" /> Start camera</Button>
            {/if}
        </div>
        <input
            bind:this={photoInput}
            class="sr-only"
            type="file"
            accept="image/*"
            aria-label="Choose barcode photo"
            onchange={selectPhoto}
        />

        <form class="rounded-xl bg-[var(--stor-surface-muted)] p-3" onsubmit={submitManualEan}>
            <label for="manual-barcode" class="text-xs font-semibold text-stone-700">Enter barcode number</label>
            <div class="mt-2 flex gap-2">
                <Input id="manual-barcode" bind:value={manualEan} inputmode="numeric" autocomplete="off" placeholder="8–14 digits" aria-describedby={manualError ? "manual-barcode-error" : undefined} />
                <Button type="submit" variant="secondary">Look up</Button>
            </div>
            {#if manualError}<p id="manual-barcode-error" class="mt-2 text-xs text-red-700">{manualError}</p>{/if}
        </form>
    {:else if stage === "lookup"}
        <div class="flex min-h-52 flex-col items-center justify-center rounded-xl bg-[var(--stor-surface-muted)] p-6 text-center">
            <IconBarcodeScan class="h-8 w-8 text-[var(--stor-accent-text)]" />
            <h3 class="mt-3 font-semibold text-stone-950">{scannedEan ? "Looking up product" : "Reading photo"}</h3>
            <p class="mt-1 text-sm tabular-nums text-[var(--stor-muted-text)]">{scannedEan || photoMessage}</p>
        </div>
    {:else if stage === "result"}
        <section class="rounded-xl bg-[var(--stor-surface-muted)] p-4 ">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--stor-muted-text)]">
                        {localResult ? "Saved food" : externalResult?.confidence === "LOW" ? "Possible catalog match" : "Catalog match"}
                    </p>
                    <h3 class="mt-1 text-lg font-semibold text-stone-950">{localResult?.name ?? externalResult?.food.name}</h3>
                    {#if localResult?.brand || externalResult?.food.brand}
                        <p class="text-sm text-[var(--stor-muted-text)]">{localResult?.brand ?? externalResult?.food.brand}</p>
                    {/if}
                </div>
                <span class="shrink-0 rounded-lg bg-[var(--stor-surface-muted)] px-2 py-1 text-[11px] font-medium tabular-nums text-stone-600">{scannedEan}</span>
            </div>

            {#if externalResult?.confidence === "LOW"}
                <p class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                    Several catalog products matched this barcode. Check the name and nutrition before continuing.
                </p>
            {/if}

            {#if localResult}
                <div class="mt-4 text-sm text-stone-600">
                    <span class="font-semibold tabular-nums text-stone-950">{formatNumber(localResult.calories_per_100g)} kcal</span> / 100 g
                    <span class="mt-1 block text-xs">P {formatNumber(localResult.protein_per_100g)}g · C {formatNumber(localResult.carbs_per_100g)}g · F {formatNumber(localResult.fat_per_100g)}g</span>
                </div>
            {:else if externalResult}
                <div class="mt-4 text-sm text-stone-600">
                    <span class="font-semibold tabular-nums text-stone-950">{externalResult.food.energyKcal === null ? "Calories unavailable" : `${formatNumber(externalResult.food.energyKcal)} kcal`}</span>{#if externalResult.food.energyKcal !== null} / 100 g{/if}
                    <span class="mt-1 block text-xs">P {externalResult.food.proteinG === null ? "—" : formatNumber(externalResult.food.proteinG)}g · C {externalResult.food.carbsG === null ? "—" : formatNumber(externalResult.food.carbsG)}g · F {externalResult.food.fatG === null ? "—" : formatNumber(externalResult.food.fatG)}g</span>
                </div>
            {/if}

            {#if externalResult && !hasKnownCalories(externalResult.food)}
                <p class="mt-3 text-sm text-amber-800">This catalog item has no calorie value, so it cannot be used yet.</p>
            {/if}

            <div class="mt-5 flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onclick={scanAgain}><IconRefresh class="h-4 w-4" /> Scan again</Button>
                <Button
                    disabled={Boolean(externalResult && !hasKnownCalories(externalResult.food))}
                    onclick={confirmResult}
                >
                    {localResult
                        ? purpose === "log" ? "Use saved food" : "Done"
                        : purpose === "log" ? "Use food" : "Import food"}
                </Button>
            </div>
        </section>
    {:else}
        <section class="rounded-xl border {stage === 'not-found' ? 'border-amber-200 bg-amber-50' : 'border-[var(--stor-border)] bg-white'} p-4">
            <IconBarcodeScan class="h-7 w-7 {stage === 'not-found' ? 'text-amber-700' : 'text-[var(--stor-muted-text)]'}" />
            <h3 class="mt-3 font-semibold text-stone-950">{stage === "not-found" ? "Product not found" : "Lookup unavailable"}</h3>
            <p class="mt-1 text-sm leading-relaxed text-stone-600">{stage === "not-found" ? `The catalog has no product for barcode ${scannedEan}.` : lookupMessage}</p>
            <div class="mt-4 flex flex-wrap gap-2">
                {#if stage === "error"}<Button variant="secondary" onclick={() => resolveEan(scannedEan)}><IconRefresh class="h-4 w-4" /> Retry</Button>{/if}
                <Button variant="secondary" onclick={scanAgain}>Scan again</Button>
                <Button variant="ghost" onclick={onSearchByName}>Search by name</Button>
                <Button variant="ghost" onclick={() => onManualFood(scannedEan)}>Enter manually</Button>
            </div>
        </section>
    {/if}

    <div class="flex justify-end">
        <Button variant="ghost" onclick={() => { stopCamera(); onCancel(); }}>Cancel scanning</Button>
    </div>
</div>
