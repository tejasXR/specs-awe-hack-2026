import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import { Keypoint } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/Keypoint";
import type TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand";
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ScaleVisibilityAnimator } from "./Utils/ScaleVisibilityAnimator";

type HoldState =
  | { phase: "idle" }
  | {
      phase: "holding";
      hand: TrackedHand;
      anchor: vec3;
      elapsed: number;
      graceElapsed: number;
    }
  | { phase: "completed" };

/** Per-finger breakdown of the pointing-pose check, for on-device debugging. */
interface PoseEvaluation {
  tracked: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pointing: boolean;
  /** Live bend angles (degrees) for tuning the thresholds on-device. */
  indexAngle: number;
  middleAngle: number;
  ringAngle: number;
}

/** A hand paired with the pose it presented this frame. */
interface HandPose {
  hand: TrackedHand;
  pose: PoseEvaluation;
}

/**
 * Recognizes a "pointing hold": the index finger extended (middle and ring
 * curled) and held still for a duration. Fires onHoldStart once the engage
 * threshold is crossed, and onHoldComplete (with the fingertip position) once
 * the full hold duration is reached. After completing it stays in a terminal
 * state and will not fire again.
 *
 * Either hand may perform the hold. While idle the recognizer scans both
 * hands (dominant-first) for the pose; once a hold begins it commits to that
 * hand and ignores the other until the hold ends or cancels.
 *
 * Finger extension/curl is measured the same way SIK's own `palmState` does it:
 * the cosine of the bend angle at a finger's mid joint (see
 * TrackedHand.getMiddleKnuckleBendDotProduct). A straight finger's joint arms
 * point nearly opposite (dot → -1); a curled finger's swing parallel (dot rises).
 */
@component
export class PressBreadboardRecognizer extends BaseScriptComponent {
  @ui.separator
  @ui.label("Pose Thresholds")
  @input
  @hint(
    "Index bend angle (deg) ABOVE which it counts as extended. ~180 = straight. LOWER this to accept a more bent index (less strict).",
  )
  @widget(new SliderWidget(20, 180, 1))
  extendedAngle: number = 135;

  @input
  @hint(
    "Finger bend angle (deg) BELOW which it counts as curled. RAISE this to accept a looser curl (less strict).",
  )
  @widget(new SliderWidget(20, 180, 1))
  curledAngle: number = 95;

  @ui.separator
  @ui.label("References")
  @input
  @hint("Instructional prompt shown during breadboard activation.")
  recognizerText!: Text;

  @input
  @hint("Optional on-device readout of the pointing-pose finger logic.")
  @allowUndefined
  debugText!: Text;

  @ui.separator
  @ui.label("Hold Timing")
  @input
  @hint(
    "How far (cm) the fingertip may drift from where the hold began before it cancels. RAISE for a more forgiving hold.",
  )
  @widget(new SliderWidget(1, 12, 0.5))
  stillnessRadius: number = 4.0;

  @input
  @hint("Seconds of valid hold before onHoldStart fires (engage point).")
  @widget(new SliderWidget(0, 2, 0.05))
  holdDuration: number = 0.5;

  @input
  @hint("Total seconds of valid hold before onHoldComplete fires (activation).")
  @widget(new SliderWidget(0.2, 4, 0.05))
  holdCompleteDuration: number = 1.5;

  @input
  @hint(
    "A pose/tracking dropout shorter than this (sec) won't cancel the hold. RAISE to ride through more jitter.",
  )
  @widget(new SliderWidget(0, 1, 0.05))
  resetGraceDuration: number = 0.3;

  private _animator!: ScaleVisibilityAnimator;

  private static readonly IDLE_MESSAGE =
    "Touch and hold the center of your breadboard to activate the experience...";
  /** Shown while the hold is in progress. */
  private static readonly PRESSING_MESSAGE = "Calibrating, keep holding...";

  /** Both hands, dominant-first — the scan order while idle. */
  private hands!: TrackedHand[];
  private state: HoldState = { phase: "idle" };

  private onHoldStartEvent = new Event<vec3>();
  readonly onHoldStart: PublicApi<vec3> = this.onHoldStartEvent.publicApi();
  private onHoldCompleteEvent = new Event<vec3>();
  readonly onHoldComplete: PublicApi<vec3> =
    this.onHoldCompleteEvent.publicApi();

  onAwake(): void {
    this._animator = new ScaleVisibilityAnimator(this.getSceneObject(), {
      showDurationMs: 250,
      hideDurationMs: 180,
      shownScale: vec3.one(),
    });

    this.createEvent("UpdateEvent").bind(() => this.onUpdate());

    const handInput = HandInputData.getInstance();
    this.hands = [handInput.getDominantHand(), handInput.getNonDominantHand()];

    this.setMessage(PressBreadboardRecognizer.IDLE_MESSAGE);
  }

  private onUpdate() {
    if (this.state.phase === "completed") return;

    const dt = getDeltaTime();

    // The hand we act on this frame and its pose. While holding we stay
    // committed to one hand; while idle we scan both (dominant-first), so once
    // a hold begins the other hand is ignored for its whole duration.
    const focus: HandPose =
      this.state.phase === "holding"
        ? { hand: this.state.hand, pose: this.evaluatePose(this.state.hand) }
        : this.scanForPose();
    const poseHeld = focus.pose.pointing; // false when untracked

    switch (this.state.phase) {
      case "idle":
        if (poseHeld) {
          this.state = {
            phase: "holding",
            hand: focus.hand,
            anchor: focus.hand.indexTip.position,
            elapsed: 0,
            graceElapsed: 0,
          };
        }
        break;

      case "holding": {
        const holding = this.state;
        const hand = holding.hand;

        // Short-circuits before reading the tip when the pose (and thus tracking) is lost.
        const gateHeld =
          poseHeld && this.isStill(hand.indexTip.position, holding.anchor);

        if (!gateHeld) {
          const graceElapsed = holding.graceElapsed + dt;
          if (graceElapsed > this.resetGraceDuration) {
            this.state = { phase: "idle" }; // sustained failure → cancel
          } else {
            // brief flicker → hold the elapsed timer steady, just track the gap
            this.state = { ...holding, graceElapsed };
          }
          break;
        }

        const prev = holding.elapsed;
        const elapsed = prev + dt;

        // Fire onHoldStart on the single frame the engage threshold is crossed.
        if (prev < this.holdDuration && elapsed >= this.holdDuration) {
          this.onHoldStartEvent.invoke(holding.anchor);
        }

        if (elapsed >= this.holdCompleteDuration) {
          this.state = { phase: "completed" };
          this.onHoldCompleteEvent.invoke(hand.indexTip.position);
        } else {
          this.state = {
            phase: "holding",
            hand,
            anchor: holding.anchor,
            elapsed,
            graceElapsed: 0,
          };
        }
        break;
      }
    }

    this.updateDebugText(focus.hand, focus.pose);

    // Drive the prompt off the hold state, not raw pose detection, so the
    // grace window doesn't flicker the message. Leave the text untouched once
    // completed — the panel is animated out by its onHoldComplete listener.
    if (this.state.phase !== "completed") {
      this.setMessage(
        this.state.phase === "holding"
          ? PressBreadboardRecognizer.PRESSING_MESSAGE
          : PressBreadboardRecognizer.IDLE_MESSAGE,
      );
    }
  }

  /**
   * Pick the hand to act on this frame: the first hand presenting the pointing
   * pose, scanning dominant-first. When neither points, returns the first
   * tracked hand (else the dominant hand) so the debug readout still has a
   * subject. Each hand's pose is evaluated at most once.
   */
  private scanForPose(): HandPose {
    let first: HandPose | null = null;
    let firstTracked: HandPose | null = null;

    for (const hand of this.hands) {
      const pose = this.evaluatePose(hand);
      if (pose.pointing) {
        return { hand, pose };
      }
      if (first === null) {
        first = { hand, pose };
      }
      if (firstTracked === null && pose.tracked) {
        firstTracked = { hand, pose };
      }
    }

    // `first` is always set — `hands` holds both hands.
    return firstTracked ?? first!;
  }

  /** Index extended, middle/ring curled. Thumb and pinky are ignored. */
  private evaluatePose(hand: TrackedHand): PoseEvaluation {
    if (!hand.isTracked()) {
      return {
        tracked: false,
        index: false,
        middle: false,
        ring: false,
        pointing: false,
        indexAngle: 0,
        middleAngle: 0,
        ringAngle: 0,
      };
    }

    const indexAngle = this.fingerBendAngle(hand.indexFinger);
    const middleAngle = this.fingerBendAngle(hand.middleFinger);
    const ringAngle = this.fingerBendAngle(hand.ringFinger);

    // Straighter finger → larger bend angle. Extended when above the
    // threshold; curled when below it.
    const index = indexAngle > this.extendedAngle;
    const middle = middleAngle < this.curledAngle;
    const ring = ringAngle < this.curledAngle;

    return {
      tracked: true,
      index,
      middle,
      ring,
      pointing: index && middle && ring,
      indexAngle,
      middleAngle,
      ringAngle,
    };
  }

  show(): void {
    this._animator.show();
  }

  hide(): void {
    this._animator.hide();
  }

  private fingerBendDot(finger: Keypoint[]): number {
    const knuckle = finger[1].position;
    const mid = finger[2].position;
    const upper = finger[3].position;

    const midToUpper = upper.sub(mid).normalize();
    const midToKnuckle = knuckle.sub(mid).normalize();

    return midToUpper.dot(midToKnuckle);
  }

  /** Bend angle at the finger's mid joint, in degrees (~180 = straight). */
  private fingerBendAngle(finger: Keypoint[]): number {
    const dot = this.fingerBendDot(finger);
    const clamped = dot < -1 ? -1 : dot > 1 ? 1 : dot;
    return Math.acos(clamped) * MathUtils.RadToDeg;
  }

  private isStill(tip: vec3, anchor: vec3): boolean {
    return tip.distance(anchor) <= this.stillnessRadius;
  }

  /** Set the prompt text, skipping redundant writes to avoid per-frame relayout. */
  private setMessage(message: string): void {
    if (!isNull(this.recognizerText) && this.recognizerText.text !== message) {
      this.recognizerText.text = message;
    }
  }

  /**
   * On-device diagnostics: which finger fails its threshold (with live bend
   * angles), plus the hold phase, elapsed time, and drift from the anchor —
   * enough to see whether a missed trigger is the pose or the stillness.
   */
  private updateDebugText(hand: TrackedHand, pose: PoseEvaluation): void {
    if (isNull(this.debugText)) return;

    const label = hand.handType === "left" ? "L" : "R";

    if (!pose.tracked) {
      this.debugText.text = `[${label}] Hand not tracked`;
      return;
    }

    let status = this.state.phase.toUpperCase();
    if (this.state.phase === "holding") {
      const drift = hand.indexTip.position.distance(this.state.anchor);
      status =
        `HOLDING ${this.state.elapsed.toFixed(2)}s` +
        ` / ${this.holdCompleteDuration.toFixed(2)}s` +
        `  drift ${drift.toFixed(1)}cm (max ${this.stillnessRadius.toFixed(1)})`;
    }

    this.debugText.text =
      `[${label}] ${status}\n` +
      `idx ${pose.indexAngle.toFixed(0)}° ${pose.index ? "EXT ✓" : "ext ✗"}\n` +
      `mid ${pose.middleAngle.toFixed(0)}° ${pose.middle ? "CURL ✓" : "curl ✗"}` +
      `   ring ${pose.ringAngle.toFixed(0)}° ${pose.ring ? "CURL ✓" : "curl ✗"}`;
  }
}
