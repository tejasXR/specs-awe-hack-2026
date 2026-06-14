import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ScaleVisibilityAnimator } from "../Utils/ScaleVisibilityAnimator";

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

  private _animator!: ScaleVisibilityAnimator;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart());

    this._animator = new ScaleVisibilityAnimator(this.getSceneObject(), {
      showDurationMs: 600,
      hideDurationMs: 300,
      shownScale: vec3.one(),
    });
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

  public setPosition(position: vec3): void {
    this.getTransform().setWorldPosition(position);
  }

  public show(): void {
    this._animator.show();
  }

  public hide(): void {
    this._animator.hide(false);
  }
}
