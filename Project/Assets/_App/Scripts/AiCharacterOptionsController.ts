import type { unsubscribe } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { AiCharacterInteractionController } from "./AiCharacterInteractions";

@component
export class AiCharacterOptionsController extends BaseScriptComponent {
  @input
  interactions!: AiCharacterInteractionController;

  @input
  @hint(
    "Disable all option objects on start so the pinch reveal is deterministic",
  )
  hideOnStart: boolean = true;

  @input
  optionObjects!: SceneObject[];

  private _unsubscribeFromPinch?: unsubscribe;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    if (isNull(this.interactions)) {
      print(
        "[AiCharacterOptionsController] 'interactions' input is not wired — disabled.",
      );
      return;
    }

    if (this.hideOnStart) {
      this.setOptionsEnabled(false);
    }

    this._unsubscribeFromPinch = this.interactions.onPinched.add(() =>
      this.showOptions(),
    );
  }

  private onDestroy(): void {
    this._unsubscribeFromPinch?.();
  }

  showOptions(): void {
    this.setOptionsEnabled(true);
  }

  hideOptions(): void {
    this.setOptionsEnabled(false);
  }

  private setOptionsEnabled(enabled: boolean): void {
    for (const option of this.optionObjects) {
      option.enabled = enabled;
    }
  }
}
