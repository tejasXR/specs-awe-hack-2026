import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import type { BuildContextProvider } from "./BuildContextProvider";
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
import { SpaceSetup } from "../SpaceSetup";
import { DividerKind } from "../SpaceSetupDivider";

export interface InstructionStepEvent {
  instruction: InstructionDefinition;
  currentIndex: number;
  totalCount: number;
}

// Sentinel columnStart value: the step shows its title/description but draws no
// callout line. Lets a designer author a text-only step (an intro/explainer)
// without it pointing at a breadboard cell.
//
// MUST match the literal in the columnStart ComboBoxItem below — Lens Studio's
// inspector-decorator parser only reads string literals, not identifiers, so the
// widget can't reference this constant directly.
const COLUMN_NONE = "None";

@typedef
export class InstructionDefinition {
  @input
  @ui.group_start("Instruction Data")
  title!: string;

  @input
  @widget(new TextAreaWidget())
  description: string = "";

  @input
  primaryButtonText!: string;

  @input
  secondaryButtonText!: string;

  @input
  tertiaryButtonText!: string;

  @ui.label("Overwriting Behavior")
  @input
  isCheckpoint: boolean = false;

  @input
  @hint(
    "Point this step's callout at the power switch (I-64); overrides cell/rail settings",
  )
  pointToPower: boolean = false;

  @input
  @hint(
    "Point this step's callout at a Space Setup divider; overrides power/cell/rail settings",
  )
  pointToDivider: boolean = false;

  @input
  @showIf("pointToDivider", true)
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Breadboard", "breadboard"),
      new ComboBoxItem("Wires", "wires"),
      new ComboBoxItem("LEDs", "leds"),
      new ComboBoxItem("Resistor", "resistors"),
    ]),
  )
  dividerKind: string = "breadboard";

  @ui.label("Breadboard Cell Settings")
  @input
  @hint("Start from a power rail instead of a grid column")
  startOnRail: boolean = false;

  @input
  @showIf("startOnRail", false)
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("None (no line)", "None"), // value MUST equal COLUMN_NONE
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
  @ui.group_end
  rowEnd: number | undefined;
}

const NO_STEP = -1;

// Headroom over the max endpoints a single step draws (start + optional end);
// matches the previous MAX_LINES so behavior is unchanged.
const LINE_POOL_SIZE = 3;

// A callout endpoint resolves to one of two parents: a board-LOCAL offset under
// breadboardOrigin (cells/rails/power), or a live SceneObject anchor on a Space
// Setup divider. The union keeps the two attach paths type-distinct.
type LineTarget =
  | { kind: "boardLocal"; position: vec3 }
  | { kind: "anchor"; anchor: SceneObject };

const assertNever = (value: never): never => {
  throw new Error(`Unhandled LineTarget: ${JSON.stringify(value)}`);
};

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
export class InstructionsController
  extends BaseScriptComponent
  implements BuildContextProvider
{
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
  @hint("Drives the Space Setup dividers a step can point at")
  spaceSetup!: SpaceSetup;

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

  // The divider currently shown for the active step, if any. Tracked so
  // moveToStep can hide the previous step's divider when advancing.
  private _activeDividerKind?: DividerKind;

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

  private readonly onFinalStepEnteredEvent = new Event<void>();

  /**
   * Fires when the last instruction step is *shown* (entered) — not when the
   * sequence is advanced past. The LED-control handoff listens for this so the
   * board comes alive while the final "pinch to illuminate" step is on screen.
   */
  readonly onFinalStepEntered: PublicApi<void> =
    this.onFinalStepEnteredEvent.publicApi();

  private readonly onCheckpointReachedEvent = new Event<number>();

  /** Fires when a checkpoint step is shown, carrying its step index. */
  readonly onCheckpointReached: PublicApi<number> =
    this.onCheckpointReachedEvent.publicApi();

  private readonly onCheckRequestedEvent = new Event<void>();

  /**
   * Fires when the user asks to check their work — the primary menu press while
   * on a checkpoint. The check-work orchestrator listens for this.
   */
  readonly onCheckRequested: PublicApi<void> =
    this.onCheckRequestedEvent.publicApi();

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
   * The completed steps as a numbered list labelled with each step's TRUE
   * 1-based position in the sequence, e.g. "2. Place the resistor (...)\n4.
   * ...". Checkpoints are skipped (they're recaps, not repeatable actions), but
   * the numbering stays absolute — so a number Gemini returns against this list
   * is already the step's index + 1, and goToStep(n - 1) reaches it with no
   * translation.
   */
  describeCompletedStepsNumbered(): string {
    if (this._currentIndex < 0) {
      return "(no steps completed yet)";
    }
    const lines: string[] = [];
    for (let i = 0; i <= this._currentIndex; i++) {
      const def = this.instructionDefinitions[i];
      if (def.isCheckpoint) {
        continue;
      }
      lines.push(`${i + 1}. ${this.describeInstruction(def)}`);
    }
    return lines.length > 0 ? lines.join("\n") : "(no steps completed yet)";
  }

  /**
   * Show an arbitrary step by its 0-based index — the public, bounds-guarded
   * seam over moveToStep that the relative next()/previous() helpers lack.
   * No-ops (and returns false) when the index is out of range.
   */
  goToStep(index: number): boolean {
    if (index < 0 || index >= this.instructionDefinitions.length) {
      print(`[InstructionsController] goToStep: ${index} out of range`);
      return false;
    }
    this.moveToStep(index);
    return true;
  }

  /**
   * Render an instruction as a single human/electrical line for prompts and
   * logs, e.g. "Place the resistor (from + power rail (near) @ row 10 to A12)".
   */
  describeInstruction(definition: InstructionDefinition): string {
    // A divider step points at a Space Setup component, not a build cell —
    // describe it as such so the check-work transcript/logs stay honest.
    if (definition.pointToDivider) {
      let dividerLine = `${definition.title} (at the ${definition.dividerKind} divider)`;
      if (definition.description) {
        dividerLine += `: ${definition.description}`;
      }
      return dividerLine;
    }

    // A power-switch step points at a fixed fixture, not a build cell — describe
    // it as such so the check-work transcript/logs don't render a stale cell.
    if (definition.pointToPower) {
      let powerLine = definition.title + " (at the power switch)";
      if (definition.description) {
        powerLine += `: ${definition.description}`;
      }
      return powerLine;
    }

    // A "None" start column draws no callout — describe it by title/description
    // alone, with no cell/rail location clause to render a phantom "None1".
    if (this.isLinelessColumnStep(definition)) {
      let linelessLine = definition.title;
      if (definition.description) {
        linelessLine += `: ${definition.description}`;
      }
      return linelessLine;
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

  /**
   * A grid-column step whose start is "None": it draws no callout line and has
   * no location to describe. Only meaningful in the cell path — rail starts and
   * the pointToDivider/pointToPower overrides are resolved before this is asked.
   */
  private isLinelessColumnStep(definition: InstructionDefinition): boolean {
    return !definition.startOnRail && definition.columnStart === COLUMN_NONE;
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
  }

  private onDestroy(): void {
    this._unsubscribeFromOnboarding?.();
    this._unsubscribeFromPrimary?.();
    this._unsubscribeFromSecondary?.();
    this._unsubscribeFromTertiary?.();
  }

  /**
   * Primary menu button. On a checkpoint the press means "check my work" —
   * fire onCheckRequested and don't advance; the orchestrator advances past
   * the checkpoint itself once the check passes. Otherwise, advance as usual.
   */
  private onMenuPrimaryPressed(): void {
    const current = this.getCurrentInstruction();
    if (current !== null && current.isCheckpoint) {
      this.onCheckRequestedEvent.invoke(undefined);
      return;
    }
    // The final step is terminal (pinch-to-illuminate) — there's nothing to
    // advance to, so don't let the primary press tear the step down.
    if (this._currentIndex === this.instructionDefinitions.length - 1) {
      return;
    }
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
  }

  startSequence(): void {
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
    const lineTargets: LineTarget[] = instructionDefinition.isCheckpoint
      ? []
      : this.buildLineTargets(instructionDefinition);

    this.instructionPrompt.setStepText(index, this.stepCount);

    this.instructionPrompt.setTitleAndDescription(
      instructionDefinition.title,
      instructionDefinition.description,
    );

    this.instructionPrompt.setButtonLabel(
      instructionDefinition.primaryButtonText,
      instructionDefinition.secondaryButtonText,
      instructionDefinition.tertiaryButtonText,
    );

    this.configureLines(lineTargets);
    this.setActiveDivider(this.resolveStepDividerKind(instructionDefinition));

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

    // Entering the last step is the LED-control handoff cue — fired on enter
    // (not on advance-past), so the board comes alive while the step is shown.
    // Idempotent downstream: re-entering (back-then-forward) is guarded there.
    if (index === this.instructionDefinitions.length - 1) {
      this.onFinalStepEnteredEvent.invoke(undefined);
    }
  }

  /**
   * Endpoint targets for a placement step: board-local offsets (cells/rails/
   * power) parented to the breadboard origin so the callout ends follow the
   * board, or a divider anchor the callout tracks directly. Not called for
   * checkpoints, which draw no line.
   */
  private buildLineTargets(definition: InstructionDefinition): LineTarget[] {
    // pointToDivider overrides everything: a single callout to the Space Setup
    // divider's live anchor (tracked, since the divider animates in/out).
    if (definition.pointToDivider) {
      const anchor = this.resolveDividerAnchor(definition);
      return anchor !== null ? [{ kind: "anchor", anchor }] : [];
    }

    // pointToPower overrides cell/rail settings: a single callout to the power
    // switch (I-64), as a board-local target like every other endpoint.
    if (definition.pointToPower) {
      return [
        {
          kind: "boardLocal",
          position: powerSwitchToLocalPosition(this.hoverOffsetCm),
        },
      ];
    }

    // A "None" start column opts the step out of a callout entirely — a
    // text-only step draws no line (and ignores any end pin).
    if (this.isLinelessColumnStep(definition)) {
      return [];
    }

    const targets: LineTarget[] = [
      { kind: "boardLocal", position: this.resolveStartLocal(definition) },
    ];

    const endLocal = this.resolveEndLocal(definition);
    if (endLocal !== null) {
      targets.push({ kind: "boardLocal", position: endLocal });
    }

    return targets;
  }

  /**
   * Resolve a divider step's target to the divider's live line anchor, or null
   * when Space Setup is unwired or the divider kind has no anchor — in which
   * case the step simply draws no line (logged, not thrown).
   */
  private resolveDividerAnchor(
    definition: InstructionDefinition,
  ): SceneObject | null {
    if (isNull(this.spaceSetup)) {
      print(
        "[InstructionsController] pointToDivider set but spaceSetup is unwired",
      );
      return null;
    }

    const kind = this.toDividerKind(definition.dividerKind);
    const anchor = this.spaceSetup.getDividerLineAnchor(kind);
    if (anchor === undefined) {
      print(`[InstructionsController] no divider anchor for kind "${kind}"`);
      return null;
    }
    return anchor;
  }

  /**
   * Drive the callout pool from a step's endpoint targets. Each target points
   * one line's end at a board-local position or a divider anchor (its start was
   * attached to the panel anchor at pool creation); extra pooled lines are
   * hidden. Checkpoints pass an empty list, hiding every line.
   */
  private configureLines(targets: LineTarget[]): void {
    this.ensureLinePool();

    for (let i = 0; i < this._linePool.length; i++) {
      const line = this._linePool[i];
      if (i < targets.length) {
        this.applyTarget(line, targets[i]);
        line.show();
      } else {
        line.hide();
      }
    }
  }

  /**
   * Point one pooled line's end at a target. Board-local targets attach under
   * breadboardOrigin; anchor targets attach directly to a divider's anchor
   * object. Both redraw per frame: the board can be repositioned and dividers
   * animate, so the endpoint must track live.
   */
  private applyTarget(line: InstructionalLine, target: LineTarget): void {
    switch (target.kind) {
      case "boardLocal":
        line.attachEnd(this.breadboardOrigin, target.position);
        break;
      case "anchor":
        line.attachEnd(target.anchor);
        break;
      default:
        assertNever(target);
    }
    line.setRedrawOnUpdate(true);
  }

  private hideAllLines(): void {
    for (const line of this._linePool) {
      line.hide();
    }
    this.setActiveDivider(undefined);
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

  // Inspector combo constrains dividerKind, so an unexpected value means a
  // misconfigured definition — fail loudly rather than show the wrong divider.
  private toDividerKind(value: string): DividerKind {
    if (
      value === "breadboard" ||
      value === "wires" ||
      value === "leds" ||
      value === "resistors"
    ) {
      return value;
    }
    throw new Error(
      `InstructionsController: invalid divider kind "${value}" — expected breadboard/wires/leds/transistors`,
    );
  }

  /**
   * The divider kind a step shows, or undefined when it shows none. Checkpoints
   * draw nothing, so they never own a divider regardless of the flag.
   */
  private resolveStepDividerKind(
    definition: InstructionDefinition,
  ): DividerKind | undefined {
    if (definition.isCheckpoint || !definition.pointToDivider) {
      return undefined;
    }
    return this.toDividerKind(definition.dividerKind);
  }

  /**
   * Show the given divider and hide the previously shown one, so only the
   * active step's divider is visible. Passing undefined hides the active
   * divider and clears tracking. No-ops when the kind is unchanged.
   */
  private setActiveDivider(kind: DividerKind | undefined): void {
    if (kind === this._activeDividerKind) {
      return;
    }

    if (!isNull(this.spaceSetup)) {
      if (this._activeDividerKind !== undefined) {
        this.spaceSetup.hideDivider(this._activeDividerKind);
      }
      if (kind !== undefined) {
        this.spaceSetup.showDivider(kind);
      }
    }

    this._activeDividerKind = kind;
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
