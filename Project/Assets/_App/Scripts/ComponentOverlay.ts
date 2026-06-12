/**
 * ComponentOverlay — floating AR labels that appear over detected components.
 *
 * Subscribes to ComponentDetector.onComponentsDetected and creates/updates
 * floating Text labels anchored in 3D space. Each label shows the component
 * name and a brief description, positioned by projecting the detection's
 * normalized image coordinates into world space relative to the camera.
 *
 * Labels are pooled and recycled to avoid runtime allocations. Old labels
 * from a previous scan are hidden before new ones appear.
 *
 * SETUP:
 *   1. Wire the ComponentDetector reference.
 *   2. Optionally wire a label material for styled backgrounds.
 *   3. Adjust displayDuration and labelDistance in the Inspector.
 */
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";
import { ComponentDetector, ComponentDetectionResult } from "./ComponentDetector";
import { DetectedComponent } from "./ComponentIdentifier";

// ─── Component ──────────────────────────────────────────────────

@component
export class ComponentOverlay extends BaseScriptComponent {
  @ui.separator
  @ui.label("References")
  @input
  @hint("ComponentDetector that provides scan results")
  @allowUndefined
  detector!: ComponentDetector;

  @ui.separator
  @ui.label("Layout")
  @input
  @hint("Distance from camera to place labels, in cm")
  labelDistance: number = 40;

  @input
  @hint("How long labels stay visible before fading, in seconds (0 = permanent)")
  displayDuration: number = 0;

  @input
  @hint("Vertical offset above the detected position, in cm")
  labelVerticalOffset: number = 3.0;

  @input
  @hint("Maximum number of labels to show simultaneously")
  maxLabels: number = 8;

  @ui.separator
  @ui.label("Style")
  @input
  @hint("Label text size")
  labelSize: number = 18;

  @input
  @hint("Label color — component name")
  labelColor: vec4 = new vec4(0.3, 0.95, 0.5, 1.0);

  @input
  @hint("Description color — smaller text below the label")
  descriptionColor: vec4 = new vec4(0.85, 0.85, 0.85, 1.0);

  @input
  @hint("Enable debug logging")
  enableLogging: boolean = false;

  // ─── Events ───────────────────────────────────────────────────

  private readonly onLabelsUpdatedEvent = new Event<number>();
  /** Fires with the count of visible labels after an update. */
  readonly onLabelsUpdated: PublicApi<number> =
    this.onLabelsUpdatedEvent.publicApi();

  // ─── Private State ────────────────────────────────────────────

  private _cameraTransform!: Transform;
  private _labelPool: LabelEntry[] = [];
  private _unsubs: unsubscribe[] = [];
  private _hideDelayedEvent: DelayedCallbackEvent | null = null;

  // ─── Lifecycle ────────────────────────────────────────────────

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => {
      this._unsubs.forEach((unsub) => unsub());
      this._unsubs = [];
    });
  }

  private onStart(): void {
    if (isNull(this.detector)) {
      this.log("detector not wired — overlay disabled");
      return;
    }

    this._cameraTransform =
      WorldCameraFinderProvider.getInstance().getTransform();

    // Pre-create the label pool
    for (let i = 0; i < this.maxLabels; i++) {
      this._labelPool.push(this.createLabel(i));
    }
    this.hideAllLabels();

    // Subscribe to detection results
    this._unsubs.push(
      this.detector.onComponentsDetected.add((result) =>
        this.onDetection(result),
      ),
    );
  }

  // ─── Public API ───────────────────────────────────────────────

  /** Manually hide all labels. */
  hideAllLabels(): void {
    for (const entry of this._labelPool) {
      entry.root.enabled = false;
    }
  }

  // ─── Private — Detection Handler ──────────────────────────────

  private onDetection(result: ComponentDetectionResult): void {
    this.hideAllLabels();

    const count = Math.min(result.components.length, this.maxLabels);
    this.log("Showing " + count + " labels");

    for (let i = 0; i < count; i++) {
      const comp = result.components[i];
      const entry = this._labelPool[i];

      // Update text
      entry.nameText.text = comp.label;
      entry.descText.text = comp.description;

      // Position in world space
      const worldPos = this.imageToWorldPosition(
        comp.imagePosX,
        comp.imagePosY,
      );
      entry.root.getTransform().setWorldPosition(worldPos);

      // Billboard: face the camera
      this.billboardToCamera(entry.root);

      entry.root.enabled = true;
    }

    this.onLabelsUpdatedEvent.invoke(count);

    // Auto-hide after duration
    if (this.displayDuration > 0) {
      const hideEvent = this.createEvent("DelayedCallbackEvent");
      hideEvent.bind(() => this.hideAllLabels());
      // @ts-ignore — DelayedCallbackEvent.reset takes seconds
      hideEvent.reset(this.displayDuration);
    }
  }

  // ─── Private — Positioning ────────────────────────────────────

  /**
   * Convert normalized image coordinates (0–1) to a world position in
   * front of the camera. This creates a "floating in space" effect at
   * the approximate location where the component was seen.
   */
  private imageToWorldPosition(normX: number, normY: number): vec3 {
    const camPos = this._cameraTransform.getWorldPosition();
    const camFwd = this._cameraTransform.forward;
    const camRight = this._cameraTransform.right;
    const camUp = this._cameraTransform.up;

    // Center the coordinates: (0,0) = top-left → (-0.5, 0.5) centered
    const centeredX = normX - 0.5;
    const centeredY = -(normY - 0.5); // flip Y: image Y grows down

    // Spread factor — how wide the label field is at labelDistance
    const spreadCm = this.labelDistance * 0.8;

    const pos = camPos
      .add(camFwd.uniformScale(this.labelDistance))
      .add(camRight.uniformScale(centeredX * spreadCm))
      .add(camUp.uniformScale(centeredY * spreadCm + this.labelVerticalOffset));

    return pos;
  }

  private billboardToCamera(obj: SceneObject): void {
    const camPos = this._cameraTransform.getWorldPosition();
    const objPos = obj.getTransform().getWorldPosition();
    const toCamera = camPos.sub(objPos);
    toCamera.y = 0;
    if (toCamera.length > 0.01) {
      obj
        .getTransform()
        .setWorldRotation(quat.lookAt(toCamera.normalize(), vec3.up()));
    }
  }

  // ─── Private — Label Factory ──────────────────────────────────

  private createLabel(index: number): LabelEntry {
    const root = global.scene.createSceneObject("CompLabel_" + index);
    root.setParent(this.getSceneObject());

    // Name text (larger, colored)
    const nameObj = global.scene.createSceneObject("Name");
    nameObj.setParent(root);
    const nameText = nameObj.createComponent("Component.Text") as Text;
    nameText.size = this.labelSize;
    nameText.horizontalAlignment = HorizontalAlignment.Center;
    nameText.verticalAlignment = VerticalAlignment.Center;
    nameText.textFill.color = this.labelColor;
    nameText.outlineSettings.enabled = true;
    nameText.outlineSettings.size = 0.25;
    nameText.outlineSettings.fill.color = new vec4(0.02, 0.03, 0.06, 1.0);
    nameText.dropshadowSettings.enabled = true;
    nameText.dropshadowSettings.fill.color = new vec4(0.0, 0.0, 0.0, 0.8);
    nameObj.getTransform().setLocalPosition(new vec3(0, 2, 0));

    // Description text (smaller, dimmer)
    const descObj = global.scene.createSceneObject("Desc");
    descObj.setParent(root);
    const descText = descObj.createComponent("Component.Text") as Text;
    descText.size = Math.round(this.labelSize * 0.65);
    descText.horizontalAlignment = HorizontalAlignment.Center;
    descText.verticalAlignment = VerticalAlignment.Center;
    descText.textFill.color = this.descriptionColor;
    descText.outlineSettings.enabled = true;
    descText.outlineSettings.size = 0.2;
    descText.outlineSettings.fill.color = new vec4(0.02, 0.03, 0.06, 1.0);
    descObj.getTransform().setLocalPosition(new vec3(0, -2, 0));

    root.enabled = false;

    return { root, nameText, descText };
  }

  // ─── Private ──────────────────────────────────────────────────

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ComponentOverlay] " + message);
    }
  }
}

// ─── Internal Types ─────────────────────────────────────────────

interface LabelEntry {
  root: SceneObject;
  nameText: Text;
  descText: Text;
}
