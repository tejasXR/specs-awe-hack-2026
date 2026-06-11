/**
 * Pure grid math for the Zappy-Board breadboard — cell (column, row) → local
 * position relative to the breadboard origin transform.
 *
 * Conventions (agreed for this project):
 *  - The breadboard origin transform's pivot sits at hole A1.
 *  - +column (A → J) runs along local X; +row (1 → 64) runs along local Z.
 *  - Rotation/placement of the board is handled outside — everything here is
 *    local space, so it follows the origin wherever it goes.
 *  - A 2.5 mm trench gap sits between the E and F banks.
 *  - Lens Studio world units are centimeters; all config values are in cm.
 */

export const BREADBOARD_COLUMNS = "ABCDEFGHIJ";

export const HOLE_PITCH_CM: number = 0.254;

export const BANK_GAP_CM: number = 0.25;

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

const ROW_MIN = 1;
const ROW_MAX = 64;
const FIRST_FAR_BANK_INDEX = 5; // column F — first column past the trench

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
function cellToLocalPosition(cell: BreadboardCell, hoverOffset: number): vec3 {
  const columnIndex = columnToIndex(cell.column);

  let x = columnIndex * HOLE_PITCH_CM;
  if (columnIndex >= FIRST_FAR_BANK_INDEX) {
    x += BANK_GAP_CM;
  }

  const z = (cell.row - 1) * HOLE_PITCH_CM;

  return new vec3(x, hoverOffset, z);
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
