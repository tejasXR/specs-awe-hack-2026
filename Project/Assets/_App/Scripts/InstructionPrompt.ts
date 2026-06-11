import LineRenderer from "SpectaclesInteractionKit.lspkg/Utils/views/LineRenderer/LineRenderer";

const MIN_LINE_LENGTH_CM = 0.01;

@component
export class InstructionPrompt extends BaseScriptComponent {
  @input
  promptContainer!: SceneObject;

  @input
  @hint("Material for the callout line (LineRenderer clones it)")
  lineMaterial!: Material;

  // TODO: TEJAS, create a way to draw multiple lines in case we are specific using wires
  @input
  lineStart!: SceneObject;

  @input
  lineEnd!: SceneObject;

  private _line!: LineRenderer;
  private _lineWidthStartCm: number = 0.2;
  private _lineWidthEndCm: number = 0.1;

  onAwake() {
    this._line = this.createLineRenderer();
    this._line.setEnabled(false);
  }

  setup(
    title: string,
    description: string,
    promptPosition: vec3,
    cellWorldPosition: vec3,
  ) {
    this.promptContainer.getTransform().setWorldPosition(promptPosition);
    this.lineEnd.getTransform().setWorldPosition(cellWorldPosition);
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

  setLine(startWorld: vec3, endWorld: vec3) {
    const toEnd = endWorld.sub(startWorld);
    const length = toEnd.length;
    if (length < MIN_LINE_LENGTH_CM) {
      this._line.setEnabled(false); // degenerate — endpoints coincide
      return;
    }
    this._line.setEnabled(true);

    const transform = this._line!.getTransform();
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
    this._line.setEnabled(this._line.points.length > 0);
  }

  hide(): void {
    this.promptContainer.enabled = false;
    this._line.setEnabled(false);
  }
}
