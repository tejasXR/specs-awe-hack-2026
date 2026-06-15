import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { SIK } from "SpectaclesInteractionKit.lspkg/SIK";
import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand";
import { BreadboardBleController, LedCommand } from "./BreadboardBleController";
import { BreadboardBleData } from "./BreadboardBleData";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Two-handed gesture control of the breadboard LED, written through
 * BreadboardBleController.setCommand (one merged command, latest-wins throttle).
 *
 *   LEFT  hand — pinch + raise/lower to set brightness (floor..100%).
 *   RIGHT hand — pinch to flash; raise/lower to set flash rate; release → solid.
 *
 * Each hand owns one field of the shared command: the left drives brightness,
 * the right drives flash mode + rate. They compose — flashing at the brightness
 * the left hand last set.
 *
 * Heights are read relative to the index-tip position captured at pinch-down,
 * so the gesture works wherever the user's hand happens to be. World units are
 * centimetres in Lens Studio, so the *TravelCm inputs map straight to position.
 *
 * Device-only: hand tracking does not run in the editor, so this stays idle in
 * preview — use BreadboardBleController.simulateInEditor to exercise the link.
 */
@component
export class LedGestureController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">LedGestureController</span><br/><span style="color: #94A3B8; font-size: 11px;">Left hand = brightness, right hand = flash. Writes to BreadboardBleController.</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("The BLE link this controller writes LED commands to")
  bleController!: BreadboardBleController;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Left hand — brightness</span>')
  @input
  @hint("Lowest brightness (pinch height = floor). 0.2 = 20%")
  minBrightness: number = 0.2;

  @input
  @hint("Vertical hand travel above pinch height for full brightness, in cm")
  brightnessTravelCm: number = 20;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Right hand — flash</span>')
  @input
  @hint("Flash rate at pinch height, in Hz")
  defaultFlashHz: number = 2;

  @input
  @hint("Slowest flash rate (hand fully lowered), in Hz")
  minFlashHz: number = 0;

  @input
  @hint("Fastest flash rate (hand fully raised), in Hz. Board caps at 12.7")
  maxFlashHz: number = 10;

  @input
  @hint("Vertical hand travel from pinch height to a rate extreme, in cm")
  flashTravelCm: number = 20;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Print gesture state changes")
  enableLogging: boolean = false;

  private readonly onCommandChangedEvent = new Event<LedCommand>();
  /** Fires with the merged command each time it changes (for debug/UI). */
  readonly onCommandChanged: PublicApi<LedCommand> =
    this.onCommandChangedEvent.publicApi();

  private leftHand!: TrackedHand;
  private rightHand!: TrackedHand;
  private updateEvent!: UpdateEvent;

  // Gated until activate() (driven by LedControlActivator). Pinch-down is the
  // only entry into a gesture, so guarding it there keeps every downstream path
  // idle until then.
  private _active: boolean = false;

  // Per-hand gesture state
  private leftPinching: boolean = false;
  private rightPinching: boolean = false;
  private leftBaselineY: number = 0;
  private rightBaselineY: number = 0;

  // Shared command state
  private brightness: number = 0; // 0..1; starts off
  private flashHz: number = 0;

  // Change-detection so we only write when something actually moved
  private _lastMode: BreadboardBleData.LedMode = BreadboardBleData.LedMode.Solid;
  private _lastBrightness: number = -1;
  private _lastFlashHz: number = -1;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    if (isNull(this.bleController)) {
      this.log("'bleController' input is not wired — gestures will do nothing.");
      return;
    }

    const handInput = SIK.HandInputData;
    this.leftHand = handInput.getHand("left");
    this.rightHand = handInput.getHand("right");

    this.leftHand.onPinchDown.add(() => this.onLeftPinchDown());
    this.leftHand.onPinchUp.add(() => this.onLeftPinchUp());
    this.rightHand.onPinchDown.add(() => this.onRightPinchDown());
    this.rightHand.onPinchUp.add(() => this.onRightPinchUp());

    // Only runs while at least one hand is pinching.
    this.updateEvent = this.createEvent("UpdateEvent");
    this.updateEvent.bind(() => this.onUpdate());
    this.updateEvent.enabled = false;
  }

  // ---- Activation -----------------------------------------------------------

  /** Begin responding to LED gestures. Idempotent. */
  activate(): void {
    this._active = true;
    this.log("activated");
  }

  /** Stop responding; clears any in-progress pinch so nothing sticks. */
  deactivate(): void {
    this._active = false;
    this.leftPinching = false;
    this.rightPinching = false;
    this.syncUpdateEnabled();
    this.log("deactivated");
  }

  // ---- Pinch transitions ----------------------------------------------------

  private onLeftPinchDown(): void {
    if (!this._active) return;
    this.leftPinching = true;
    this.leftBaselineY = this.leftHand.indexTip.position.y;
    this.updateBrightnessFromHand();
    this.syncUpdateEnabled();
    this.pushCommand();
    this.log("left pinch down");
  }

  private onLeftPinchUp(): void {
    this.leftPinching = false; // brightness holds its last value
    this.syncUpdateEnabled();
    this.log("left pinch up");
  }

  private onRightPinchDown(): void {
    if (!this._active) return;
    this.rightPinching = true;
    this.rightBaselineY = this.rightHand.indexTip.position.y;
    this.flashHz = this.defaultFlashHz;
    this.syncUpdateEnabled();
    this.pushCommand();
    this.log("right pinch down — flash on");
  }

  private onRightPinchUp(): void {
    this.rightPinching = false; // back to solid at current brightness
    this.syncUpdateEnabled();
    this.pushCommand();
    this.log("right pinch up — solid");
  }

  // ---- Per-frame tracking (only while pinching) -----------------------------

  private onUpdate(): void {
    if (this.leftPinching && this.leftHand.isTracked()) {
      this.updateBrightnessFromHand();
    }
    if (this.rightPinching && this.rightHand.isTracked()) {
      this.updateFlashFromHand();
    }
    this.pushCommand();
  }

  /** Raise the left hand above the pinch height to brighten; floor at minBrightness. */
  private updateBrightnessFromHand(): void {
    const deltaUpCm = this.leftHand.indexTip.position.y - this.leftBaselineY;
    const t = clamp(deltaUpCm / this.brightnessTravelCm, 0, 1);
    this.brightness = this.minBrightness + t * (1 - this.minBrightness);
  }

  /** Pinch height = defaultFlashHz; raise → toward max, lower → toward min. */
  private updateFlashFromHand(): void {
    const deltaUpCm = this.rightHand.indexTip.position.y - this.rightBaselineY;
    const t = clamp(deltaUpCm / this.flashTravelCm, -1, 1);
    this.flashHz =
      t >= 0
        ? this.defaultFlashHz + t * (this.maxFlashHz - this.defaultFlashHz)
        : this.defaultFlashHz + t * (this.defaultFlashHz - this.minFlashHz);
  }

  // ---- Write merged command -------------------------------------------------

  private pushCommand(): void {
    const mode = this.rightPinching
      ? BreadboardBleData.LedMode.Flash
      : BreadboardBleData.LedMode.Solid;

    // Keep a flash visible even if the left hand never set a brightness.
    const brightness =
      mode === BreadboardBleData.LedMode.Flash
        ? Math.max(this.brightness, this.minBrightness)
        : this.brightness;

    if (
      mode === this._lastMode &&
      Math.abs(brightness - this._lastBrightness) < 0.005 &&
      Math.abs(this.flashHz - this._lastFlashHz) < 0.05
    ) {
      return; // nothing changed — don't churn the BLE link
    }
    this._lastMode = mode;
    this._lastBrightness = brightness;
    this._lastFlashHz = this.flashHz;

    const command: LedCommand = { mode, brightness, flashHz: this.flashHz };
    this.bleController.setCommand(command);
    this.onCommandChangedEvent.invoke(command);
  }

  private syncUpdateEnabled(): void {
    this.updateEvent.enabled = this.leftPinching || this.rightPinching;
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[" + LedGestureController.name + "] " + message);
    }
  }
}
