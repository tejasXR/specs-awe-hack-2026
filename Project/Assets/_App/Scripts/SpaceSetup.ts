import { MenuConsole } from "./UI/MenuConsole";
import { MusicController } from "./MusicController";

@component
export class SpaceSetup extends BaseScriptComponent {
  @input
  @hint("Menu revealed when the space is set up")
  menuConsole!: MenuConsole;

  @input
  @hint("Scene content enabled when the space is set up")
  componentDividers!: SceneObject[];

  @input
  @hint("Music controller that plays the setup track")
  musicController!: MusicController;

  @input
  @hint("Track to play when the space is set up")
  musicTrack!: AudioTrackAsset;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  onStart() {
    this.menuConsole.hide();

    this.componentDividers.forEach((element) => {
      element.enabled = false;
    });
  }

  setup(setupPosition: vec3): void {
    this.getTransform().setWorldPosition(setupPosition);
    this.menuConsole.show();

    this.componentDividers.forEach((element) => {
      element.enabled = true;
    });

    this.musicController.play(this.musicTrack);
  }
}
