import { LSTween } from "LSTween.lspkg/Examples/Scripts/LSTween";
import Easing from "LSTween.lspkg/TweenJS/Easing";
import { Tween } from "LSTween.lspkg/TweenJS/Tween";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { PinchButton } from "SpectaclesInteractionKit.lspkg/Components/UI/PinchButton/PinchButton";
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";

@component
export class AiCharacterOption extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("Pinch button that selects this option")
  pinchButton!: Interactable;

  private _showDurationMs: number = 250;
  private _hideDurationMs: number = 180;

  private readonly onOptionSelectedEvent = new Event<AiCharacterOption>();

  readonly onOptionSelected: PublicApi<AiCharacterOption> =
    this.onOptionSelectedEvent.publicApi();

  private _transform!: Transform;
  private _activeTween?: Tween<{ t: number }>;
  private _unsubscribeFromPinchButton?: unsubscribe;

  constructor() {
    super();
  }

  onAwake(): void {
    this._transform = this.getTransform();
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    if (isNull(this.pinchButton)) {
      print("[AiCharacterOption] ⚠ pinchButton not assigned on '" + this.getSceneObject().name + "' — skipping");
      return;
    }
    this._unsubscribeFromPinchButton = this.pinchButton.onTriggerEnd.add(
      (event) => this.optionSelected(),
    );
  }

  private onDestroy(): void {
    this._unsubscribeFromPinchButton?.();
  }

  show(): void {
    this.stopActiveTween();
    this.sceneObject.enabled = true;

    // Tween from the *current* scale so an interrupted hide reverses smoothly.
    this._activeTween = LSTween.scaleToLocal(
      this._transform,
      vec3.one(),
      this._showDurationMs,
    )
      .easing(Easing.Back.Out)
      .start();
  }

  hide(): void {
    this.stopActiveTween();

    this._activeTween = LSTween.scaleToLocal(
      this._transform,
      vec3.zero(),
      this._hideDurationMs,
    )
      .easing(Easing.Back.In)
      .onComplete(() => {
        this.sceneObject.enabled = false;
      })
      .start();
  }

  private optionSelected() {
    this.onOptionSelectedEvent.invoke(this);
  }

  private stopActiveTween(): void {
    this._activeTween?.stop();
    this._activeTween = undefined;
  }
}
