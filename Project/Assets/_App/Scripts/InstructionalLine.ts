import LineRenderer from "SpectaclesInteractionKit.lspkg/Utils/views/LineRenderer/LineRenderer";

const MIN_LINE_LENGTH_CM = 0.01;

export type LineWidthPreset = "thin" | "default" | "thick";

// cm widths per preset; start/end kept separate so a preset can taper later.
const LINE_WIDTH_PRESETS_CM: Record<
  LineWidthPreset,
  { start: number; end: number }
> = {
  thin: { start: 0.05, end: 0.05 },
  default: { start: 0.1, end: 0.1 },
  thick: { start: 0.2, end: 0.2 },
};

@component
export class InstructionalLine extends BaseScriptComponent {
  @input
  @hint("Material for the callout line (LineRenderer clones it)")
  lineMaterial!: Material;

  @input
  @hint(
    "Marker at the line's start; reparented under its anchor by attachStart",
  )
  startPoint!: SceneObject;

  @input
  @hint("Marker at the line's end; reparented under its anchor by attachEnd")
  endPoint!: SceneObject;

  @input
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Thin", "thin"),
      new ComboBoxItem("Default", "default"),
      new ComboBoxItem("Thick", "thick"),
    ]),
  )
  defaultWidthPreset: string = "thin";

  @ui.separator
  @input
  enableLogging: boolean = false;

  private _line!: LineRenderer;
  private _updateEvent!: UpdateEvent;

  // Per-frame redraw keeps the line glued to markers whose parents move; turn
  // it off for static lines to skip the cost (a single redraw on show()).
  private _redrawOnUpdate: boolean = true;
  // show()/hide() own visibility; tracked so setRedrawOnUpdate can gate the
  // frame loop without ever drawing a hidden line.
  private _isShown: boolean = false;

  onAwake(): void {
    const preset = this.toPreset(this.defaultWidthPreset);
    const width = LINE_WIDTH_PRESETS_CM[preset];

    // The two points here are placeholders: redraw() overwrites them.
    this._line = new LineRenderer({
      material: this.lineMaterial,
      points: [vec3.zero(), new vec3(0, 0, 1)],
      startWidth: width.start,
      endWidth: width.end,
      lookAtCamera: true, // billboard the strip so it's visible from any angle
    });
    // Render in this prefab's space; redraw() converts world points into it.
    this._line.attachToScene(this.getSceneObject());
    this._line.setEnabled(false);

    // Frame loop redraws between the markers (which track their parents),
    // disabled until the line is shown.
    this._updateEvent = this.createEvent("UpdateEvent");
    this._updateEvent.bind(() => this.redraw());
    this._updateEvent.enabled = false;
  }

  attachStart(parent: SceneObject, localOffset: vec3 = vec3.zero()): void {
    this.startPoint.setParent(parent);
    this.startPoint.getTransform().setLocalPosition(localOffset);
  }

  attachEnd(parent: SceneObject, localOffset: vec3 = vec3.zero()): void {
    this.endPoint.setParent(parent);
    this.endPoint.getTransform().setLocalPosition(localOffset);
  }

  setWidth(preset: LineWidthPreset): void {
    const width = LINE_WIDTH_PRESETS_CM[preset];
    this._line.startWidth = width.start;
    this._line.endWidth = width.end;
  }

  show(): void {
    this._isShown = true;
    this.redraw(); // draw once so a non-redrawing line still appears
    this._updateEvent.enabled = this._redrawOnUpdate;
  }

  hide(): void {
    this._isShown = false;
    this._updateEvent.enabled = false;
    this._line.setEnabled(false);
  }

  // Toggle the per-frame redraw loop. Safe to call before or after show():
  // the frame loop only runs while shown, and show() always draws once so a
  // static line (redrawOnUpdate === false) still renders.
  setRedrawOnUpdate(redrawOnUpdate: boolean): void {
    this._redrawOnUpdate = redrawOnUpdate;
    this._updateEvent.enabled = redrawOnUpdate && this._isShown;
  }

  setEnabled(enabled: boolean): void {
    if (enabled) {
      this.show();
    } else {
      this.hide();
    }
  }

  // Convert both endpoint markers into the LineRenderer's local space and feed
  // it the segment; collapse to hidden when the endpoints coincide.
  private redraw(): void {
    const startWorld = this.startPoint.getTransform().getWorldPosition();
    const endWorld = this.endPoint.getTransform().getWorldPosition();

    const invWorld = this._line.getTransform().getInvertedWorldTransform();
    const startLocal = invWorld.multiplyPoint(startWorld);
    const endLocal = invWorld.multiplyPoint(endWorld);

    if (endLocal.distance(startLocal) < MIN_LINE_LENGTH_CM) {
      this._line.setEnabled(false); // degenerate — endpoints coincide
      return;
    }

    this._line.setEnabled(true);
    this._line.points = [startLocal, endLocal];

    if (this.enableLogging) {
      print("[Line] start " + startWorld + " end " + endWorld);
    }
  }

  // Inspector constrains the combo box, so an unexpected value means a
  // misconfigured prefab — fall back to the narrowest width rather than throw.
  private toPreset(value: string): LineWidthPreset {
    if (value === "thin" || value === "default" || value === "thick") {
      return value;
    }
    return "thin";
  }
}
