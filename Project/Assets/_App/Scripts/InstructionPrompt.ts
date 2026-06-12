import LineRenderer from "SpectaclesInteractionKit.lspkg/Utils/views/LineRenderer/LineRenderer";

const MIN_LINE_LENGTH_CM = 0.01;

@component
export class InstructionPrompt extends BaseScriptComponent {
  @input
  promptContainer!: SceneObject;

  @input
  @hint("Material for the callout line (LineRenderer clones it)")
  lineMaterial!: Material;

  @input
  titleText!: Text;

  @input
  @allowUndefined
  descriptionText!: Text;

  @input
  lineStart!: SceneObject;

  private _lines: LineRenderer[] = [];
  private _lineWidthStartCm: number = 1;
  private _lineWidthEndCm: number = 1;
  private _maxLines: number = 3;

  private _updateEvent!: UpdateEvent;
  private _targetPositions: vec3[] = [];

  onAwake() {
    // Pre-create a fixed pool of lines: no per-step create/destroy churn, no
    // runtime allocations. Each is repositioned every frame while shown.
    for (let i = 0; i < this._maxLines; i++) {
      const line = this.createLineRenderer();
      line.setEnabled(false);
      this._lines.push(line);
    }

    // Frame loop for real-time tracking, disabled until the prompt is shown.
    this._updateEvent = this.createEvent("UpdateEvent");
    this._updateEvent.bind(() => this.updateLinePositions());
    this._updateEvent.enabled = false;
  }

  setup(
    title: string,
    description: string,
    promptPosition: vec3,
    targetPositions: vec3[],
  ) {
    this.promptContainer.getTransform().setWorldPosition(promptPosition);

    if (this.titleText) {
      this.titleText.text = title;
    }
    if (this.descriptionText) {
      this.descriptionText.text = description;
    }

    // Just record the targets — updateLinePositions() (driven by show() and the
    // frame loop) decides which pooled lines to draw and where.
    this._targetPositions = targetPositions;
  }

  private createLineRenderer(): LineRenderer {
    // The two points here are placeholders: setLine() overwrites them in the
    // container's local space every frame, so any valid 2-point segment will do.
    const line = new LineRenderer({
      material: this.lineMaterial,
      points: [vec3.zero(), new vec3(0, 0, 1)],
      startWidth: this._lineWidthStartCm,
      endWidth: this._lineWidthEndCm,
      lookAtCamera: true, // billboard the strip so it's visible from any angle
    });

    line.attachToScene(this.getSceneObject());
    return line;
  }

  private updateLinePositions(): void {
    const startWorld = this.lineStart.getTransform().getWorldPosition();

    for (let i = 0; i < this._lines.length; i++) {
      if (i < this._targetPositions.length) {
        this.setLine(this._lines[i], startWorld, this._targetPositions[i]);
      } else {
        this._lines[i].setEnabled(false);
      }
    }
  }

  private setLine(line: LineRenderer, startWorld: vec3, endWorld: vec3) {
    const length = endWorld.distance(startWorld);
    if (length < MIN_LINE_LENGTH_CM) {
      line.setEnabled(false); // degenerate — endpoints coincide
      return;
    }
    line.setEnabled(true);

    // LineRenderer bakes its points straight into mesh vertices in the line
    // container's LOCAL space. Convert the world endpoints into that space so the
    // line lands exactly between them, regardless of the parent's transform.
    const toLocal = line.getTransform().getInvertedWorldTransform();
    line.points = [
      toLocal.multiplyPoint(startWorld),
      toLocal.multiplyPoint(endWorld),
    ];
  }

  show(): void {
    this.promptContainer.enabled = true;
    this._updateEvent.enabled = true;
    this.updateLinePositions();
  }

  hide(): void {
    this.promptContainer.enabled = false;
    this._updateEvent.enabled = false;
    for (let i = 0; i < this._lines.length; i++) {
      this._lines[i].setEnabled(false);
    }
  }
}
