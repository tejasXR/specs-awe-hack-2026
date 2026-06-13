import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";
import { PressBreadboardRecognizer } from "./PressBreadboardRecognizer";
import { SpaceSetup } from "./SpaceSetup";
import { MusicController } from "./MusicController";

@component
export class ExperienceInitialization extends BaseScriptComponent {
  @input
  pressBreadboardRecognizer!: PressBreadboardRecognizer;

  @input
  @hint("Music controller that plays the setup track")
  musicController!: MusicController;

  @input
  @hint("Track to play when the space is set up")
  introTrack!: AudioTrackAsset;

  @input
  spaceSetup!: SpaceSetup;

  @input
  hideSpaceSetupOnStart: boolean = false;

  private _initializationComplete: boolean = false;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  onStart() {
    this.pressBreadboardRecognizer.onHoldComplete.add((setupPosition) =>
      this.onBreadboardPressed(setupPosition),
    );

    if (this.hideSpaceSetupOnStart) {
      this.hideSpaceSetup();
    }

    print("Scene setup deactivaed");
    this.spaceSetup.enabled = false;
  }

  private hideSpaceSetup() {
    this.spaceSetup.hideSpace();
  }

  private onBreadboardPressed(setupPosition: vec3) {
    if (this._initializationComplete) return;

    this.spaceSetup.setup(setupPosition);

    this.musicController.play(this.introTrack);

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
