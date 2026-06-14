import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { InstructionPrompt } from "./Instructional/InstructionPrompt";
import { MenuConsole } from "./UI/MenuConsole";
import { ZappyInteractionsController } from "./Zappy/ZappyInteractionsController";

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

@component
export class OnboardingController extends BaseScriptComponent {
  @input
  @hint("The single InstructionPrompt living in the scene")
  instructionPrompt!: InstructionPrompt;

  @input
  menuConsole!: MenuConsole;

  @input
  @hint("Pinching Zappy advances to the next onboarding step")
  zappyInteractions!: ZappyInteractionsController;

  @ui.separator
  @ui.label("Sequence")
  @input
  onboardingSteps: OnboardingStep[] = [];

  private _currentIndex: number = NO_STEP;

  private _inputUnsubscribers: unsubscribe[] = [];

  private readonly onCompletedEvent = new Event<void>();
  readonly onCompleted: PublicApi<void> = this.onCompletedEvent.publicApi();

  private readonly onStepChangedEvent = new Event<number>();
  readonly onStepChanged: PublicApi<number> =
    this.onStepChangedEvent.publicApi();

  get stepCount(): number {
    return this.onboardingSteps.length;
  }

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestoy());
  }

  onStart() {
    this._inputUnsubscribers.push(
      this.menuConsole.onPrimaryPressed.add(() => this.next()),
      this.menuConsole.onSecondaryPressed.add(() => this.previous()),
      this.zappyInteractions.onPinched.add(() => this.next()),
    );
  }

  onDestoy() {
    this.teardown();
  }

  setup(): void {
    if (this.onboardingSteps.length === 0) {
      return;
    }
    this.showStep(0);
  }

  teardown(): void {
    this._inputUnsubscribers.forEach((unsub) => unsub());
    this._inputUnsubscribers = [];
  }

  private next(): void {
    if (this._currentIndex === NO_STEP) {
      return;
    }
    if (this._currentIndex >= this.stepCount - 1) {
      this.teardown();

      this._currentIndex = NO_STEP;
      this.onCompletedEvent.invoke();

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
    this._currentIndex = index;

    this.onStepChangedEvent.invoke(index);
  }

  private updateButtonLabels(index: number): void {
    const onboardingStep = this.onboardingSteps[index];

    const isFirst = index === 0;
    const isLast = index === this.stepCount - 1;

    const primaryLabel =
      isLast && !isFirst ? "" : onboardingStep.primaryButtonText;
    const secondaryLabel = isFirst ? "" : onboardingStep.secondaryButtonText;

    this.instructionPrompt.setButtonLabel(primaryLabel, secondaryLabel);
  }
}
