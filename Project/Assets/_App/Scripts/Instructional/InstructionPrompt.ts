import LineRenderer from "SpectaclesInteractionKit.lspkg/Utils/views/LineRenderer/LineRenderer";

const MIN_LINE_LENGTH_CM = 0.01;
const MAX_LINES = 3;
const STEP_PREFIX = "Step";

export type LineWidthPreset = "thin" | "default" | "thick";

// cm widths per preset; start/end are kept separate so a preset can taper later.
const LINE_WIDTH_PRESETS_CM: Record<
  LineWidthPreset,
  { start: number; end: number }
> = {
  thin: { start: 0.05, end: 0.05 },
  default: { start: 0.1, end: 0.1 },
  thick: { start: 0.2, end: 0.2 },
};

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

  @input
  @hint("Material for the callout line (LineRenderer clones it)")
  lineMaterial!: Material;

  @input
  lineStart!: SceneObject;

  private _lines: LineRenderer[] = [];
  private _lineRenderingEnabled: boolean = true;
  private _lineWidthStartCm: number = LINE_WIDTH_PRESETS_CM.thin.start;
  private _lineWidthEndCm: number = LINE_WIDTH_PRESETS_CM.thin.end;

  private _updateEvent!: UpdateEvent;
  private _localTargets: vec3[] = [];

  onAwake() {
    // Frame loop for real-time tracking, disabled until the prompt is shown.
    // The line pool is built on first setup(), once the breadboard origin is known.
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this._updateEvent = this.createEvent("UpdateEvent");
    this._updateEvent.bind(() => this.updateLinePositions());
    this._updateEvent.enabled = false;
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

  // Targets are origin-LOCAL cell positions
  setLineTargets(breadboardOrigin: SceneObject, localTargets: vec3[]): void {
    this.ensureLinePool(breadboardOrigin);

    this._localTargets = localTargets;
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

  show(): void {
    this._updateEvent.enabled = true;
    this.updateLinePositions();
  }

  hide(): void {
    this._updateEvent.enabled = false;
    this.setLineRenderingEnabled(false);
  }

  setLineRenderingEnabled(enabled: boolean): void {
    this._lineRenderingEnabled = enabled;

    if (!enabled) {
      this.disableLines();
    } else if (this._updateEvent.enabled) {
      this.updateLinePositions(); // loop is live — reflect the change now
    }
  }

  setLineWidth(preset: LineWidthPreset): void {
    const width = LINE_WIDTH_PRESETS_CM[preset];
    this._lineWidthStartCm = width.start;
    this._lineWidthEndCm = width.end;

    for (const line of this._lines) {
      line.startWidth = width.start;
      line.endWidth = width.end;
    }
  }

  reset(): void {
    this.hide();
    this._localTargets = [];

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

    print("Instruction prompt reset");
  }

  private ensureLinePool(breadboardOrigin: SceneObject): void {
    if (this._lines.length > 0) {
      return; // already built — the origin is stable for the lens's lifetime
    }
    for (let i = 0; i < MAX_LINES; i++) {
      const line = this.createLineRenderer(breadboardOrigin);
      line.setEnabled(false);
      this._lines.push(line);
    }
  }

  private disableLines(): void {
    for (const line of this._lines) {
      line.setEnabled(false);
      print("lines disabled");
    }
  }

  private createLineRenderer(breadboardOrigin: SceneObject): LineRenderer {
    // The two points here are placeholders: setLine() overwrites them every frame.
    const line = new LineRenderer({
      material: this.lineMaterial,
      points: [vec3.zero(), new vec3(0, 0, 1)],
      startWidth: this._lineWidthStartCm,
      endWidth: this._lineWidthEndCm,
      lookAtCamera: true, // billboard the strip so it's visible from any angle
    });

    // Parent to the breadboard origin so the line's local space IS the board's:
    // origin-local cell points can be used directly and track the board for free.
    line.attachToScene(breadboardOrigin);
    return line;
  }

  private updateLinePositions(): void {
    if (!this._lineRenderingEnabled) {
      return; // lines already disabled by setLineRenderingEnabled()
    }
    const startWorld = this.lineStart.getTransform().getWorldPosition();

    for (let i = 0; i < this._lines.length; i++) {
      if (i < this._localTargets.length) {
        this.setLine(this._lines[i], startWorld, this._localTargets[i]);
      } else {
        this._lines[i].setEnabled(false);
      }
    }
  }

  private setLine(line: LineRenderer, startWorld: vec3, endLocal: vec3) {
    const startLocal = line
      .getTransform()
      .getInvertedWorldTransform()
      .multiplyPoint(startWorld);

    const length = endLocal.distance(startLocal);
    if (length < MIN_LINE_LENGTH_CM) {
      line.setEnabled(false); // degenerate — endpoints coincide
      return;
    }
    line.setEnabled(true);

    line.points = [startLocal, endLocal];
  }
}
