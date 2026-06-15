/**
 * CheckWorkController -- orchestrates the "check my work" sequence.
 *
 * A small state machine that choreographs Zappy around the pure capture+Gemini
 * unit (SendWorkToGemini). Kicked off by InstructionsController.onCheckRequested
 * (the menu primary press while on a checkpoint):
 *
 *   idle -> movingToCheck : Zappy travels to his check-work location
 *   movingToCheck -> awaitingGaze : on arrival, ask the user to look at him
 *   awaitingGaze -> processing : once the user's gaze lands on Zappy (waits
 *                                indefinitely), capture + send to Gemini
 *   processing -> returning : present the verdict, then navigate — repeat the
 *                             failed step, or advance past the checkpoint on pass
 *   returning -> idle : after the verdict finishes speaking, return to default
 *
 * The gaze check is inline (a one-off here, not a reusable component): each
 * frame while awaiting, compare the camera's look direction against the
 * direction to Zappy and proceed when within the angle threshold.
 */
import { unsubscribe } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";
import { ZappyAI } from "./ZappyAI";
import { ZappyEmotion } from "./ZappyResponse";
import { SendWorkToGemini, CheckWorkResult } from "./SendWorkToGemini";
import { InstructionsController } from "../Instructional/InstructionsController";

/** Phases of the check-work sequence. */
type CheckState =
  | "idle"
  | "movingToCheck"
  | "awaitingGaze"
  | "processing"
  | "returning";

/** If the verdict never reports a speaking edge, return home anyway after this. */
const RETURN_FALLBACK_SECONDS = 8.0;

@component
export class CheckWorkController extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("Zappy facade — movement, voice, emotion, presentation")
  zappyAI!: ZappyAI;

  @input
  @hint("Pure capture + Gemini unit this controller drives")
  sendWorkToGemini!: SendWorkToGemini;

  @input
  @hint("Drives the check kickoff (onCheckRequested) and step navigation")
  instructionsController!: InstructionsController;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Gaze Gate</span>')
  @input
  @hint("What the user should look at — Zappy's head/root SceneObject")
  gazeTarget!: SceneObject;

  @input
  @hint("How close the user's gaze must be to Zappy, in degrees")
  @widget(new SliderWidget(5, 60, 1))
  angleThresholdDegrees: number = 20;

  @input
  @hint("Enable debug logging")
  enableLogging: boolean = false;

  // --- Private State ---

  private _state: CheckState = "idle";
  private _camera: WorldCameraFinderProvider | null = null;
  private _cosThreshold: number = Math.cos((20 * Math.PI) / 180);

  private _unsubscribeFromCheckRequest?: unsubscribe;
  private _arrivedUnsub?: unsubscribe;
  private _speakingUnsub?: unsubscribe;
  private _sawSpeaking: boolean = false;
  private _returnFallback?: DelayedCallbackEvent;

  // --- Lifecycle ---

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());

    try {
      this._camera = WorldCameraFinderProvider.getInstance();
    } catch (e) {
      this.log("World camera unavailable — gaze gate disabled: " + e);
      this._camera = null;
    }
  }

  private onStart(): void {
    this._cosThreshold = Math.cos(
      (this.angleThresholdDegrees * Math.PI) / 180,
    );

    if (!isNull(this.instructionsController)) {
      this._unsubscribeFromCheckRequest =
        this.instructionsController.onCheckRequested.add(() =>
          this.beginCheck(),
        );
    }
    this.log("CheckWorkController ready");
  }

  private onDestroy(): void {
    this._unsubscribeFromCheckRequest?.();
    this._arrivedUnsub?.();
    this._speakingUnsub?.();
  }

  // --- Public API ---

  /** Begin the check-work sequence. No-ops if one is already running. */
  beginCheck(): void {
    if (this._state !== "idle") {
      this.log("Check already in progress (" + this._state + ") — ignoring");
      return;
    }
    if (this.zappyAI.isResponding()) {
      this.log("Zappy is busy responding — ignoring check request");
      return;
    }

    this.log("Begin check — moving to check-work location");
    this.setState("movingToCheck");
    this._arrivedUnsub = this.zappyAI.onArrived.add(() =>
      this.onArrivedAtCheck(),
    );
    this.zappyAI.moveZappyToCheckWorkLocation();
  }

  // --- Sequence steps ---

  private onArrivedAtCheck(): void {
    this._arrivedUnsub?.();
    this._arrivedUnsub = undefined;
    if (this._state !== "movingToCheck") {
      return;
    }
    this.log("Arrived — awaiting gaze");
    this.setState("awaitingGaze");
    this.zappyAI.say("Look at me and I'll check your work!");
  }

  private onUpdate(): void {
    if (this._state !== "awaitingGaze") {
      return;
    }
    if (this.isGazingAtZappy()) {
      this.onGazeAcquired();
    }
  }

  private onGazeAcquired(): void {
    this.log("Gaze acquired — capturing");
    this.setState("processing");
    this.zappyAI.say(
      "Hang tight — I'm checking your work!",
      ZappyEmotion.Thinking,
      0.6,
    );

    this.sendWorkToGemini
      .requestCheck()
      .then((result) => this.onCheckResult(result))
      .catch((error) => this.onCheckError(error));
  }

  private onCheckResult(result: CheckWorkResult): void {
    // Voice + emote the verdict.
    this.zappyAI.present(result.response);

    const target = result.response.targetStepNumber;
    if (target > 0) {
      // targetStepNumber is the step's true position; goToStep is 0-based.
      const moved = this.instructionsController.goToStep(target - 1);
      this.log(
        moved
          ? "Sending user back to step " + target
          : "Could not resolve target step " + target + " — staying put",
      );
    } else {
      // Pass: advance past the checkpoint.
      this.log("Check passed — advancing past checkpoint");
      this.instructionsController.nextInSequence();
    }

    this.beginReturn();
  }

  private onCheckError(error: string): void {
    this.log("Check error: " + error);
    this.zappyAI.say(
      "Whoops — my circuits fizzled. Let's try that check again in a moment.",
      ZappyEmotion.Sad,
      0.6,
    );
    this.beginReturn();
  }

  // --- Return ---

  /**
   * Return to the default location once the verdict finishes speaking. Watches
   * the speaking falling-edge, with a timed fallback so a caption-only (silent)
   * verdict still sends Zappy home.
   */
  private beginReturn(): void {
    this.setState("returning");
    this._sawSpeaking = false;

    this._speakingUnsub = this.zappyAI.onSpeakingChanged.add((speaking) => {
      if (speaking) {
        this._sawSpeaking = true;
        return;
      }
      if (this._sawSpeaking) {
        this.doReturn();
      }
    });

    this._returnFallback = this.createEvent("DelayedCallbackEvent");
    this._returnFallback.bind(() => this.doReturn());
    this._returnFallback.reset(RETURN_FALLBACK_SECONDS);
  }

  private doReturn(): void {
    if (this._state !== "returning") {
      return; // already returned (speaking edge and fallback can both fire)
    }
    this._speakingUnsub?.();
    this._speakingUnsub = undefined;
    if (this._returnFallback) {
      this._returnFallback.enabled = false;
    }
    this.log("Returning to default location");
    this.zappyAI.moveZappyToDefaultLocation();
    this.setState("idle");
  }

  // --- Gaze ---

  /** True when the camera's look direction is within the threshold of Zappy. */
  private isGazingAtZappy(): boolean {
    if (!this._camera || isNull(this.gazeTarget)) {
      return false;
    }

    const camPos = this._camera.getWorldPosition();
    const targetPos = this.gazeTarget.getTransform().getWorldPosition();
    const toTarget = targetPos.sub(camPos);
    const distance = toTarget.length;
    if (distance < 0.0001) {
      return true;
    }

    const dir = toTarget.uniformScale(1 / distance);
    // back() is the direction the camera looks (LS forward points behind it).
    const look = this._camera.back().normalize();
    return look.dot(dir) >= this._cosThreshold;
  }

  private setState(state: CheckState): void {
    this._state = state;
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[CheckWorkController] " + message);
    }
  }
}
