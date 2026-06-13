import LineRenderer from "SpectaclesInteractionKit.lspkg/Utils/views/LineRenderer/LineRenderer";

const MIN_LINE_LENGTH_CM = 0.01;

@component
export class InstructionPrompt extends BaseScriptComponent {
  @input
  stepNumberText!: Text;

  @input
  titleText!: Text;

  @input
  @allowUndefined
  descriptionText!: Text;

  @input
  @allowUndefined
  buttonLabelText!: Text;

  @input
  @hint("Material for the callout line (LineRenderer clones it)")
  lineMaterial!: Material;

  @input
  lineStart!: SceneObject;

  private _lines: LineRenderer[] = [];
  private _lineWidthStartCm: number = 0.05;
  private _lineWidthEndCm: number = 0.05;
  private _maxLines: number = 3;

  private _stepStringPrefix: string = "Step ";

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

  onStart() {}

  overrideStepText(overrideText: string) {
    if (this.stepNumberText) {
      this.stepNumberText.text = overrideText;
    }
  }

  setStepText(stepNumber: number, totalStepsInSequence: number): void {
    if (this.stepNumberText) {
      this.stepNumberText.text =
        this._stepStringPrefix + " " + stepNumber + "/" + totalStepsInSequence;
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

  public changeButtonLabel(
    primaryButtonLabel: string,
    secondaryButtonLabel: string = "",
    tertiaryButtonLabel: string = "",
  ) {
    const labels = [
      primaryButtonLabel,
      secondaryButtonLabel,
      tertiaryButtonLabel,
    ];
    this.buttonLabelText.text = labels
      .map((label, i) => (label ? `[${i + 1}] ${label}` : undefined))
      .filter((line): line is string => line !== undefined)
      .join("\n");
  }

  show(): void {
    this._updateEvent.enabled = true;
    this.updateLinePositions();
  }

  hide(): void {
    this._updateEvent.enabled = false;
    for (let i = 0; i < this._lines.length; i++) {
      this._lines[i].setEnabled(false);
    }
  }

  private ensureLinePool(breadboardOrigin: SceneObject): void {
    if (this._lines.length > 0) {
      return; // already built — the origin is stable for the lens's lifetime
    }
    for (let i = 0; i < this._maxLines; i++) {
      const line = this.createLineRenderer(breadboardOrigin);
      line.setEnabled(false);
      this._lines.push(line);
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
    const startWorld = this.lineStart.getTransform().getWorldPosition();

    for (let i = 0; i < this._lines.length; i++) {
      if (i < this._localTargets.length) {
        this.setLine(this._lines[i], startWorld, this._localTargets[i]);
      } else {
        this._lines[i].setEnabled(false);
      }
    }
  }

  // The line is parented to the breadboard origin, so its local space is the
  // board's. endLocal (a cell position) is already in that space; the start
  // just needs to come from world into it.
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
