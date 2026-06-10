import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { AiCharacterInteractionController } from "./AiCharacterInteractionController";
import { AiCharacterOption } from "./AiCharacterOption";

@component
export class AiCharacterOptionsController extends BaseScriptComponent {
  @input
  interactions!: AiCharacterInteractionController;

  @input
  @hint(
    "Disable all option objects on start so the pinch reveal is deterministic",
  )
  hideOnStart: boolean = true;

  private _optionStaggerMs: number = 100;

  @input
  optionObjects!: AiCharacterOption[];

  private readonly onOptionsToggledEvent = new Event<boolean>();

  readonly onOptionsToggled: PublicApi<boolean> =
    this.onOptionsToggledEvent.publicApi();

  private _optionsVisible: boolean = false;
  private _toggleGeneration: number = 0; // invalidates in-flight stagger sequences
  private _unsubscribeFromPinch?: unsubscribe;
  private _unsubscribesFromOptions: unsubscribe[] = [];

  get optionsVisible(): boolean {
    return this._optionsVisible;
  }

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    if (isNull(this.interactions)) {
      print("Interactions controller not wired -- returning early.");
      return;
    }

    if (this.hideOnStart) {
      void this.setOptionsEnabled(false);
    }

    this._unsubscribeFromPinch = this.interactions.onPinched.add(() =>
      this.onCharacterPinched(),
    );

    this._unsubscribesFromOptions = this.optionObjects.map((option) =>
      option.onOptionSelected.add((selected) => this.onOptionSelected(selected)),
    );
  }

  private onDestroy(): void {
    this._unsubscribeFromPinch?.();
    this._unsubscribesFromOptions.forEach((unsubscribe) => unsubscribe());
  }

  onCharacterPinched(): void {
    if (this._optionsVisible) {
      this.hideOptions();
    } else {
      this.showOptions();
    }
  }

  /** An option was selected — dismiss the menu. */
  private onOptionSelected(option: AiCharacterOption): void {
    this.hideOptions();
  }

  showOptions(): void {
    void this.setOptionsEnabled(true);
  }

  hideOptions(): void {
    void this.setOptionsEnabled(false);
  }

  private async setOptionsEnabled(enabled: boolean): Promise<void> {
    // Bumping the generation also cancels any in-flight show stagger on hide.
    const generation = ++this._toggleGeneration;
    this._optionsVisible = enabled;
    this.onOptionsToggledEvent.invoke(enabled);

    if (enabled) {
      for (let i = 0; i < this.optionObjects.length; i++) {
        if (i > 0) {
          await this.delaySeconds(this._optionStaggerMs / 1000);
        }

        // A newer toggle superseded this run mid-stagger — let it take over.
        if (generation !== this._toggleGeneration) {
          return;
        }

        const option = this.optionObjects[i];
        option.show();
      }
    } else {
      this.optionObjects.forEach((option) => {
        option.hide();
      });
    }
  }

  /** Awaitable one-shot delay built on DelayedCallbackEvent (LS has no setTimeout). */
  private delaySeconds(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const delayEvent = this.createEvent("DelayedCallbackEvent");
      delayEvent.bind(() => {
        this.removeEvent(delayEvent);
        resolve();
      });
      delayEvent.reset(seconds);
    });
  }
}
