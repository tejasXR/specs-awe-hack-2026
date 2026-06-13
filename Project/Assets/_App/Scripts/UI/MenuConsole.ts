import { LSTween } from "LSTween.lspkg/Examples/Scripts/LSTween";
import Easing from "LSTween.lspkg/TweenJS/Easing";
import { Tween } from "LSTween.lspkg/TweenJS/Tween";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";

@component
export class MenuConsole extends BaseScriptComponent {
  @input
  container!: SceneObject;

  @input
  primaryButton!: Interactable;

  @input
  secondaryButton!: Interactable;

  @input
  tertiaryButton!: Interactable;

  private onPrimaryPressedEvent = new Event<void>();
  readonly onPrimaryPressed: PublicApi<void> =
    this.onPrimaryPressedEvent.publicApi();

  private onSecondaryPressedEvent = new Event<void>();
  readonly onSecondaryPressed: PublicApi<void> =
    this.onSecondaryPressedEvent.publicApi();

  private onTertiaryPressedEvent = new Event<void>();
  readonly onTertiaryPressed: PublicApi<void> =
    this.onTertiaryPressedEvent.publicApi();

  private showDurationMs: number = 250;
  private _activeTween?: Tween<{ t: number }>;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart() {
    this.primaryButton.onTriggerEnd.add(() =>
      this.onPrimaryPressedEvent.invoke(),
    );
    this.secondaryButton.onTriggerEnd.add(() =>
      this.onSecondaryPressedEvent.invoke(),
    );
    this.tertiaryButton.onTriggerEnd.add(() =>
      this.onTertiaryPressedEvent.invoke(),
    );
  }

  public show(): void {
    this.stopActiveTween();
    this.container.enabled = true;

    const transform = this.container.getTransform();
    transform.setLocalScale(vec3.zero());

    this._activeTween = LSTween.scaleToLocal(
      transform,
      vec3.one(),
      this.showDurationMs,
    )
      .easing(Easing.Back.Out)
      .start();
  }

  public hide(): void {
    this.stopActiveTween();
    this.container.getTransform().setLocalScale(vec3.zero());
    this.container.enabled = false;
  }

  private stopActiveTween(): void {
    this._activeTween?.stop();
    this._activeTween = undefined;
  }
}
