import type { InstructionDefinition } from "./InstructionsController";

/**
 * The build-state surface Zappy needs to ground a response: where the user is
 * and what they've done so far. InstructionsController satisfies this; the
 * persona depends on this abstraction (not the concrete controller) so the
 * context source stays swappable and testable.
 *
 * Type-only on both sides — this imports InstructionDefinition as a type and
 * InstructionsController imports this as a type for `implements`, so neither
 * creates a runtime import cycle.
 */
export interface BuildContextProvider {
  /** Index of the current step, or -1 before the sequence starts. */
  readonly currentIndex: number;

  /** Total number of steps in the sequence. */
  readonly stepCount: number;

  /** The instruction currently being shown, or null before the sequence starts. */
  getCurrentInstruction(): InstructionDefinition | null;

  /** Every non-checkpoint instruction from the first through the current one. */
  getCompletedInstructions(): InstructionDefinition[];

  /** Render an instruction as a single human/electrical line. */
  describeInstruction(definition: InstructionDefinition): string;
}
