import { MenuConsole } from "./UI/MenuConsole";
import { MusicController } from "./MusicController";
import { ScaleVisibilityAnimator } from "./Utils/ScaleVisibilityAnimator";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";

@component
export class SpaceSetup extends BaseScriptComponent {
  @input
  @hint("Menu revealed when the space is set up")
  menuConsole!: MenuConsole;

  @input
  movementModal!: SceneObject;

  @input
  @hint("Scene content enabled when the space is set up")
  componentDividers!: SceneObject[];

  @input
  menuConsoleStartPoint!: SceneObject;

  private movementModalAnimator!: ScaleVisibilityAnimator;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  onStart() {
    this.movementModalAnimator = new ScaleVisibilityAnimator(
      this.movementModal,
    );
    this.movementModalAnimator.hideImmediate();
  }

  /** Animate the movement modal in. */
  showMovementModal(): void {
    this.movementModalAnimator.show();
  }

  /** Animate the movement modal out. */
  hideMovementModal(): void {
    this.movementModalAnimator.hide();
  }

  setup(setupPosition: vec3): void {
    this.getTransform().setWorldPosition(setupPosition);

    const transform = this.getTransform();
    const camera = WorldCameraFinderProvider.getInstance();
    const toCamera = camera
      .getWorldPosition()
      .sub(transform.getWorldPosition())
      .normalize();

    toCamera.y = 0;

    transform.setWorldRotation(quat.lookAt(toCamera.normalize(), vec3.up()));

    this.menuConsole.setPosition(
      this.menuConsoleStartPoint.getTransform().getWorldPosition(),
    );
    this.menuConsole.show();

    this.componentDividers.forEach((element) => {
      element.enabled = true;
    });
  }

  hideSpace() {
    this.menuConsole.hide();

    this.componentDividers.forEach((element) => {
      element.enabled = false;
    });
  }
}
