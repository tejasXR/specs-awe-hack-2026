import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";
import { PressBreadboardRecognizer } from "./PressBreadboardRecognizer";
import { SpaceSetup } from "./SpaceSetup";
import { MusicController } from "./MusicController";
import { MenuConsole } from "./UI/MenuConsole";
import { OnboardingController } from "./OnboardingController";

@component
export class ExperienceInitialization extends BaseScriptComponent {
  @input
  pressBreadboardRecognizer!: PressBreadboardRecognizer;

  @input
  @hint("Menu revealed when the space is set up")
  menuConsole!: MenuConsole;

  @input
  menuConsoleStartAnchor!: SceneObject;

  @input
  onboardingController!: OnboardingController;

  @input
  @hint("Music controller that plays the setup track")
  musicController!: MusicController;

  @input
  introTrack!: AudioTrackAsset;

  @input
  @hint("Track to play when the space is set up")
  mainTrack!: AudioTrackAsset;

  @input
  @widget(new SliderWidget(0, 1))
  trackVolume: number = 0.5;

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

    this.musicController.play(this.introTrack, this.trackVolume);
  }

  private hideSpaceSetup() {
    this.spaceSetup.hide();
    this.menuConsole.hide();
  }

  private onBreadboardPressed(setupPosition: vec3) {
    if (this._initializationComplete) return;

    this.spaceSetup.setPosition(setupPosition);

    this.menuConsole.setPosition(
      this.menuConsoleStartAnchor.getTransform().getWorldPosition(),
    );

    this.menuConsole.show();

    this.onboardingController.setup();

    this.pressBreadboardRecognizer.hide();
    this.musicController.play(this.mainTrack, this.trackVolume);

    this._initializationComplete = true;
  }
}
