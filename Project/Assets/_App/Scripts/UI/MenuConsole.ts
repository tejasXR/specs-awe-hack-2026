import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";

@component
export class MenuConsole extends BaseScriptComponent {
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

  public show(): void {}
  public hide(): void {}
}
