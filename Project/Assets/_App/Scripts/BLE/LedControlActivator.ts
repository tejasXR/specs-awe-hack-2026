import { unsubscribe } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { InstructionsController } from "../Instructional/InstructionsController";
import { MusicController } from "../MusicController";
import { BreadboardBleController } from "./BreadboardBleController";
import { LedGestureController } from "./LedGestureController";

/**
 * Phase handoff: when the user reaches the final instruction step (the
 * "pinch anywhere to illuminate the LED" step), bring the LED layer online —
 * connect the BLE link and enable the hand-gesture controls.
 *
 * This coordinator owns the cross-layer dependency so the BLE components stay
 * ignorant of the instructional layer (mirroring how the next phase subscribes
 * to the previous one's completion elsewhere in the app). It listens for
 * InstructionsController.onFinalStepEntered, which fires on *entering* the last
 * step — not on advancing past it — so the board is live while the step shows.
 *
 * Set BreadboardBleController.autoConnectOnStart = false and
 * LedGestureController.activateOnStart = false so this is the single trigger.
 */
@component
export class LedControlActivator extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">LedControlActivator</span><br/><span style="color: #94A3B8; font-size: 11px;">Connects BLE + enables LED gestures when the final instruction step is entered.</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("Fires onFinalStepEntered when the last build step is shown")
  instructionsController!: InstructionsController;

  @input
  @hint("BLE link to connect on handoff (set its autoConnectOnStart = false)")
  bleController!: BreadboardBleController;

  @input
  @hint("Gesture controls to activate on handoff (set activateOnStart = false)")
  gestureController!: LedGestureController;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Music</span>')
  @input
  @hint("Music controller to crossfade a track on handoff (optional)")
  @allowUndefined
  musicController?: MusicController;

  @input
  @hint("Track to crossfade to when the LED feature activates (optional)")
  @allowUndefined
  ledTrack?: AudioTrackAsset;

  @input
  @hint("Per-track volume for the LED track (0–1)")
  @widget(new SliderWidget(0, 1))
  ledTrackVolume: number = 0.7;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Print the handoff")
  enableLogging: boolean = false;

  // The final step can be re-entered (back-then-forward, or a check-work pass);
  // the handoff should run once.
  private _handedOff: boolean = false;

  private _unsubscribeFromFinalStep?: unsubscribe;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    if (isNull(this.instructionsController)) {
      this.log("instructionsController unwired — no handoff will occur.");
      return;
    }
    this._unsubscribeFromFinalStep =
      this.instructionsController.onFinalStepEntered.add(() =>
        this.onFinalStepEntered(),
      );
  }

  private onDestroy(): void {
    this._unsubscribeFromFinalStep?.();
  }

  /** Last build step is on screen — bring the LED layer online, once. */
  private onFinalStepEntered(): void {
    if (this._handedOff) {
      return;
    }
    this._handedOff = true;
    this.log("final step entered — connecting BLE and activating gestures");

    if (!isNull(this.bleController)) {
      this.bleController.connect(); // idempotent; no-op if already connected
    }
    if (!isNull(this.gestureController)) {
      this.gestureController.activate();
    }
    if (!isNull(this.musicController) && !isNull(this.ledTrack)) {
      this.musicController.play(this.ledTrack, this.ledTrackVolume);
    }
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[" + LedControlActivator.name + "] " + message);
    }
  }
}
