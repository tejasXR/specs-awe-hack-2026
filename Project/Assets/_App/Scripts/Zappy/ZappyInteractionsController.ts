import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import type { InteractorEvent } from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent";
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";

/**
 * Classifies a press on Zappy as a TAP or a HOLD.
 *
 *   - Released before `holdThreshold` seconds → onPinched (the legacy "select"
 *     signal; existing consumers fire on release instead of press-down).
 *   - Held past the threshold → onHoldStart fires (while still held), and
 *     onHoldEnd fires on release — the press-and-hold-to-talk gesture.
 *
 * A DelayedCallbackEvent armed on press-down decides which it is (LS has no
 * setTimeout). Releasing early clears the active-press flag, so a late timer
 * no-ops; either of trigger end / end-outside / canceled ends the press.
 */
@component
export class ZappyInteractionsController extends BaseScriptComponent {
  @input
  @hint("The Interactable on the character's pinch target (needs a collider)")
  interactable!: Interactable;

  @input
  @hint(
    "Seconds to hold Zappy before it becomes a talk gesture (else it's a tap)",
  )
  @widget(new SliderWidget(0.2, 2, 0.05))
  holdThreshold: number = 0.85;

  private readonly onPinchedEvent = new Event<InteractorEvent>();
  /** Fires on a short tap — a press released before the hold threshold. */
  readonly onPinched: PublicApi<InteractorEvent> =
    this.onPinchedEvent.publicApi();

  private readonly onHoldStartEvent = new Event<InteractorEvent>();
  /** Fires once a press passes the hold threshold while still held. */
  readonly onHoldStart: PublicApi<InteractorEvent> =
    this.onHoldStartEvent.publicApi();

  private readonly onHoldEndEvent = new Event<void>();
  /** Fires when a hold is released — the release-to-send signal. */
  readonly onHoldEnd: PublicApi<void> = this.onHoldEndEvent.publicApi();

  private _unsubs: unsubscribe[] = [];
  private _pressActive = false;
  private _holdFired = false;
  private _startEvent: InteractorEvent | null = null;
  private _holdTimer?: DelayedCallbackEvent;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    this._unsubs.push(
      this.interactable.onTriggerStart.add((event) => this.handleStart(event)),
    );
    this._unsubs.push(
      this.interactable.onTriggerEnd.add((event) => this.handleEnd(event)),
    );
    this._unsubs.push(
      this.interactable.onTriggerEndOutside.add((event) =>
        this.handleEnd(event),
      ),
    );
    this._unsubs.push(
      this.interactable.onTriggerCanceled.add((event) => this.handleEnd(event)),
    );
  }

  private handleStart(event: InteractorEvent): void {
    this._pressActive = true;
    this._holdFired = false;
    this._startEvent = event;

    this.clearHoldTimer();
    const timer = this.createEvent("DelayedCallbackEvent");
    timer.bind(() => this.onHoldThreshold());
    // @ts-ignore — DelayedCallbackEvent.reset takes seconds
    timer.reset(this.holdThreshold);
    this._holdTimer = timer;
  }

  /** Threshold crossed while still held → this press is a hold. */
  private onHoldThreshold(): void {
    // An early release clears _pressActive, so a late timer firing is a no-op.
    if (!this._pressActive) {
      return;
    }
    this._holdFired = true;
    this.onHoldStartEvent.invoke(this._startEvent!);
  }

  /**
   * End the press. One of onTriggerEnd / EndOutside / Canceled fires per press;
   * the _pressActive guard makes any second one a no-op.
   */
  private handleEnd(event: InteractorEvent): void {
    if (!this._pressActive) {
      return;
    }
    this._pressActive = false;
    this.clearHoldTimer();

    if (this._holdFired) {
      this.onHoldEndEvent.invoke();
    } else {
      this.onPinchedEvent.invoke(event);
    }

    this._holdFired = false;
    this._startEvent = null;
  }

  private clearHoldTimer(): void {
    if (this._holdTimer) {
      this.removeEvent(this._holdTimer);
      this._holdTimer = undefined;
    }
  }

  private onDestroy(): void {
    this.clearHoldTimer();
    this._unsubs.forEach((unsub) => unsub());
    this._unsubs = [];
  }
}
