/**
 * Pure grid math for the Zappy-Board breadboard — cell (column, row) → local
 * position relative to the breadboard origin transform.
 *
 * Conventions (agreed for this project):
 *  - The breadboard origin transform's pivot sits at hole A1 (top-left).
 *  - +column (A → J) runs along local +Z; +row (1 → 64) runs along local -X;
 *    +Y points out of the holes (hover lifts content off the surface).
 *  - Rotation/placement of the board is handled outside — everything here is
 *    local space, so it follows the origin wherever it goes.
 *  - A 2.5 mm trench gap sits between the E and F banks.
 *  - Lens Studio world units are centimeters; all config values are in cm.
 */

export const BREADBOARD_COLUMNS = "ABCDEFGHIJ";
export const HOLE_PITCH_CM: number = 0.254;
export const BANK_GAP_CM: number = 0.58;

const ROW_MIN = 1;
const ROW_MAX = 64;
const FIRST_FAR_BANK_INDEX = 5; // column F — first column past the trench

export type BreadboardColumn =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J";

export interface BreadboardCell {
  column: BreadboardColumn;
  row: number; // 1..64
}

/** Rows reserved for the LED light-show build area. */
export const PLAYGROUND_BOUNDS = {
  firstRow: 10,
  lastRow: 40,
} as const;

export interface BreadboardGridConfig {
  /** Center-to-center hole spacing, in cm (standard 0.1" = 0.254 cm). */
  holePitchCm: number;
  /** Extra gap between the E and F banks (the center trench), in cm. */
  bankGapCm: number;
  /** Lift above the board surface so content doesn't clip into it, in cm. */
  hoverOffsetCm: number;
}

export type PowerRail = "near-plus" | "near-minus" | "far-plus" | "far-minus";

export const RAIL_Z_OFFSET_CM: Record<PowerRail, number> = {
  "near-minus": -1,
  "near-plus": -1.15,
  "far-minus": 4.05,
  "far-plus": 3.8,
};

// Human-readable rail names — kept beside RAIL_Z_OFFSET_CM so polarity stays a
// single source of truth: if you swap an edge's +/− offsets, update both here.
export const RAIL_LABEL: Record<PowerRail, string> = {
  "near-plus": "+ power rail (near)",
  "far-plus": "+ power rail (far)",
  "near-minus": "− ground rail (near)",
  "far-minus": "− ground rail (far)",
};

export function columnToIndex(column: BreadboardColumn): number {
  return BREADBOARD_COLUMNS.indexOf(column);
}

export function isValidCell(cell: BreadboardCell): boolean {
  return (
    columnToIndex(cell.column) >= 0 &&
    Number.isInteger(cell.row) &&
    cell.row >= ROW_MIN &&
    cell.row <= ROW_MAX
  );
}

export function isWithinPlayground(cell: BreadboardCell): boolean {
  return (
    isValidCell(cell) &&
    cell.row >= PLAYGROUND_BOUNDS.firstRow &&
    cell.row <= PLAYGROUND_BOUNDS.lastRow
  );
}

/**
 * Cell → position local to the breadboard origin (pivot = hole A1).
 * Assumes a valid cell — validate with isWithinPlayground first.
 */
export function cellToLocalPosition(
  cell: BreadboardCell,
  hoverOffset: number,
): vec3 {
  const columnIndex = columnToIndex(cell.column);

  // Columns (A → J) run along +Z; the center trench adds a gap past column E.
  let columnOffset = columnIndex * HOLE_PITCH_CM;
  if (columnIndex >= FIRST_FAR_BANK_INDEX) {
    columnOffset += BANK_GAP_CM;
  }

  // Rows (1 → 64) run along -X; hover lifts out of the holes along +Y.
  const rowOffset = (cell.row - 1) * HOLE_PITCH_CM;

  return new vec3(-rowOffset, hoverOffset, columnOffset);
}

/**
 * Cell → world position, given the breadboard origin transform (pivot = A1).
 * Honors the origin's position and rotation at the moment it's called.
 */
export function cellToWorldPosition(
  cell: BreadboardCell,
  hoverOffset: number,
  breadboardOrigin: Transform,
): vec3 {
  return breadboardOrigin
    .getWorldTransform()
    .multiplyPoint(cellToLocalPosition(cell, hoverOffset));
}

export function isBreadboardColumn(value: string): value is BreadboardColumn {
  return BREADBOARD_COLUMNS.indexOf(value) >= 0;
}

export function isPowerRail(value: string): value is PowerRail {
  return value in RAIL_Z_OFFSET_CM;
}

export function railToLocalPosition(
  rail: PowerRail,
  row: number,
  hoverOffset: number,
): vec3 {
  const rowOffset = (row - 1) * HOLE_PITCH_CM;
  return new vec3(-rowOffset, hoverOffset, RAIL_Z_OFFSET_CM[rail]);
}

export function railToWorldPosition(
  rail: PowerRail,
  row: number,
  hoverOffset: number,
  breadboardOrigin: Transform,
): vec3 {
  return breadboardOrigin
    .getWorldTransform()
    .multiplyPoint(railToLocalPosition(rail, row, hoverOffset));
}
