<script lang="ts">
    import { renderComponent } from "@tanstack/svelte-table";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { DataTable } from "@hearthlog/sdk/table";
    import { DataTableHeader } from "@hearthlog/sdk/table";
    import { DataTablePagination } from "@hearthlog/sdk/table";
    import { createAppColumnHelper } from "@hearthlog/sdk/table";
    import type { DataTableColumn, DataTableSorting } from "@hearthlog/sdk/table";
    import WeighInActionsCell from "./WeighInActionsCell.svelte";
    import WeighInDateCell from "./WeighInDateCell.svelte";
    import { queryDatabase } from "@hearthlog/sdk/data";
    import type { WeighInRow, WeighInSort } from "../../data/weight-logs.js";
    import { formatShortDate } from "../../health/day.js";
    import {
        DEFAULT_WEIGH_IN_PAGE_SIZE,
        DEFAULT_WEIGH_IN_SORT,
        WEIGH_IN_PAGE_SIZES,
        parseWeighInSort,
        weighInSortValue,
    } from "../../health/weight.js";
    import { notify } from "@hearthlog/sdk/runtime";
    import { parsePositiveInt } from "@hearthlog/sdk/runtime";
    import { formatFixed } from "@hearthlog/sdk/format";

    /**
     * The weigh-ins as a table: SQLite sorts and pages them, and the sort, page,
     * and page size live in the address, so a reload or Back lands where you were.
     * Rows stay on screen while the next page reads, so paging never flashes.
     */
    let { total, today, revision, busyId = null, onDelete }: {
        /** Every weigh-in on record. */
        total: number;
        today: string;
        /** Changes after a save or a sync; the page on screen then reads again. */
        revision: number;
        /** The weigh-in being removed. */
        busyId?: string | null;
        onDelete: (row: WeighInRow) => void;
    } = $props();

    function sizeFromAddress(value: string | null): number {
        const size = parsePositiveInt(value, DEFAULT_WEIGH_IN_PAGE_SIZE);
        return (WEIGH_IN_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_WEIGH_IN_PAGE_SIZE;
    }

    let sort = $state<WeighInSort>(parseWeighInSort(page.url.searchParams.get("sort")));
    let pageSize = $state(sizeFromAddress(page.url.searchParams.get("size")));
    let requestedPage = $state(parsePositiveInt(page.url.searchParams.get("page"), 1));
    const pageCount = $derived(Math.max(1, Math.ceil(total / pageSize)));
    const current = $derived(Math.min(requestedPage, pageCount));

    function syncFromLocation(): void {
        const url = new URL(window.location.href);
        sort = parseWeighInSort(url.searchParams.get("sort"));
        pageSize = sizeFromAddress(url.searchParams.get("size"));
        requestedPage = parsePositiveInt(url.searchParams.get("page"), 1);
    }

    /** Writes the state into the address: defaults leave it clean. */
    function writeAddress(): void {
        const url = new URL(window.location.href);
        const sortValue = weighInSortValue(sort);
        if (sortValue) url.searchParams.set("sort", sortValue); else url.searchParams.delete("sort");
        if (pageSize !== DEFAULT_WEIGH_IN_PAGE_SIZE) url.searchParams.set("size", String(pageSize)); else url.searchParams.delete("size");
        if (requestedPage > 1) url.searchParams.set("page", String(requestedPage)); else url.searchParams.delete("page");
        void goto(`${url.pathname}${url.search}${url.hash}`, { shallow: true, state: page.state, reset: false });
    }

    /**
     * The date column starts newest first. A click on it there would clear the sort and land on the
     * same order, so it flips to oldest first instead; every other column clears back to the default.
     */
    function selectSorting(next: DataTableSorting): void {
        const wasDefault = sort.column === DEFAULT_WEIGH_IN_SORT.column && sort.desc === DEFAULT_WEIGH_IN_SORT.desc;
        if (next.id === null) sort = wasDefault ? { column: "date", desc: false } : DEFAULT_WEIGH_IN_SORT;
        else sort = { column: next.id as WeighInSort["column"], desc: next.desc };
        requestedPage = 1;
        writeAddress();
    }

    function selectPage(next: number): void {
        requestedPage = Math.min(Math.max(1, next), pageCount);
        writeAddress();
    }

    function selectPageSize(next: number): void {
        pageSize = next;
        requestedPage = 1;
        writeAddress();
    }

    // The old page stays until the new one arrives.
    let rows = $state.raw<WeighInRow[]>([]);
    let loaded = $state(false);
    $effect(() => {
        const options = { limit: pageSize, offset: (current - 1) * pageSize, sort: { column: sort.column, desc: sort.desc } };
        void revision;
        let cancelled = false;
        queryDatabase((repositories) => repositories.weightLogs.getWeighInPage(options))
            .then((page) => {
                if (cancelled) return;
                rows = page;
                loaded = true;
            })
            .catch((error) => {
                if (cancelled) return;
                console.error("Failed to load weigh-ins:", error);
                notify.error("Could not load weigh-ins");
            });
        return () => { cancelled = true; };
    });

    const columnHelper = createAppColumnHelper<Record<string, unknown>>();
    const numeric = "text-right tabular-nums";
    const columns: DataTableColumn[] = columnHelper.columns([
        columnHelper.accessor((row) => row.date, {
            id: "date",
            enableSorting: true,
            header: (context) => renderComponent(DataTableHeader, { name: "Date", context }),
            cell: (info) => renderComponent(WeighInDateCell, { date: String(info.getValue()), today }),
        }),
        columnHelper.accessor((row) => row.weight, {
            id: "weight",
            enableSorting: true,
            meta: { className: numeric },
            header: (context) => renderComponent(DataTableHeader, { name: "Weight", align: "right", context }),
            cell: (info) => `${formatFixed(Number(info.getValue()), 1)} kg`,
        }),
        columnHelper.accessor((row) => row.change, {
            id: "change",
            enableSorting: true,
            meta: { className: numeric },
            header: (context) => renderComponent(DataTableHeader, { name: "Change", align: "right", context }),
            cell: (info) => (info.getValue() === null ? "—" : formatFixed(Number(info.getValue()), 1, { signed: true })),
        }),
        columnHelper.accessor((row) => row.bmi, {
            id: "bmi",
            enableSorting: true,
            // Phones keep date, weight, change and the delete button; BMI follows from sm.
            meta: { className: `hidden sm:table-cell ${numeric} text-[var(--stor-muted-text)]` },
            header: (context) => renderComponent(DataTableHeader, { name: "BMI", align: "right", context }),
            cell: (info) => (info.getValue() === null ? "—" : formatFixed(Number(info.getValue()), 1)),
        }),
        columnHelper.display({
            id: "__actions",
            enableSorting: false,
            meta: { className: "w-14" },
            header: () => renderComponent(DataTableHeader, { name: "" }),
            cell: (info) => {
                const row = info.row.original as unknown as WeighInRow;
                return renderComponent(WeighInActionsCell, {
                    label: formatShortDate(row.date, today),
                    busy: () => busyId === row.id,
                    onDelete: () => onDelete(row),
                });
            },
        }),
    ]);

    const showingStart = $derived(total === 0 ? 0 : (current - 1) * pageSize + 1);
    const showingEnd = $derived(Math.min(current * pageSize, total));
    const pagination = $derived({ pageIndex: current - 1, pageSize, rowCount: total, pageCount });
</script>

<svelte:window onpopstate={syncFromLocation} />

<DataTable
    {columns}
    data={rows as unknown as Record<string, unknown>[]}
    {pagination}
    sorting={{ id: sort.column, desc: sort.desc }}
    onSortingChange={selectSorting}
    isLoading={!loaded}
    variant="quiet"
    label="Weigh-ins"
    emptyTitle="No weigh-ins"
    emptyDescription="Weigh-ins you log appear here."
    testId="weigh-in-table"
    scrollTestId="weigh-in-table-scroll"
/>
<DataTablePagination
    currentPage={current}
    totalPages={pageCount}
    totalRows={total}
    {pageSize}
    pageSizes={WEIGH_IN_PAGE_SIZES}
    {showingStart}
    {showingEnd}
    onSelectPage={selectPage}
    onSelectPageSize={selectPageSize}
/>
