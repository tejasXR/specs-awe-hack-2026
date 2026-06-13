import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import { Keypoint } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/Keypoint";
import type TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand";
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";

type HoldState =
  | { phase: "idle" }
  | { phase: "holding"; anchor: vec3; elapsed: number; graceElapsed: number }
  | { phase: "completed" };

/**
 * Recognizes a "pointing hold": the index finger extended (all other fingers
 * curled) and held still for a duration. Fires onHoldStart once the engage
 * threshold is crossed, and onHoldComplete (with the fingertip position) once
 * the full hold duration is reached. After completing it stays in a terminal
 * state and will not fire again.
 *
 * Finger extension/curl is measured the same way SIK's own `palmState` does it:
 * the cosine of the bend angle at a finger's mid joint (see
 * TrackedHand.getMiddleKnuckleBendDotProduct). A straight finger's joint arms
 * point nearly opposite (dot → -1); a curled finger's swing parallel (dot rises).
 */
@component
export class PressBreadboardRecognizer extends BaseScriptComponent {
  @input
  @hint(
    "Index must bend MORE than this angle (degrees) to count as extended. SIK treats 150° as flat/straight.",
  )
  extendedAngle: number = 150;

  @input
  @hint(
    "A finger must bend LESS than this angle (degrees) to count as curled. SIK treats 80° as closed.",
  )
  curledAngle: number = 80;

  @input
  @hint("Debug readout for hand-tracking / pointing-pose state.")
  debugText!: Text;

  private _stillnessRadius: number = 2.0;
  private _holdDuration: number = 0.5;
  private _holdCompleteDuration: number = 1.5;
  // A brief pose/stillness/tracking dropout shorter than this won't cancel the hold.
  private _resetGraceDuration: number = 0.15;

  private hand!: TrackedHand;
  private state: HoldState = { phase: "idle" };

  private onHoldStartEvent = new Event<vec3>();
  readonly onHoldStart: PublicApi<vec3> = this.onHoldStartEvent.publicApi();
  private onHoldCompleteEvent = new Event<vec3>();
  readonly onHoldComplete: PublicApi<vec3> =
    this.onHoldCompleteEvent.publicApi();

  onAwake(): void {
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());

    // TEJAS: Won't work in LS editor...
    this.hand = HandInputData.getInstance().getDominantHand();
  }

  private onUpdate() {
    if (this.state.phase === "completed") return;

    const dt = getDeltaTime();
    const poseHeld = this.isPointingPose(); // false (and updates debug text) when untracked

    switch (this.state.phase) {
      case "idle":
        if (poseHeld) {
          this.state = {
            phase: "holding",
            anchor: this.hand.indexTip.position,
            elapsed: 0,
            graceElapsed: 0,
          };
        }
        break;

      case "holding": {
        // Short-circuits before reading the tip when the pose (and thus tracking) is lost.
        const gateHeld =
          poseHeld &&
          this.isStill(this.hand.indexTip.position, this.state.anchor);

        if (!gateHeld) {
          const graceElapsed = this.state.graceElapsed + dt;
          if (graceElapsed > this._resetGraceDuration) {
            this.state = { phase: "idle" }; // sustained failure → cancel
          } else {
            // brief flicker → hold the elapsed timer steady, just track the gap
            this.state = { ...this.state, graceElapsed };
          }
          break;
        }

        const prev = this.state.elapsed;
        const elapsed = prev + dt;

        // Fire onHoldStart on the single frame the engage threshold is crossed.
        if (prev < this._holdDuration && elapsed >= this._holdDuration) {
          this.onHoldStartEvent.invoke(this.state.anchor);
        }

        if (elapsed >= this._holdCompleteDuration) {
          this.state = { phase: "completed" };
          this.onHoldCompleteEvent.invoke(this.hand.indexTip.position);
        } else {
          this.state = {
            phase: "holding",
            anchor: this.state.anchor,
            elapsed,
            graceElapsed: 0,
          };
        }
        break;
      }
    }
  }

  /** Index extended, middle/ring/pinky curled. Thumb is ignored. */
  private isPointingPose(): boolean {
    if (!this.hand.isTracked()) {
      this.debugText.text = "Hand is not tracked!";
      return false;
    }

    const index = this.isFingerExtended(this.hand.indexFinger);
    const middle = this.isFingerCurled(this.hand.middleFinger);
    const ring = this.isFingerCurled(this.hand.ringFinger);
    const pinky = this.isFingerCurled(this.hand.pinkyFinger);

    const pointing = index && middle && ring && pinky;

    this.debugText.text =
      `Pointing pose: ${pointing}` +
      ` (index:${index} m:${middle} r:${ring} p:${pinky})`;

    return pointing;
  }

  private fingerBendDot(finger: Keypoint[]): number {
    const knuckle = finger[1].position;
    const mid = finger[2].position;
    const upper = finger[3].position;

    const midToUpper = upper.sub(mid).normalize();
    const midToKnuckle = knuckle.sub(mid).normalize();

    return midToUpper.dot(midToKnuckle);
  }

  private isFingerExtended(finger: Keypoint[]): boolean {
    // Straight finger → arms point apart → dot below cos(extendedAngle).
    return (
      this.fingerBendDot(finger) <
      Math.cos(this.extendedAngle * MathUtils.DegToRad)
    );
  }

  private isFingerCurled(finger: Keypoint[]): boolean {
    // Bent finger → arms swing together → dot above cos(curledAngle).
    return (
      this.fingerBendDot(finger) >
      Math.cos(this.curledAngle * MathUtils.DegToRad)
    );
  }

  private isStill(tip: vec3, anchor: vec3): boolean {
    return tip.distance(anchor) <= this._stillnessRadius;
  }
}
