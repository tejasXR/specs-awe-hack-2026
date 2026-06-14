import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { OnboardingController } from "../OnboardingController";
import {
  BreadboardCell,
  cellToLocalPosition,
  isBreadboardColumn,
  isPowerRail,
  isWithinPlayground,
  PowerRail,
  RAIL_LABEL,
  railToLocalPosition,
} from "./BreadboardGrid";
import { InstructionPrompt } from "./InstructionPrompt";

export interface InstructionStepEvent {
  instruction: InstructionDefinition;
  currentIndex: number;
  totalCount: number;
}

@typedef
export class InstructionDefinition {
  @input
  title!: string;

  @input
  @widget(new TextAreaWidget())
  description: string = "";

  @input
  @hint(
    "A recap/'check your work' step — shows title + description, draws no callout line",
  )
  isCheckpoint: boolean = false;

  @input
  @hint("Start from a power rail instead of a grid column")
  startOnRail: boolean = false;

  @input
  @showIf("startOnRail", false)
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("A", "A"),
      new ComboBoxItem("B", "B"),
      new ComboBoxItem("C", "C"),
      new ComboBoxItem("D", "D"),
      new ComboBoxItem("E", "E"),
      new ComboBoxItem("F", "F"),
      new ComboBoxItem("G", "G"),
      new ComboBoxItem("H", "H"),
      new ComboBoxItem("I", "I"),
      new ComboBoxItem("J", "J"),
    ]),
  )
  columnStart: string = "A";

  @input
  @showIf("startOnRail", true)
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("+ near", "near-plus"),
      new ComboBoxItem("+ far", "far-plus"),
      new ComboBoxItem("− near", "near-minus"),
      new ComboBoxItem("− far", "far-minus"),
    ]),
  )
  startRail: string = "near-plus";

  @input
  @widget(new SliderWidget(1, 32, 1)) // playground rows; also the rail X-sample
  rowStart: number = 1;

  @input
  useEndPin: boolean = false;

  @input
  @showIf("useEndPin", true)
  @hint("End on a power rail instead of a grid column")
  endOnRail: boolean = false;

  // showIf gates on endOnRail (not useEndPin) so the rail/column pickers swap
  // cleanly. When useEndPin is off, columnEnd may still render (endOnRail
  // defaults false) — harmless, resolveEndLocal ignores it unless useEndPin.
  @input
  @allowUndefined
  @showIf("endOnRail", false)
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("A", "A"),
      new ComboBoxItem("B", "B"),
      new ComboBoxItem("C", "C"),
      new ComboBoxItem("D", "D"),
      new ComboBoxItem("E", "E"),
      new ComboBoxItem("F", "F"),
      new ComboBoxItem("G", "G"),
      new ComboBoxItem("H", "H"),
      new ComboBoxItem("I", "I"),
      new ComboBoxItem("J", "J"),
    ]),
  )
  columnEnd: string | undefined;

  @input
  @allowUndefined
  @showIf("endOnRail", true)
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("+ near", "near-plus"),
      new ComboBoxItem("+ far", "far-plus"),
      new ComboBoxItem("− near", "near-minus"),
      new ComboBoxItem("− far", "far-minus"),
    ]),
  )
  endRail: string | undefined;

  @input
  @allowUndefined
  @showIf("useEndPin", true)
  @widget(new SliderWidget(1, 32, 1)) // playground rows; also the rail X-sample
  rowEnd: number | undefined;
}

const NO_STEP = -1;

/**
 * Owns an ordered queue of build instructions, each backed by its own
 * "Instruction Prompt" instance parented to the breadboard origin at its
 * cell. Navigation hides the panel being left and shows the one being moved
 * to — all presentation (tweens, text) lives in InstructionPrompt.
 *
 * Advancing is driven from the outside (Zappy, a pinch button, a future
 * placement detector) via next() / previous().
 */
@component
export class InstructionsController extends BaseScriptComponent {
  @ui.separator
  @ui.label("References")
  @input
  @hint(
    "Transform whose pivot sits at breadboard hole A1 — prompts spawn as its children",
  )
  breadboardOrigin!: SceneObject;

  @input
  onboardingController!: OnboardingController;

  @input
  @hint("The single InstructionPrompt living in the scene")
  instructionPrompt!: InstructionPrompt;

  @input
  @hint(
    "Lift above the board surface so the prompt doesn't clip into it, in cm",
  )
  hoverOffsetCm: number = 1.0;

  @ui.separator
  @ui.label("Sequence")
  @input
  instructionDefinitions: InstructionDefinition[] = [];

  @ui.separator
  @ui.label("Behavior")
  @input
  @hint("Show the first queued instruction as soon as the lens starts")
  autoStart: boolean = false;

  private _currentIndex: number = NO_STEP;

  private _unsubscribeFromOnboarding?: unsubscribe;

  private readonly onStepChangedEvent = new Event<InstructionStepEvent>();

  readonly onStepChanged: PublicApi<InstructionStepEvent> =
    this.onStepChangedEvent.publicApi();

  private readonly onSequenceCompletedEvent = new Event<void>();

  readonly onSequenceCompleted: PublicApi<void> =
    this.onSequenceCompletedEvent.publicApi();

  private readonly onCheckpointReachedEvent = new Event<number>();

  /** Fires when a checkpoint step is shown, carrying its step index. */
  readonly onCheckpointReached: PublicApi<number> =
    this.onCheckpointReachedEvent.publicApi();

  get currentIndex(): number {
    return this._currentIndex;
  }

  get stepCount(): number {
    return this.instructionDefinitions.length;
  }

  /** The instruction currently being shown, or null before the sequence starts. */
  getCurrentInstruction(): InstructionDefinition | null {
    if (
      this._currentIndex < 0 ||
      this._currentIndex >= this.instructionDefinitions.length
    ) {
      return null;
    }
    return this.instructionDefinitions[this._currentIndex];
  }

  /**
   * Every instruction from the first through the current one (inclusive) — the
   * build state a "check my work" pass should validate against. Empty before
   * the sequence starts.
   */
  getCompletedInstructions(): InstructionDefinition[] {
    if (this._currentIndex < 0) {
      return [];
    }
    return this.instructionDefinitions
      .slice(0, this._currentIndex + 1)
      .filter((def) => !def.isCheckpoint);
  }

  /**
   * Render an instruction as a single human/electrical line for prompts and
   * logs, e.g. "Place the resistor (from + power rail (near) @ row 10 to A12)".
   */
  describeInstruction(definition: InstructionDefinition): string {
    const start = definition.startOnRail
      ? this.railLabel(definition.startRail) + " @ row " + definition.rowStart
      : this.cellLabel(definition.columnStart, definition.rowStart);

    let line = definition.title;

    const end = this.describeEnd(definition);
    line += end !== null ? ` (from ${start} to ${end})` : ` (at ${start})`;

    if (definition.description) {
      line += `: ${definition.description}`;
    }
    return line;
  }

  private describeEnd(definition: InstructionDefinition): string | null {
    if (!definition.useEndPin) {
      return null;
    }
    if (definition.endOnRail) {
      if (definition.endRail === undefined) {
        return null;
      }
      const railRow = definition.rowEnd ?? definition.rowStart;
      return this.railLabel(definition.endRail) + " @ row " + railRow;
    }
    if (definition.columnEnd === undefined || definition.rowEnd === undefined) {
      return null;
    }
    return this.cellLabel(definition.columnEnd, definition.rowEnd);
  }

  private cellLabel(column: string, row: number): string {
    return `${column}${row}`;
  }

  // Valid rails resolve via the shared RAIL_LABEL map (single source of truth in
  // BreadboardGrid); an unrecognized string echoes back, matching the old default.
  private railLabel(rail: string): string {
    return isPowerRail(rail) ? RAIL_LABEL[rail] : rail;
  }

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    // Consumer owns its trigger: we start ourselves when onboarding completes,
    // so OnboardingController stays ignorant of what follows it.
    if (!isNull(this.onboardingController)) {
      this._unsubscribeFromOnboarding =
        this.onboardingController.onCompleted.add(() =>
          this.onOnboardingCompleted(),
        );
    }

    if (this.autoStart && this.instructionDefinitions.length > 0) {
      this.startSequence();
    }
  }

  private onDestroy(): void {
    this._unsubscribeFromOnboarding?.();
  }

  /** The onboarding flow finished — kick off the build instructions. */
  private onOnboardingCompleted(): void {
    this.startSequence();
  }

  startSequence(): void {
    if (this.instructionDefinitions.length === 0) {
      return;
    }
    this.moveToStep(0);
  }

  nextInSequence(): void {
    if (this._currentIndex === NO_STEP) {
      return;
    }
    if (this._currentIndex + 1 >= this.instructionDefinitions.length) {
      this.instructionPrompt.hide();
      this._currentIndex = NO_STEP;
      this.onSequenceCompletedEvent.invoke(undefined);
      return;
    }
    this.moveToStep(this._currentIndex + 1);
  }

  previousInSequence(): void {
    if (this._currentIndex > 0) {
      this.moveToStep(this._currentIndex - 1);
    }
  }

  resetSequence(): void {
    this.instructionPrompt.hide();
    this._currentIndex = NO_STEP;
  }

  private moveToStep(index: number): void {
    const instructionDefinition = this.instructionDefinitions[index];

    // Checkpoints are recap steps: text only, no callout line.
    const localTargets = instructionDefinition.isCheckpoint
      ? []
      : this.buildLineTargets(instructionDefinition);

    this.instructionPrompt.setStepText(index, this.stepCount);

    this.instructionPrompt.setTitleAndDescription(
      instructionDefinition.title,
      instructionDefinition.description,
    );

    this.instructionPrompt.setLineTargets(this.breadboardOrigin, localTargets);

    this.instructionPrompt.show();

    this._currentIndex = index;
    this.onStepChangedEvent.invoke({
      instruction: instructionDefinition,
      currentIndex: index,
      totalCount: this.instructionDefinitions.length,
    });

    // A checkpoint is still a shown step (onStepChanged fired above); this is the
    // additional, more-specific signal for "check your work" logic.
    if (instructionDefinition.isCheckpoint) {
      this.onCheckpointReachedEvent.invoke(index);
    }
  }

  /**
   * Origin-LOCAL endpoint positions for a placement step. The prompt parents its
   * lines to the breadboard origin, so these follow the board's position/rotation
   * directly. Not called for checkpoints, which draw no line.
   */
  private buildLineTargets(definition: InstructionDefinition): vec3[] {
    const targets: vec3[] = [this.resolveStartLocal(definition)];

    const endLocal = this.resolveEndLocal(definition);
    if (endLocal !== null) {
      targets.push(endLocal);
    }

    return targets;
  }

  // TEJAS: Unused since we have one prompt, but still keeping in case we need it
  private hideCurrentPrompt(): void {
    if (this._currentIndex < 0) {
      return;
    }
    this.instructionPrompt.hide();
  }

  /**
   * Resolve a definition's start endpoint to an origin-local position. The
   * startOnRail flag is the discriminator: a rail start reuses rowStart as its
   * long-axis sample, a grid start uses columnStart + rowStart.
   */
  private resolveStartLocal(definition: InstructionDefinition): vec3 {
    if (definition.startOnRail) {
      return railToLocalPosition(
        this.toRail(definition.startRail),
        definition.rowStart,
        this.hoverOffsetCm,
      );
    }

    const cellStart = this.toBreadboardCell({
      column: definition.columnStart,
      row: definition.rowStart,
    });
    return cellToLocalPosition(cellStart, this.hoverOffsetCm);
  }

  /**
   * Resolve a definition's optional end endpoint to an origin-local position,
   * or null when there's no end. Mirrors resolveStartLocal: endOnRail picks a
   * rail (sampled at rowEnd, falling back to rowStart), otherwise a grid cell.
   */
  private resolveEndLocal(definition: InstructionDefinition): vec3 | null {
    if (!definition.useEndPin) {
      return null;
    }

    if (definition.endOnRail) {
      if (definition.endRail === undefined) {
        return null;
      }
      const railRow = definition.rowEnd ?? definition.rowStart;
      return railToLocalPosition(
        this.toRail(definition.endRail),
        railRow,
        this.hoverOffsetCm,
      );
    }

    if (definition.columnEnd === undefined || definition.rowEnd === undefined) {
      return null;
    }
    const cellEnd = this.toBreadboardCell({
      column: definition.columnEnd,
      row: definition.rowEnd,
    });
    return cellToLocalPosition(cellEnd, this.hoverOffsetCm);
  }

  private toRail(value: string): PowerRail {
    if (!isPowerRail(value)) {
      throw new Error(
        `InstructionsController: invalid rail "${value}" — expected near/far + plus/minus`,
      );
    }
    return value;
  }

  /**
   * Inspector widgets already constrain column (A–J) and row (playground
   * slider), so a failure here means a misconfigured definition — fail loudly
   * rather than hand an invalid cell to the grid math.
   */
  private toBreadboardCell(definition: {
    column: string;
    row: number;
  }): BreadboardCell {
    if (!isBreadboardColumn(definition.column)) {
      throw new Error(
        `InstructionsController: invalid column "${definition.column}" — expected A–J`,
      );
    }

    const cell: BreadboardCell = {
      column: definition.column,
      row: definition.row,
    };

    if (!isWithinPlayground(cell)) {
      throw new Error(
        `InstructionsController: cell ${cell.column}${cell.row} is outside the playground rows`,
      );
    }

    return cell;
  }
}
