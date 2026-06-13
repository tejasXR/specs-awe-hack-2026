import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";
import { PressBreadboardRecognizer } from "./PressBreadboardRecognizer";
import { SpaceSetup } from "./SpaceSetup";

@component
export class ExperienceInitialization extends BaseScriptComponent {
  @input
  pressBreadboardRecognizer!: PressBreadboardRecognizer;

  @input
  spaceSetup!: SpaceSetup;

  private _initializationComplete: boolean = false;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  onStart() {
    this.pressBreadboardRecognizer.onHoldComplete.add((setupPosition) =>
      this.onBreadboardPressed(setupPosition),
    );

    print("Scene setup deactivaed");
    this.spaceSetup.enabled = false;
  }

  private onBreadboardPressed(setupPosition: vec3) {
    if (this._initializationComplete) return;

    this.spaceSetup.setup(setupPosition);

    const transform = this.getTransform();
    const camera = WorldCameraFinderProvider.getInstance();
    const toCamera = camera
      .getWorldPosition()
      .sub(transform.getWorldPosition())
      .normalize();

    toCamera.y = 0;

    transform.setWorldRotation(quat.lookAt(toCamera.normalize(), vec3.up()));

    this._initializationComplete = true;
  }
}
