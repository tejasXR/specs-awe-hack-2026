import { unsubscribe } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { OnboardingController } from "./OnboardingController";
import { SpaceSetup } from "./SpaceSetup";
import { ZappyAI } from "./Zappy/ZappyAI";

// Using 0-based step index
const STEP_SHOW_SPACE_SETUP = 1;
const STEP_SHOW_ZAPPY = 2;

@component
export class OnboardingResponder extends BaseScriptComponent {
  @input
  @hint("Emits the onStepChanged events this responder reacts to")
  onboardingController!: OnboardingController;

  @input
  spaceSetup!: SpaceSetup;

  @input
  zappy!: ZappyAI;

  @input
  @hint("World transform Zappy travels to when its step is reached")
  zappySetupAnchor!: SceneObject;

  private _unsubscribers: unsubscribe[] = [];

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    this._unsubscribers.push(
      this.onboardingController.onStepChanged.add((step) =>
        this.handleStepChanged(step),
      ),
    );
  }

  private onDestroy(): void {
    this._unsubscribers.forEach((unsub) => unsub());
    this._unsubscribers = [];
  }

  private handleStepChanged(step: number): void {
    switch (step) {
      case STEP_SHOW_SPACE_SETUP:
        this.zappy.hide();
        this.spaceSetup.show();
        break;
      case STEP_SHOW_ZAPPY:
        this.spaceSetup.hide();
        this.zappy.show();
        this.zappy.moveTo(
          this.zappySetupAnchor.getTransform().getWorldPosition(),
        );
        break;
    }
  }
}
