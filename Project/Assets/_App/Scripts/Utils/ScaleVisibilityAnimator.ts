/**
 * ScaleVisibilityAnimator — show/hide a SceneObject by tweening its scale.
 *
 * A small, reusable helper (not a component) that owns the "pop in / pop out"
 * animation duplicated across the UI: it tweens local scale between a "shown"
 * scale and zero, toggling the SceneObject's enabled state around the tween.
 *
 * Tweens always run from the *current* scale, so an interrupted hide reverses
 * smoothly into a show (and vice versa) with no popping. Each call cancels the
 * previous tween first.
 *
 * The "shown" scale defaults to the object's authored local scale captured at
 * construction — so the object must be authored at its visible scale. If it is
 * authored pre-hidden (scale zero), pass an explicit `shownScale` instead.
 *
 * Usage:
 *   this.animator = new ScaleVisibilityAnimator(this.getSceneObject());
 *   this.animator.hideImmediate();   // establish hidden baseline, no tween
 *   this.animator.show();            // animate in
 *   this.animator.hide();            // animate out, disable on complete
 */
import { LSTween } from "LSTween.lspkg/Examples/Scripts/LSTween";
import Easing from "LSTween.lspkg/TweenJS/Easing";
import { Tween } from "LSTween.lspkg/TweenJS/Tween";

export interface ScaleVisibilityConfig {
  /** Show (grow-in) tween duration, ms. Default 250. */
  showDurationMs?: number;
  /** Hide (shrink-out) tween duration, ms. Default 180. */
  hideDurationMs?: number;
  /** Override the shown scale. Defaults to the authored local scale. */
  shownScale?: vec3;
}

export class ScaleVisibilityAnimator {
  private readonly sceneObject: SceneObject;
  private readonly transform: Transform;
  private readonly shownScale: vec3;
  private readonly showDurationMs: number;
  private readonly hideDurationMs: number;

  private activeTween?: Tween<{ t: number }>;

  constructor(sceneObject: SceneObject, config?: ScaleVisibilityConfig) {
    this.sceneObject = sceneObject;
    this.transform = sceneObject.getTransform();

    const authored = this.transform.getLocalScale();
    this.shownScale =
      config?.shownScale ?? new vec3(authored.x, authored.y, authored.z);

    this.showDurationMs = config?.showDurationMs ?? 250;
    this.hideDurationMs = config?.hideDurationMs ?? 180;
  }

  show(): void {
    this.stopActiveTween();
    this.sceneObject.enabled = true;

    this.activeTween = LSTween.scaleToLocal(
      this.transform,
      this.shownScale,
      this.showDurationMs,
    )
      .easing(Easing.Back.Out)
      .start();
  }

  hide(hideObjectAfterScale: boolean = true): void {
    this.stopActiveTween();

    this.activeTween = LSTween.scaleToLocal(
      this.transform,
      vec3.zero(),
      this.hideDurationMs,
    )
      .easing(Easing.Back.In)
      .onComplete(() => {
        if (hideObjectAfterScale) {
          this.sceneObject.enabled = false;
        }
      })
      .start();
  }

  showImmediate(): void {
    this.stopActiveTween();
    this.sceneObject.enabled = true;
    this.transform.setLocalScale(this.shownScale);
  }

  hideImmediate(): void {
    this.stopActiveTween();
    this.transform.setLocalScale(vec3.zero());
    this.sceneObject.enabled = false;
  }

  private stopActiveTween(): void {
    this.activeTween?.stop();
    this.activeTween = undefined;
  }
}
