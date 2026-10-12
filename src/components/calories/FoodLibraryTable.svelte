<script lang="ts">
    import type { Snippet } from "svelte";
    import { renderComponent } from "@tanstack/svelte-table";
    import { DataTable } from "@hearthlog/sdk/table";
    import { DataTableHeader } from "@hearthlog/sdk/table";
    import { DataTablePagination } from "@hearthlog/sdk/table";
    import { createAppColumnHelper } from "@hearthlog/sdk/table";
    import type { DataTableColumn, DataTableSorting } from "@hearthlog/sdk/table";
    import FoodActionsCell from "./FoodActionsCell.svelte";
    import FoodFingerprint from "./FoodFingerprint.svelte";
    import FoodMacrosCell from "./FoodMacrosCell.svelte";
    import FoodNameCell from "./FoodNameCell.svelte";
    import FoodStarCell from "./FoodStarCell.svelte";
    import { DEFAULT_FOOD_SORT, FOOD_PAGE_SIZES, type FoodSort, type FoodSortColumn } from "../../calories/food-logic.js";
    import type { FoodItem } from "../../data/calories.js";
    import { formatNumber } from "@hearthlog/sdk/format";

    /**
     * The food library as a table. SQLite filters, sorts and pages it; this draws
     * the page it is given and says what the reader asked for. Rows stay on screen
     * while the next page reads, so searching and paging never flash.
     */
    let {
        foods,
        total,
        loading,
        sort,
        page,
        pageSize,
        onSort,
        onPage,
        onPageSize,
        onFavorite,
        onEdit,
        onDelete,
        empty,
    }: {
        foods: FoodItem[];
        /** Foods matching the search, counted in SQL. */
        total: number;
        /** True until the first page has arrived. */
        loading: boolean;
        sort: FoodSort;
        page: number;
        pageSize: number;
        onSort: (sort: FoodSort) => void;
        onPage: (page: number) => void;
        onPageSize: (size: number) => void;
        onFavorite: (food: FoodItem) => void;
        onEdit: (food: FoodItem) => void;
        onDelete: (food: FoodItem) => void;
        /** Drawn in place of the table when nothing matches. */
        empty?: Snippet;
    } = $props();

    const food = (row: unknown): FoodItem => row as FoodItem;
    const columnHelper = createAppColumnHelper<Record<string, unknown>>();
    const columns: DataTableColumn[] = columnHelper.columns([
        columnHelper.display({
            id: "__favorite",
            enableSorting: false,
            meta: { className: "w-12 pr-0" },
            header: () => renderComponent(DataTableHeader, { name: "" }),
            cell: (info) => renderComponent(FoodStarCell, { food: food(info.row.original), onToggle: () => onFavorite(food(info.row.original)) }),
        }),
        columnHelper.accessor((row) => row.name, {
            id: "name",
            enableSorting: true,
            header: (context) => renderComponent(DataTableHeader, { name: "Food", context }),
            cell: (info) => renderComponent(FoodNameCell, { food: food(info.row.original) }),
        }),
        columnHelper.accessor((row) => row.calories_per_100g, {
            id: "calories",
            enableSorting: true,
            meta: { className: "hidden whitespace-nowrap text-right tabular-nums sm:table-cell" },
            header: (context) => renderComponent(DataTableHeader, { name: "Energy", subtitle: "kcal / 100 g", align: "right", context }),
            cell: (info) => formatNumber(Number(info.getValue()), 1),
        }),
        // Sorts by how much of the energy is protein.
        columnHelper.display({
            id: "protein",
            enableSorting: true,
            meta: { className: "hidden w-1/4 min-w-40 lg:table-cell" },
            header: (context) => renderComponent(DataTableHeader, { name: "Energy from", subtitle: "protein · carbs · fat", context }),
            cell: (info) => renderComponent(FoodFingerprint, { food: food(info.row.original) }),
        }),
        columnHelper.display({
            id: "__macros",
            enableSorting: false,
            meta: { className: "hidden lg:table-cell" },
            header: () => renderComponent(DataTableHeader, { name: "P · C · F", subtitle: "g / 100 g", align: "right" }),
            cell: (info) => renderComponent(FoodMacrosCell, { food: food(info.row.original) }),
        }),
        columnHelper.display({
            id: "__actions",
            enableSorting: false,
            meta: { className: "w-24" },
            header: () => renderComponent(DataTableHeader, { name: "" }),
            cell: (info) => renderComponent(FoodActionsCell, {
                food: food(info.row.original),
                onEdit: () => onEdit(food(info.row.original)),
                onDelete: () => onDelete(food(info.row.original)),
            }),
        }),
    ]);

    function selectSorting(next: DataTableSorting): void {
        onSort(next.id === null ? DEFAULT_FOOD_SORT : { column: next.id as FoodSortColumn, desc: next.desc });
    }

    const pageCount = $derived(Math.max(1, Math.ceil(total / pageSize)));
    const pagination = $derived({ pageIndex: page - 1, pageSize, rowCount: total, pageCount });
    const showingStart = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1);
    const showingEnd = $derived(Math.min(page * pageSize, total));
</script>

<section class="stor-panel" aria-label="Food library">
    <DataTable
        {columns}
        data={foods as unknown as Record<string, unknown>[]}
        {pagination}
        sorting={{ id: sort.column, desc: sort.desc }}
        onSortingChange={selectSorting}
        isLoading={loading}
        variant="quiet"
        label="Food library"
        emptyContent={empty}
        testId="food-table"
        scrollTestId="food-table-scroll"
    />
    {#if total > 0}
        <DataTablePagination
            currentPage={page}
            totalPages={pageCount}
            totalRows={total}
            {pageSize}
            pageSizes={FOOD_PAGE_SIZES}
            {showingStart}
            {showingEnd}
            onSelectPage={onPage}
            onSelectPageSize={onPageSize}
        />
    {/if}
</section>
