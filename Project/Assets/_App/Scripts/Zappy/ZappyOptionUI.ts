import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ScaleVisibilityAnimator } from "../Utils/ScaleVisibilityAnimator";

@component
export class ZappyOptionUI extends BaseScriptComponent {
  @input
  @hint("Pinch button that selects this option")
  pinchButton!: Interactable;

  private readonly onOptionSelectedEvent = new Event<ZappyOptionUI>();

  readonly onOptionSelected: PublicApi<ZappyOptionUI> =
    this.onOptionSelectedEvent.publicApi();

  private _animator!: ScaleVisibilityAnimator;
  private _unsubscribeFromPinchButton?: unsubscribe;

  constructor() {
    super();
  }

  onAwake(): void {
    this._animator = new ScaleVisibilityAnimator(this.getSceneObject(), {
      showDurationMs: 250,
      hideDurationMs: 180,
      shownScale: vec3.one(),
    });

    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    this._unsubscribeFromPinchButton = this.pinchButton.onTriggerEnd.add(
      (event) => this.optionSelected(),
    );
  }

  private onDestroy(): void {
    this._unsubscribeFromPinchButton?.();
  }

  show(): void {
    this._animator.show();
  }

  hide(): void {
    this._animator.hide();
  }

  private optionSelected() {
    this.onOptionSelectedEvent.invoke(this);
  }
}
