import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import {
  BreadboardCell,
  cellToWorldPosition,
  isBreadboardColumn,
  isWithinPlayground,
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
  title: string;

  @input
  @widget(new TextAreaWidget())
  description: string = "";

  @input
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
  @widget(new SliderWidget(10, 40, 1)) // playground rows only
  rowStart: number = 10;

  @input
  useEndPin: boolean = false;

  @input
  @allowUndefined
  @showIf("useEndPin", true)
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
  @showIf("useEndPin", true)
  @widget(new SliderWidget(10, 40, 1))
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
  @hint("The single InstructionPrompt living in the scene")
  instructionPrompt!: InstructionPrompt;

  @input
  instructionPromptLocationObj!: SceneObject;

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

  private readonly onStepChangedEvent = new Event<InstructionStepEvent>();

  readonly onStepChanged: PublicApi<InstructionStepEvent> =
    this.onStepChangedEvent.publicApi();

  private readonly onSequenceCompletedEvent = new Event<void>();

  readonly onSequenceCompleted: PublicApi<void> =
    this.onSequenceCompletedEvent.publicApi();

  get currentIndex(): number {
    return this._currentIndex;
  }

  get stepCount(): number {
    return this.instructionDefinitions.length;
  }

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    if (this.autoStart && this.instructionDefinitions.length > 0) {
      this.startSequence();
    }
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
    const cellStart = this.toBreadboardCell({
      column: instructionDefinition.columnStart,
      row: instructionDefinition.rowStart,
    });

    const targetPositions: vec3[] = [];
    targetPositions.push(
      cellToWorldPosition(
        cellStart,
        this.hoverOffsetCm,
        this.breadboardOrigin.getTransform(),
      ),
    );

    if (
      instructionDefinition.useEndPin &&
      instructionDefinition.columnEnd !== undefined &&
      instructionDefinition.rowEnd !== undefined
    ) {
      const cellEndData = this.toBreadboardCell({
        column: instructionDefinition.columnEnd,
        row: instructionDefinition.rowEnd,
      });
      targetPositions.push(
        cellToWorldPosition(
          cellEndData,
          this.hoverOffsetCm,
          this.breadboardOrigin.getTransform(),
        ),
      );
    }

    this.instructionPrompt.setup(
      instructionDefinition.title,
      instructionDefinition.description,
      this.instructionPromptLocationObj.getTransform().getWorldPosition(),
      targetPositions,
    );

    this.instructionPrompt.show();

    this._currentIndex = index;
    this.onStepChangedEvent.invoke({
      instruction: instructionDefinition,
      currentIndex: index,
      totalCount: this.instructionDefinitions.length,
    });
  }

  // TEJAS: Unused since we have one prompt, but still keeping in case we need it
  private hideCurrentPrompt(): void {
    if (this._currentIndex < 0) {
      return;
    }
    this.instructionPrompt.hide();
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
