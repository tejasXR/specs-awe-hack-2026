/**
 * GazeFollowBehavior — a body-locked panel that follows where you look.
 *
 * Each frame the object eases toward a point a fixed distance in front of the
 * camera, projected onto the horizontal (XZ) plane. Because the gaze direction
 * is flattened before use, the target always sits at the camera's eye height
 * (plus an optional offset) and looking up or down never raises or lowers the
 * panel — it reads as "vertically locked, horizontally following." Rotation is
 * left untouched (the authored orientation is preserved).
 *
 * The follow is a frame-rate-independent exponential lerp, so the feel is the
 * same at 30 or 60 fps. Looking near-straight up or down collapses the
 * flattened gaze to zero; in that case the last good direction is reused so
 * the panel doesn't snap or jitter.
 *
 * Drop this on the panel's root SceneObject and set the distance. No camera
 * reference is needed — it resolves the world camera via SIK.
 */
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";

/** Below this horizontal-gaze magnitude, reuse the last good direction. */
const MIN_HORIZONTAL_GAZE = 0.001;

@component
export class GazeFollowUI extends BaseScriptComponent {
  @ui.separator
  @ui.label("Placement")
  @input
  @hint("Distance in front of the camera, in cm")
  distance: number = 80;

  @input
  @hint("Vertical offset from eye height, in cm (negative = below eye line)")
  heightOffset: number = 0;

  @ui.separator
  @ui.label("Follow")
  @input
  @hint("How quickly the panel chases your gaze — higher is snappier")
  @widget(new SliderWidget(0.5, 20.0, 0.5))
  followSpeed: number = 5.0;

  @input
  @hint("Snap to position on the first frame instead of easing in from origin")
  snapOnStart: boolean = true;

  @ui.separator
  @ui.label("Settings")
  @input
  @hint("Enable debug logging")
  enableLogging: boolean = false;

  // ─── Private State ────────────────────────────────────────────

  private _transform!: Transform;
  private _camera: WorldCameraFinderProvider | null = null;
  /** Last non-degenerate flattened gaze direction (unit, XZ plane). */
  private _lastFlatGaze: vec3 | null = null;
  private _hasSnapped: boolean = false;

  // ─── Lifecycle ────────────────────────────────────────────────

  onAwake(): void {
    this._transform = this.getTransform();

    try {
      this._camera = WorldCameraFinderProvider.getInstance();
    } catch (e) {
      this.log("World camera unavailable — follow disabled: " + e);
      this._camera = null;
    }

    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  private onUpdate(): void {
    if (!this._camera) {
      return;
    }

    const target = this.calculateTarget();
    if (!target) {
      return; // degenerate gaze and no cached direction yet — wait a frame
    }

    if (this.snapOnStart && !this._hasSnapped) {
      this._transform.setWorldPosition(target);
      this._hasSnapped = true;
      return;
    }

    const t = 1 - Math.exp(-this.followSpeed * getDeltaTime());
    const current = this._transform.getWorldPosition();
    const next = current.add(target.sub(current).uniformScale(t));
    this._transform.setWorldPosition(next);
  }

  private calculateTarget(): vec3 | null {
    const camPos = this._camera!.getWorldPosition();

    // back() is the direction the camera looks (LS forward points behind it).
    const gaze = this._camera!.back();
    const flat = new vec3(gaze.x, 0, gaze.z);
    const horizontal = flat.length;

    if (horizontal > MIN_HORIZONTAL_GAZE) {
      this._lastFlatGaze = flat.uniformScale(1 / horizontal);
    } else if (!this._lastFlatGaze) {
      return null;
    }

    const dir = this._lastFlatGaze!;
    return new vec3(
      camPos.x + dir.x * this.distance,
      camPos.y + this.heightOffset,
      camPos.z + dir.z * this.distance,
    );
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[GazeFollowBehavior] " + message);
    }
  }
}
