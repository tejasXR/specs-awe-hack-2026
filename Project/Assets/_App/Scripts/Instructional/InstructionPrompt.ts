const STEP_PREFIX = "Step";

/**
 * Presentation-only panel for a single build step: step number, title,
 * description, and button labels. Callout lines are owned by the Line prefab
 * pool in InstructionsController — this component no longer renders them.
 */
@component
export class InstructionPrompt extends BaseScriptComponent {
  @input
  stepNumberText!: Text;

  @input
  titleText!: Text;

  @input
  @allowUndefined
  descriptionText: Text | undefined;

  @input
  @allowUndefined
  @hint("Label for the primary button")
  primaryButtonLabelText: Text | undefined;

  @input
  @allowUndefined
  @hint("Label for the secondary button")
  secondaryButtonLabelText: Text | undefined;

  @input
  @allowUndefined
  @hint("Label for the tertiary button")
  tertiaryButtonLabelText: Text | undefined;

  @ui.separator
  @input
  enableLogging: boolean = false;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  onStart() {
    this.reset();
  }

  overrideStepText(overrideText: string) {
    if (this.stepNumberText) {
      this.stepNumberText.text = overrideText;
    }
  }

  // stepIndex is 0-based; presented 1-based (index + 1).
  setStepText(stepIndex: number, totalStepsInSequence: number): void {
    if (this.stepNumberText) {
      this.stepNumberText.text = `${STEP_PREFIX} ${stepIndex + 1}/${totalStepsInSequence}`;
    }
  }

  setTitleAndDescription(title: string, description: string): void {
    if (this.titleText) {
      this.titleText.text = title;
    }
    if (this.descriptionText) {
      this.descriptionText.text = description;
    }
  }

  public setButtonLabel(
    primaryButtonLabel: string,
    secondaryButtonLabel: string = "",
    tertiaryButtonLabel: string = "",
  ) {
    this.applyButtonLabel(this.primaryButtonLabelText, primaryButtonLabel);
    this.applyButtonLabel(this.secondaryButtonLabelText, secondaryButtonLabel);
    this.applyButtonLabel(this.tertiaryButtonLabelText, tertiaryButtonLabel);
  }

  private applyButtonLabel(textElement: Text | undefined, label: string): void {
    if (!textElement) {
      return;
    }
    if (label) {
      textElement.text = label;
      textElement.enabled = true;
    } else {
      textElement.enabled = false;
    }
  }

  reset(): void {
    if (this.stepNumberText) {
      this.stepNumberText.text = "";
    }
    if (this.titleText) {
      this.titleText.text = "";
    }
    if (this.descriptionText) {
      this.descriptionText.text = "";
    }

    this.setButtonLabel("", "", "");

    if (this.enableLogging) {
      print("Instruction prompt reset");
    }
  }
}
