import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import type TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand";
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";

/**
 * Recognizes a thumbs-up made with EITHER hand and exposes it as two events for
 * other scripts to hook into: onThumbsUpRegistered fires once the pose has been
 * held briefly, and onThumbsUpReset fires when no hand is making it anymore. The
 * gesture is repeatable — release and re-make to fire again.
 *
 * There is no built-in thumbs-up in GestureModule, so the pose is computed from
 * hand joints: the thumb extended while the other four fingers are curled.
 * Detection is orientation-independent — both the thumb-extended and finger-curled
 * tests are palm-relative, so a sideways or tilted thumbs-up counts.
 *
 * Device-only: HandInputData reports no tracking in the LS editor, so this never
 * fires in preview — validate on Spectacles.
 */
@component
export class ThumbsUpInteraction extends BaseScriptComponent {
  @input
  @allowUndefined
  debugText?: Text;

  // The thumb counts as "extended" when its tip-to-palm distance is at least this
  // fraction of its knuckle's. Higher = stricter (thumb must stick out further).
  private thumbExtendThreshold: number = 1.1;

  // A finger is "curled" when its tip is within this fraction of its knuckle's
  // distance from the palm center. Looser (higher) so ring/pinky still register.
  private curlThreshold: number = 1.1;

  // Seconds the thumbs-up pose must be held continuously before it registers.
  private holdDuration: number = 0.25;

  private handInput: HandInputData = HandInputData.getInstance();
  private leftHand!: TrackedHand;
  private rightHand!: TrackedHand;

  // True while a thumbs-up is registered (event fired, gesture still active).
  private isRegistered: boolean = false;
  // Seconds the pose has been held continuously, accumulated before registering.
  private elapsed: number = 0;

  private onThumbsUpRegisteredEvent = new Event<void>();
  // Fires once a thumbs-up has been held for holdDuration. Hook other scripts here.
  readonly onThumbsUpRegistered: PublicApi<void> =
    this.onThumbsUpRegisteredEvent.publicApi();

  private onThumbsUpResetEvent = new Event<void>();
  // Fires on the falling edge — when neither hand is making a thumbs-up anymore.
  readonly onThumbsUpReset: PublicApi<void> =
    this.onThumbsUpResetEvent.publicApi();

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  onStart() {
    this.leftHand = this.handInput.getHand("left");
    this.rightHand = this.handInput.getHand("right");

    this.setDebug(
      "Left hand is: " + this.leftHand + " right hand is " + this.rightHand,
    );
  }

  private onUpdate(): void {
    // Evaluate both hands every frame so the debug line shows what each is doing.
    const left = this.evaluateHand(this.leftHand, "L");
    const right = this.evaluateHand(this.rightHand, "R");
    const detected = left.detected || right.detected;

    let status: string;
    if (!detected) {
      // No hand making a thumbs-up: drop the hold timer, and fire reset on the
      // falling edge if we were registered.
      this.elapsed = 0;
      if (this.isRegistered) {
        this.isRegistered = false;
        this.onThumbsUpResetEvent.invoke();
      }
      status = "waiting for thumbs-up";
    } else if (this.isRegistered) {
      // Already active — stay registered until the gesture is released.
      status = "registered";
    } else {
      // Detected but not yet registered: accumulate the confirm hold.
      this.elapsed += getDeltaTime();
      if (this.elapsed >= this.holdDuration) {
        this.isRegistered = true;
        this.onThumbsUpRegisteredEvent.invoke();
        status = "REGISTERED!";
      } else {
        status = "holding " + this.elapsed.toFixed(2) + "s";
      }
    }

    this.setDebug(left.debug + "\n" + right.debug + "\n" + status);
  }

  /**
   * Evaluates one hand for the thumbs-up pose and returns the boolean result
   * plus a compact diagnostic line: tracking state, the thumb's extension ratio,
   * and each finger's curl ratio (tip-to-palm / knuckle-to-palm). The thumb reads
   * as extended above {@link thumbExtendThreshold}; a finger reads as curled below
   * {@link curlThreshold}. All ratios are palm-relative, so the pose is detected at
   * any wrist orientation.
   */
  private evaluateHand(
    hand: TrackedHand,
    label: string,
  ): { detected: boolean; debug: string } {
    if (!hand.isTracked()) {
      return { detected: false, debug: label + ": not tracked" };
    }

    const palmCenter = hand.getPalmCenter();
    if (palmCenter === null) {
      return { detected: false, debug: label + ": no palm center" };
    }

    // Thumb extended is the inverse of the curl test — no world axis, so orientation-free.
    const thumbRatio = this.curlRatio(hand.thumbTip.position, hand.thumbKnuckle.position, palmCenter);
    const thumbExtended = thumbRatio >= this.thumbExtendThreshold;

    const i = this.curlRatio(hand.indexTip.position, hand.indexKnuckle.position, palmCenter);
    const m = this.curlRatio(hand.middleTip.position, hand.middleKnuckle.position, palmCenter);
    const r = this.curlRatio(hand.ringTip.position, hand.ringKnuckle.position, palmCenter);
    const p = this.curlRatio(hand.pinkyTip.position, hand.pinkyKnuckle.position, palmCenter);

    const fingersCurled =
      i <= this.curlThreshold &&
      m <= this.curlThreshold &&
      r <= this.curlThreshold &&
      p <= this.curlThreshold;

    const detected = thumbExtended && fingersCurled;

    // e.g. "R thumb 1.34[EXT] FIST i0.82 m0.79 r0.95 p1.10" — caps mark the gates that pass.
    const debug =
      label +
      " thumb " +
      thumbRatio.toFixed(2) +
      (thumbExtended ? "[EXT]" : "[--]") +
      (fingersCurled ? " FIST" : " open") +
      " i" + i.toFixed(2) +
      " m" + m.toFixed(2) +
      " r" + r.toFixed(2) +
      " p" + p.toFixed(2);

    return { detected, debug };
  }

  /** Fingertip distance to palm as a fraction of the knuckle's — below threshold = curled. */
  private curlRatio(tip: vec3, knuckle: vec3, palmCenter: vec3): number {
    const knuckleDist = knuckle.distance(palmCenter);
    if (knuckleDist === 0) return Number.MAX_VALUE;
    return tip.distance(palmCenter) / knuckleDist;
  }

  private setDebug(message: string): void {
    if (this.debugText) this.debugText.text = message;
  }
}
