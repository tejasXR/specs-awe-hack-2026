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
  powerSwitchToLocalPosition,
  RAIL_LABEL,
  railToLocalPosition,
} from "./BreadboardGrid";
import { InstructionPrompt } from "./InstructionPrompt";
import { MusicController } from "../MusicController";
import { MenuConsole } from "../UI/MenuConsole";
import { InstructionalLine } from "../InstructionalLine";

export interface InstructionStepEvent {
  instruction: InstructionDefinition;
  currentIndex: number;
  totalCount: number;
}

@typedef
export class InstructionDefinition {
  @ui.label("Instruction Text")
  @input
  title!: string;

  @input
  @widget(new TextAreaWidget())
  description: string = "";

  @input
  @widget(new TextAreaWidget())
  zappyTextBox: string = "";

  @input
  primaryButtonText!: string;

  @input
  secondaryButtonText!: string;

  @input
  tertiaryButtonText!: string;

  @ui.separator
  @ui.label("Lesson Settings")
  @input
  isCheckpoint: boolean = false;

  @ui.separator
  @ui.label("Power Switch")
  @input
  @hint("Point this step's callout at the power switch (I-64); overrides cell/rail settings")
  pointToPower: boolean = false;

  @ui.separator
  @ui.label("Breadboard Cell Settings")
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

// Headroom over the max endpoints a single step draws (start + optional end);
// matches the previous MAX_LINES so behavior is unchanged.
const LINE_POOL_SIZE = 3;

/**
 * Owns an ordered queue of build instructions. Each step updates the shared
 * InstructionPrompt's text and drives a pool of Line callouts pointing from the
 * panel anchor to the step's breadboard cells (text presentation lives in
 * InstructionPrompt; line rendering/tracking lives in Line).
 *
 * Advancing is driven from the outside (Zappy, a pinch button, a future
 * placement detector) via next() / previous().
 */
@component
export class InstructionsController extends BaseScriptComponent {
  @input
  musicController!: MusicController;

  @input
  mainTrack!: AudioTrackAsset;

  @input
  mainTrackVolume!: number;

  @input
  @hint(
    "Transform whose pivot sits at breadboard hole A1 — prompts spawn as its children",
  )
  breadboardOrigin!: SceneObject;

  @input
  onboardingController!: OnboardingController;

  @input
  @hint("Menu buttons that drive step navigation")
  menuConsole!: MenuConsole;

  @input
  @hint("The single InstructionPrompt living in the scene")
  instructionPrompt!: InstructionPrompt;

  @ui.separator
  @ui.label("Callout Lines")
  @input
  @hint("Line prefab pooled for callouts (must carry a Line component)")
  linePrefab!: ObjectPrefab;

  @input
  @hint("Parent for instantiated Line instances")
  linePoolParent!: SceneObject;

  @input
  @hint("World anchor every callout line starts from (the prompt panel)")
  calloutStartAnchor!: SceneObject;

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
  private _currentIndex: number = NO_STEP;

  // Pooled callout lines, lazily built on first step (so breadboardOrigin and
  // the prefab are known). Each line's own markers are reparented to track the
  // panel anchor (start) and the board (end) — no separate anchor objects.
  private _linePool: InstructionalLine[] = [];

  private _unsubscribeFromOnboarding?: unsubscribe;
  private _unsubscribeFromPrimary?: unsubscribe;
  private _unsubscribeFromSecondary?: unsubscribe;
  private _unsubscribeFromTertiary?: unsubscribe;

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
    // A power-switch step points at a fixed fixture, not a build cell — describe
    // it as such so the check-work transcript/logs don't render a stale cell.
    if (definition.pointToPower) {
      let powerLine = definition.title + " (at the power switch)";
      if (definition.description) {
        powerLine += `: ${definition.description}`;
      }
      return powerLine;
    }

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

    // Menu buttons drive navigation: primary -> next, secondary -> previous.
    if (!isNull(this.menuConsole)) {
      this._unsubscribeFromPrimary = this.menuConsole.onPrimaryPressed.add(() =>
        this.onMenuPrimaryPressed(),
      );
      this._unsubscribeFromSecondary = this.menuConsole.onSecondaryPressed.add(
        () => this.onMenuSecondaryPressed(),
      );
      this._unsubscribeFromTertiary = this.menuConsole.onTertiaryPressed.add(
        () => this.onMenuTertiaryPressed(),
      );
    }

    // if (this.autoStart && this.instructionDefinitions.length > 0) {
    //   this.startSequence();
    // }
  }

  private onDestroy(): void {
    this._unsubscribeFromOnboarding?.();
    this._unsubscribeFromPrimary?.();
    this._unsubscribeFromSecondary?.();
    this._unsubscribeFromTertiary?.();
  }

  /** Primary menu button: advance to the next instruction. */
  private onMenuPrimaryPressed(): void {
    this.nextInSequence();
  }

  /** Secondary menu button: step back to the previous instruction. */
  private onMenuSecondaryPressed(): void {
    this.previousInSequence();
  }

  // TEJAS: tertiary action not yet defined — placeholder for future wiring.
  private onMenuTertiaryPressed(): void {}

  /** The onboarding flow finished — kick off the build instructions. */
  private onOnboardingCompleted(): void {
    this.startSequence();
  }

  startSequence(): void {
    if (this.instructionDefinitions.length === 0) {
      return;
    }

    this.musicController.play(this.mainTrack, this.mainTrackVolume);

    this.moveToStep(0);
  }

  nextInSequence(): void {
    if (this._currentIndex === NO_STEP) {
      return;
    }
    if (this._currentIndex + 1 >= this.instructionDefinitions.length) {
      this.hideAllLines();
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
    this.hideAllLines();
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

    this.configureLines(localTargets);

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
   * Origin-LOCAL endpoint positions for a placement step. configureLines writes
   * these onto cell anchors parented to the breadboard origin, so the callout
   * ends follow the board's position/rotation directly. Not called for
   * checkpoints, which draw no line.
   */
  private buildLineTargets(definition: InstructionDefinition): vec3[] {
    // pointToPower overrides cell/rail settings: a single callout to the power
    // switch (I-64), as a board-local target like every other endpoint.
    if (definition.pointToPower) {
      return [powerSwitchToLocalPosition(this.hoverOffsetCm)];
    }

    const targets: vec3[] = [this.resolveStartLocal(definition)];

    const endLocal = this.resolveEndLocal(definition);
    if (endLocal !== null) {
      targets.push(endLocal);
    }

    return targets;
  }

  /**
   * Drive the callout pool from a step's board-LOCAL endpoint targets. Each
   * target points one line's end at that board-local position (its start was
   * attached to the panel anchor at pool creation); extra pooled lines are
   * hidden. Checkpoints pass an empty list, hiding every line.
   */
  private configureLines(localTargets: vec3[]): void {
    this.ensureLinePool();

    for (let i = 0; i < this._linePool.length; i++) {
      if (i < localTargets.length) {
        this._linePool[i].attachEnd(this.breadboardOrigin, localTargets[i]);
        this._linePool[i].show();
      } else {
        this._linePool[i].hide();
      }
    }
  }

  private hideAllLines(): void {
    for (const line of this._linePool) {
      line.hide();
    }
  }

  /**
   * Lazily build the line pool. Each line's start marker is attached to the
   * shared panel anchor once here; its end is repointed per step by
   * configureLines.
   */
  private ensureLinePool(): void {
    if (this._linePool.length > 0) {
      return;
    }

    for (let i = 0; i < LINE_POOL_SIZE; i++) {
      const lineObject = this.linePrefab.instantiate(this.linePoolParent);
      const line = lineObject.getComponent(
        InstructionalLine.getTypeName(),
      ) as unknown as InstructionalLine;
      if (isNull(line)) {
        throw new Error(
          "InstructionsController: linePrefab is missing an InstructionalLine component",
        );
      }
      line.hide();
      line.attachStart(this.calloutStartAnchor);
      this._linePool.push(line);
    }
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
