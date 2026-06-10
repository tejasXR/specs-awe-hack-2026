import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import type { InteractorEvent } from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent";
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";

@component
export class AiCharacterInteractionController extends BaseScriptComponent {
  @input
  @hint("The Interactable on the character's pinch target (needs a collider)")
  interactable!: Interactable;

  private readonly onPinchedEvent = new Event<InteractorEvent>();

  readonly onPinched: PublicApi<InteractorEvent> =
    this.onPinchedEvent.publicApi();

  private _unsubscribeFromTrigger?: unsubscribe;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    this.interactable.onTriggerStart.add((event) => this.handlePinched(event));
  }

  private handlePinched(event: InteractorEvent): void {
    this.onPinchedEvent.invoke(event);
  }

  private onDestroy(): void {}
}
