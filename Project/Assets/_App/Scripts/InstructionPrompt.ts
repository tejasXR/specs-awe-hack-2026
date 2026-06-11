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
  @allowUndefined
  titleText: Text;

  @input
  descriptionText: Text;

  // TODO: TEJAS, create a way to draw multiple lines in case we are specific using wires
  @input
  lineStart!: SceneObject;

  @input
  lineEnd!: SceneObject;

  private _lines: LineRenderer[] = [];
  private _lineWidthStartCm: number = 0.2;
  private _lineWidthEndCm: number = 0.1;
  private _maxLines: number = 3;

  private _updateEvent!: UpdateEvent;
  private _targetPositions: vec3[] = [];

  onAwake() {
    // Pre-create the line renderer pool to avoid dynamic allocations at runtime
    for (let i = 0; i < this._maxLines; i++) {
      const line = this.createLineRenderer();
      line.setEnabled(false);
      this._lines.push(line);
    }

    // Set up frame update loop for real-time tracking, disabled by default
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

    this._targetPositions = targetPositions;

    if (this.lineEnd && targetPositions.length > 0) {
      this.lineEnd.getTransform().setWorldPosition(targetPositions[0]);
    }
  }

  private createLineRenderer(): LineRenderer {
    var line = new LineRenderer({
      material: this.lineMaterial,
      points: [vec3.zero(), vec3.zero()],
      startWidth: this._lineWidthStartCm,
      endWidth: this._lineWidthEndCm,
      lookAtCamera: true, // billboard the strip so it's visible from any angle
    });

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
    const toEnd = endWorld.sub(startWorld);
    const length = toEnd.length;
    if (length < MIN_LINE_LENGTH_CM) {
      line.setEnabled(false); // degenerate — endpoints coincide
      return;
    }
    line.setEnabled(true);

    const transform = line.getTransform();
    transform.setWorldPosition(startWorld.add(toEnd.uniformScale(0.5)));

    // A near-vertical line is parallel to the default up reference — swap it
    // out so lookAt stays stable.
    const direction = toEnd.uniformScale(1 / length);
    const up =
      Math.abs(direction.dot(vec3.up())) > 0.99 ? vec3.forward() : vec3.up();
    transform.setWorldRotation(quat.lookAt(direction, up));

    const scale = transform.getLocalScale();
    transform.setLocalScale(new vec3(scale.x, scale.y, length));
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

