import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { InstructionPrompt } from "./Instructional/InstructionPrompt";
import { MenuConsole } from "./UI/MenuConsole";

@typedef
export class OnboardingStep {
  @input
  stepText!: string;

  @input
  title!: string;

  @input
  @widget(new TextAreaWidget())
  description: string = "";

  @input
  primaryButtonText!: string;

  @input
  secondaryButtonText!: string;
}

const NO_STEP = -1;
const NEXT_LABEL = "Next";
const BACK_LABEL = "Back";

@component
export class OnboardingController extends BaseScriptComponent {
  @ui.separator
  @ui.label("References")
  @input
  @hint("The single InstructionPrompt living in the scene")
  instructionPrompt!: InstructionPrompt;

  @input
  @hint("Console whose primary/secondary buttons drive next/previous")
  menuConsole!: MenuConsole;

  @ui.separator
  @ui.label("Sequence")
  @input
  onboardingSteps: OnboardingStep[] = [];

  private _currentIndex: number = NO_STEP;

  private readonly onCompletedEvent = new Event<void>();
  readonly onCompleted: PublicApi<void> = this.onCompletedEvent.publicApi();

  get stepCount(): number {
    return this.onboardingSteps.length;
  }

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  onStart() {
    this.menuConsole.onPrimaryPressed.add(() => this.next());
    this.menuConsole.onSecondaryPressed.add(() => this.previous());
  }

  setup(): void {
    if (this.onboardingSteps.length === 0) {
      return;
    }
    this.showStep(0);
  }

  private next(): void {
    if (this._currentIndex === NO_STEP) {
      return; // navigation is inert until setup() starts the sequence
    }
    if (this._currentIndex >= this.stepCount - 1) {
      this.onCompletedEvent.invoke(); // clamp at the end + signal completion
      return;
    }
    this.showStep(this._currentIndex + 1);
  }

  private previous(): void {
    if (this._currentIndex <= 0) {
      return; // clamp at the first step (also covers NO_STEP)
    }
    this.showStep(this._currentIndex - 1);
  }

  private showStep(index: number): void {
    const onboardingStep = this.onboardingSteps[index];

    this.instructionPrompt.overrideStepText(onboardingStep.stepText);

    this.instructionPrompt.setTitleAndDescription(
      onboardingStep.title,
      onboardingStep.description,
    );

    this.updateButtonLabels(index);

    // this.instructionPrompt.show();

    this._currentIndex = index;
  }

  // Next hides only on the last of several steps; Back hides on the first. A
  // lone step keeps Next so it can still complete. The gap behavior in
  // changeButtonLabel keeps Back as [2] even when Next ([1]) is absent.
  private updateButtonLabels(index: number): void {
    const onboardingStep = this.onboardingSteps[index];

    const isFirst = index === 0;
    const isLast = index === this.stepCount - 1;

    const primaryLabel =
      isLast && !isFirst ? "" : onboardingStep.primaryButtonText;
    const secondaryLabel = isFirst ? "" : onboardingStep.secondaryButtonText;

    this.instructionPrompt.changeButtonLabel(primaryLabel, secondaryLabel);
  }
}
