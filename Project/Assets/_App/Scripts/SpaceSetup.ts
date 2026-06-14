import { ScaleVisibilityAnimator } from "./Utils/ScaleVisibilityAnimator";
import {
  setTimeout,
  clearTimeout,
  CancelToken,
} from "SpectaclesInteractionKit.lspkg/Utils/FunctionTimingUtils";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";
import { SpaceSetupDivider, DividerKind } from "./SpaceSetupDivider";

@component
export class SpaceSetup extends BaseScriptComponent {
  @input
  movementModal!: SceneObject;

  @ui.separator
  @ui.label("Component Dividers")
  @input
  @hint("The component dividers — each self-identifies via its own kind.")
  dividers: SpaceSetupDivider[] = [];

  @input
  @hint("Delay between each divider's animation, ms — staggered cascade")
  dividerStaggerMs: number = 60;

  private movementModalAnimator!: ScaleVisibilityAnimator;
  private dividerByKind?: Map<DividerKind, SpaceSetupDivider>;
  private staggerTokens: CancelToken[] = [];

  onAwake() {
    this.movementModalAnimator = new ScaleVisibilityAnimator(
      this.movementModal,
    );

    this.movementModalAnimator.hideImmediate();

    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private getDividerByKind(): Map<DividerKind, SpaceSetupDivider> {
    if (this.dividerByKind === undefined) {
      this.dividerByKind = this.indexDividers();
    }
    return this.dividerByKind;
  }

  private indexDividers(): Map<DividerKind, SpaceSetupDivider> {
    const byKind = new Map<DividerKind, SpaceSetupDivider>();
    const problems: string[] = [];

    this.dividers.forEach((divider, index) => {
      if (isNull(divider)) {
        problems.push(`Divider slot ${index} is unwired`);
        return;
      }
      const kind = divider.dividerKind;
      if (byKind.has(kind)) {
        problems.push(`Duplicate divider kind "${kind}" at slot ${index}`);
        return;
      }
      byKind.set(kind, divider);
    });

    problems.forEach((problem) => print("[SpaceSetup] " + problem));
    return byKind;
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
    this.staggerDividers((divider) => divider.show());
  }

  hide(): void {
    this.hideMovementModal();
    this.staggerDividers((divider) => divider.hide());
  }

  showDivider(kind: DividerKind): void {
    this.getDividerByKind().get(kind)?.show();
  }

  hideDivider(kind: DividerKind): void {
    this.getDividerByKind().get(kind)?.hide();
  }

  getDividerLineAnchor(kind: DividerKind): SceneObject | undefined {
    return this.getDividerByKind().get(kind)?.getLocalLineAnchor();
  }

  private staggerDividers(action: (divider: SpaceSetupDivider) => void): void {
    this.cancelStagger();

    const dividers = Array.from(this.getDividerByKind().values());
    this.staggerTokens = dividers.map((divider, index) =>
      setTimeout(() => action(divider), index * this.dividerStaggerMs),
    );
  }

  private cancelStagger(): void {
    this.staggerTokens.forEach((token) => clearTimeout(token));
    this.staggerTokens = [];
  }
}
