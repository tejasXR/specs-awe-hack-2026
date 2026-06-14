import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import type { InteractorEvent } from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent";
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ScaleVisibilityAnimator } from "../Utils/ScaleVisibilityAnimator";
import { ZappyInteractionsController } from "../Zappy/ZappyInteractionsController";

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

  @input
  zappyInteractions!: ZappyInteractionsController;

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

  private _isShown: boolean = false;

  private _unsubscribeFromPinch?: unsubscribe;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());

    this._animator = new ScaleVisibilityAnimator(this.getSceneObject(), {
      showDurationMs: 600,
      hideDurationMs: 300,
      shownScale: vec3.one(),
    });
  }

  private onStart() {
    this.primaryButton.onTriggerEnd.add(() => this.onPrimaryActionPressed());
    this.secondaryButton.onTriggerEnd.add(() =>
      this.onSecondaryActionPressed(),
    );
    this.tertiaryButton.onTriggerEnd.add(() => this.onTertiaryActionPressed());

    this._unsubscribeFromPinch = this.zappyInteractions.onPinched.add((event) =>
      this.onZappyPinched(event),
    );
  }

  private onDestroy(): void {
    this._unsubscribeFromPinch?.();
  }

  private onPrimaryActionPressed(): void {
    this.onPrimaryPressedEvent.invoke();
  }

  private onSecondaryActionPressed(): void {
    this.onSecondaryPressedEvent.invoke();
  }

  private onTertiaryActionPressed(): void {
    this.onTertiaryPressedEvent.invoke();
  }

  // Gate on the pinch path (not inside onPrimaryActionPressed) so direct button
  // presses are never suppressed. Payload kept in case a consumer needs it.
  private onZappyPinched(event: InteractorEvent): void {
    if (!this._isShown) {
      return;
    }
    this.onPrimaryActionPressed();
  }

  public setPosition(position: vec3): void {
    this.getTransform().setWorldPosition(position);
  }

  public show(): void {
    this._isShown = true;
    this._animator.show();
  }

  public hide(): void {
    this._isShown = false;
    this._animator.hide(false);
  }
}
