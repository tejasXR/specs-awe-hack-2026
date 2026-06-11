import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import {
  BreadboardCell,
  cellToWorldPosition,
  isBreadboardColumn,
  isWithinPlayground,
} from "./BreadboardGrid";
import { InstructionPrompt } from "./InstructionPrompt";

export interface InstructionData {
  cell: BreadboardCell;
  prompt: InstructionDefinition;
}

export interface InstructionStepEvent {
  instruction: InstructionData;
  currentIndex: number;
  totalCount: number;
}

@typedef
export class InstructionDefinition {
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
  column: string = "A";

  @input
  @widget(new SliderWidget(10, 40, 1)) // playground rows only
  row: number = 10;

  @input
  title: string = "";

  @input
  @widget(new TextAreaWidget())
  description: string = "";
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

  @ui.separator
  @ui.label("Sequence")
  @input
  instructionDefinitions: InstructionDefinition[] = [];

  @input
  @hint(
    "Lift above the board surface so the prompt doesn't clip into it, in cm",
  )
  hoverOffsetCm: number = 1.0;

  @ui.separator
  @ui.label("Behavior")
  @input
  @hint("Show the first queued instruction as soon as the lens starts")
  autoStart: boolean = false;

  // private _instructionalDatas: InstructionData[] = [];
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

  // queueInstruction(instructionData: InstructionData): boolean {
  //   if (!isWithinPlayground(instructionData.cell)) {
  //     print(
  //       "Rejected: instruction outside playground: " +
  //         instructionData.cell.column +
  //         instructionData.cell.row,
  //     );
  //     return false;
  //   }

  //   this._instructionalDatas.push(instructionData);
  //   return true;
  // }

  // queueInstructions(instructionDatas: InstructionData[]): number {
  //   return instructionDatas.filter((instructionDatas) =>
  //     this.queueInstruction(instructionDatas),
  //   ).length;
  // }

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
    const step = this.instructionDefinitions[index];

    var cellData = this.toBreadboardCell(step);

    this.instructionPrompt.setup(
      step.title,
      step.description,
      this.instructionPromptLocationObj.getTransform().getWorldPosition(),
      cellToWorldPosition(
        cellData,
        this.hoverOffsetCm,
        this.breadboardOrigin.getTransform(),
      ),
    );
    this.instructionPrompt.show();

    this._currentIndex = index;
    this.onStepChangedEvent.invoke({
      step,
      currentIndex: index,
      totalCount: this._steps.length,
    });
  }

  private hideCurrentPrompt(): void {
    if (this._currentIndex < 0) {
      return;
    }
    this.instructionDefinitions[this._currentIndex].prompt?.hide();
  }

  private toBreadboardCell(definition: InstructionDefinition): BreadboardCell {
    const cell: BreadboardCell = {
      column: definition.column,
      row: definition.row,
    };
    return isWithinPlayground(cell) ? cell : undefined;
  }
}
