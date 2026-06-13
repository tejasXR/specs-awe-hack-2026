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

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  onStart() {}

  setup(setupPosition: vec3): void {
    this.getTransform().setWorldPosition(setupPosition);
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
