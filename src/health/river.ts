/**
 * Geometry for the day river: two gutters beside the log draw a running total
 * that steps sideways at each entry. Every timeline row owns one slice of each
 * gutter, so slices are drawn in a 100 × 100 box and meet at the row edges.
 */

/** Where the running total sits on a row: before and after it, and the usual pace at its time. */
export interface RiverAnchor {
    before: number;
    after: number;
    /** The usual total at this row's time; null when there is no usual pace to draw. */
    usual: number | null;
}

/** One row's slice of a gutter, every position as a share of the gutter (0–100) from its centre line. */
export interface RiverCell {
    before: number;
    after: number;
    /** Where the usual pace enters the slice, crosses its middle, and leaves; null without one. */
    usual: { enter: number; at: number; leave: number } | null;
    /** The last slice: the line stops at its middle, where the total is named. */
    end: boolean;
}

/** The value at the far edge of a gutter: room for the target and for whatever was reached. */
export function riverScale(target: number, ...totals: number[]): number {
    const largest = Math.max(target, ...totals, 0);
    return largest > 0 ? largest * 1.08 : 1;
}

export function riverPercent(value: number, scale: number): number {
    return Math.min(100, Math.max(0, (value / scale) * 100));
}

/**
 * Slices for a run of rows. The usual pace is a straight line through each
 * row's middle, so neighbouring slices share the value where they meet.
 */
export function riverCells(anchors: readonly RiverAnchor[], scale: number): RiverCell[] {
    const percent = (value: number): number => riverPercent(value, scale);
    return anchors.map((anchor, index) => {
        const last = index === anchors.length - 1;
        let usual: RiverCell['usual'] = null;
        if (anchor.usual !== null) {
            const at = percent(anchor.usual);
            const previous = anchors[index - 1]?.usual;
            const next = anchors[index + 1]?.usual;
            // The day starts at zero; a missing neighbour keeps the line level.
            const enter = index === 0 ? 0 : previous === null || previous === undefined ? at : (percent(previous) + at) / 2;
            const leave = next === null || next === undefined ? at : (at + percent(next)) / 2;
            usual = { enter, at, leave };
        }
        return { before: percent(anchor.before), after: percent(anchor.after), usual, end: last };
    });
}

/** The stepped line through a slice, measured from a centre line at `origin` (100 for a left gutter, 0 for a right one). */
export function riverPaths(cell: RiverCell, side: 'left' | 'right'): { line: string; area: string; usual: string } {
    const x = (share: number): number => (side === 'left' ? 100 - share : share);
    const origin = side === 'left' ? 100 : 0;
    const before = x(cell.before);
    const after = x(cell.after);
    const bottom = cell.end ? 50 : 100;
    const line = `M${before} 0V50H${after}${cell.end ? '' : 'V100'}`;
    const area = `M${origin} 0H${before}V50H${after}V${bottom}H${origin}Z`;
    let usual = '';
    if (cell.usual) {
        const path = `M${x(cell.usual.enter)} 0L${x(cell.usual.at)} 50`;
        usual = cell.end ? path : `${path}L${x(cell.usual.leave)} 100`;
    }
    return { line, area, usual };
}
