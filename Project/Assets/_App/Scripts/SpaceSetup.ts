import { MenuConsole } from "./UI/MenuConsole";
import { MusicController } from "./MusicController";
import { ScaleVisibilityAnimator } from "./Utils/ScaleVisibilityAnimator";
import {
  setTimeout,
  clearTimeout,
  CancelToken,
} from "SpectaclesInteractionKit.lspkg/Utils/FunctionTimingUtils";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";

@component
export class SpaceSetup extends BaseScriptComponent {
  @input
  movementModal!: SceneObject;

  @input
  @hint("Scene content enabled when the space is set up")
  componentDividers!: SceneObject[];

  @input
  @hint("Delay between each divider's animation, ms — staggered cascade")
  dividerStaggerMs: number = 60;

  private movementModalAnimator!: ScaleVisibilityAnimator;
  private dividerAnimators: ScaleVisibilityAnimator[] = [];
  private staggerTokens: CancelToken[] = [];

  onAwake() {
    // Built in onAwake (not onStart) so the animators exist before any other
    // component's onStart can call show()/hide() — every onAwake runs before
    // any onStart, but onStart ordering across components is not guaranteed.
    this.initAnimators();
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private initAnimators() {
    this.movementModalAnimator = new ScaleVisibilityAnimator(
      this.movementModal,
    );
    this.movementModalAnimator.hideImmediate();

    // One animator per divider, captured at its authored (visible) scale, then
    // snapped hidden — the baseline show() animates in from.
    this.dividerAnimators = this.componentDividers.map((divider) => {
      const animator = new ScaleVisibilityAnimator(divider);
      animator.hideImmediate();
      return animator;
    });
  }

  private onDestroy() {
    this.cancelStagger();
  }

  showMovementModal(): void {
    this.movementModalAnimator.show();
  }

  hideMovementModal(): void {
    this.movementModalAnimator.hide();
  }

  setPosition(position: vec3) {
    this.getTransform().setWorldPosition(position);

    const transform = this.getTransform();
    const camera = WorldCameraFinderProvider.getInstance();
    const toCamera = camera
      .getWorldPosition()
      .sub(transform.getWorldPosition())
      .normalize();

    toCamera.y = 0;
    transform.setWorldRotation(quat.lookAt(toCamera.normalize(), vec3.up()));
  }

  show(): void {
    this.showMovementModal();
    this.staggerDividers((animator) => animator.show());
  }

  hide() {
    this.hideMovementModal();
    this.staggerDividers((animator) => animator.hide());
  }

  private staggerDividers(
    action: (animator: ScaleVisibilityAnimator) => void,
  ): void {
    this.cancelStagger();
    this.staggerTokens = this.dividerAnimators.map((animator, index) =>
      setTimeout(() => action(animator), index * this.dividerStaggerMs),
    );
  }

  private cancelStagger(): void {
    this.staggerTokens.forEach((token) => clearTimeout(token));
    this.staggerTokens = [];
  }
}
