/**
 * SendWorkToGemini -- Captures a camera frame and sends it to Gemini for visual
 * analysis of the user's breadboard work, resolving with the structured verdict.
 *
 * This is the pure capture + Gemini unit (refactored out of the old
 * CheckWorkController): it owns NO choreography, voice, or navigation. It
 * captures the shared CameraTexture, encodes it, injects the deterministic
 * numbered build-so-far list, sends the photo + task to Gemini under the
 * check-work schema, and returns a CheckWorkResult via Promise. The new
 * CheckWorkController orchestrates everything around it (movement, gaze,
 * presentation, navigation, return).
 *
 * Requires:
 *   - CropCameraTexture.lspkg (provides the CameraTexture source)
 *   - RemoteServiceGateway.lspkg (installed)
 */
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ZappyPersona } from "./ZappyPersona";
import { ZappyEmotion } from "./ZappyResponse";
import {
  CheckWorkResponse,
  CHECK_WORK_CONTRACT,
  CHECK_WORK_SCHEMA,
  parseCheckWorkResponse,
} from "./CheckWorkResponse";
import { GeminiService } from "../Services/GeminiService";
import { CameraTexture } from "CropCameraTexture.lspkg/Scripts/CameraTexture";
import {
  InstructionDefinition,
  InstructionsController,
} from "../Instructional/InstructionsController";

// --- Types ---

export interface CheckWorkResult {
  instruction: InstructionDefinition;
  stepIndex: number;
  response: CheckWorkResponse;
}

// --- Component ---

@component
export class SendWorkToGemini extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Instructions</span>')
  @input
  @hint("Source of truth for the current step and the build-so-far transcript")
  instructionsController!: InstructionsController;

  @input
  @hint("Persona — supplies the standing system instruction + build context")
  persona!: ZappyPersona;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Camera Capture</span>')
  @input
  @hint("Shared CameraTexture source — provides the full camera frame")
  cameraSource!: CameraTexture;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Display</span>')
  @input
  @hint("Optional: Image component to show the captured frame as preview")
  @allowUndefined
  previewImage!: Image;

  @input
  @hint("Optional: SceneObject to show/hide as a capture preview panel")
  @allowUndefined
  previewPanel!: SceneObject;

  @input
  @hint("Enable debug logging")
  enableLogging: boolean = true;

  // --- Events ---

  private readonly onCaptureStartedEvent = new Event<void>();
  /** Fires when a capture begins (show loading UI). */
  readonly onCaptureStarted: PublicApi<void> =
    this.onCaptureStartedEvent.publicApi();

  private readonly onCheckCompleteEvent = new Event<CheckWorkResult>();
  /** Fires when Gemini returns its analysis of the captured image. */
  readonly onCheckComplete: PublicApi<CheckWorkResult> =
    this.onCheckCompleteEvent.publicApi();

  // --- Private State ---

  private isBusy: boolean = false;

  // --- Lifecycle ---

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    if (isNull(this.persona)) {
      this.log("persona not assigned -- check will run without build context");
    }
    this.log("SendWorkToGemini ready");
  }

  // --- Public API ---

  /**
   * Capture a camera frame, send it to Gemini, and resolve with the structured
   * verdict. Rejects if a check is already running, there's no active step, or
   * the camera frame is unavailable, and on any encode/Gemini failure.
   */
  requestCheck(): Promise<CheckWorkResult> {
    if (this.isBusy) {
      return Promise.reject("Already processing a check");
    }

    const currentInstruction =
      this.instructionsController.getCurrentInstruction();
    if (!currentInstruction) {
      return Promise.reject("No active step to check");
    }

    if (isNull(this.cameraSource)) {
      return Promise.reject("No camera source assigned");
    }

    const texture = this.cameraSource.getOriginalCameraTexture();
    if (!texture) {
      return Promise.reject("No camera texture available");
    }

    this.isBusy = true;
    this.onCaptureStartedEvent.invoke();
    this.log("Capturing frame for step: " + currentInstruction.title);

    if (!isNull(this.previewPanel)) {
      this.previewPanel.enabled = true;
    }
    if (!isNull(this.previewImage)) {
      this.previewImage.mainPass.baseTex = texture;
    }

    const stepIndex = this.instructionsController.currentIndex;

    return this.encode(texture)
      .then((base64) => this.send(base64))
      .then((rawText) => {
        this.log("Raw: " + rawText);
        const response: CheckWorkResponse = parseCheckWorkResponse(rawText) ?? {
          emotion: ZappyEmotion.Neutral,
          intensity: 0.5,
          speech: rawText,
          targetStepNumber: 0,
        };
        const result: CheckWorkResult = {
          instruction: currentInstruction,
          stepIndex,
          response,
        };
        this.finish();
        this.onCheckCompleteEvent.invoke(result);
        this.log(
          "Check complete -- target step " +
            response.targetStepNumber +
            ": " +
            response.speech,
        );
        return result;
      })
      .catch((error) => {
        this.log("Check failed: " + error);
        this.finish();
        throw error;
      });
  }

  // --- Private: Encode & Send to Gemini ---

  /** Encode the camera frame to a base64 JPEG, promisifying the callback API. */
  private encode(texture: Texture): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      try {
        Base64.encodeTextureAsync(
          texture,
          (base64Data: string) => {
            this.log("Frame encoded (" + base64Data.length + " chars)");
            resolve(base64Data);
          },
          () => reject("Failed to encode texture to base64"),
          CompressionQuality.LowQuality,
          EncodingType.Jpg,
        );
      } catch (error) {
        reject("Encode error: " + error);
      }
    });
  }

  private send(base64Image: string): Promise<string> {
    // The numbered build-so-far list is the SAME ordering the controller maps
    // back from (repeatCompletedStep), so the number Gemini returns resolves to
    // the right step. Identity, mission, and tone come from the persona; the
    // check-work contract replaces the default response contract so the schema
    // and the prose agree on the 4-field shape.
    const task =
      "Look at the attached photo of the user's breadboard and compare it to " +
      "the steps they should have completed so far (listed below). Does the " +
      "build match? If something is wrong, missing, or incomplete, say what " +
      "needs fixing and set targetStepNumber to the EARLIEST such step. Note " +
      "any safety concerns.\n\nCompleted steps:\n" +
      this.instructionsController.describeCompletedStepsNumbered();

    const options = {
      systemInstruction: isNull(this.persona)
        ? undefined
        : this.persona.systemInstruction(CHECK_WORK_CONTRACT),
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: CHECK_WORK_SCHEMA,
      },
    };

    // Independent, scoped Gemini call via the shared service — never contends
    // with ZappyBrain's chat busy state.
    return GeminiService.generateWithImage(
      task,
      base64Image,
      "image/jpeg",
      options,
    );
  }

  private finish(): void {
    this.isBusy = false;
    if (!isNull(this.previewPanel)) {
      this.previewPanel.enabled = false;
    }
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[SendWorkToGemini] " + message);
    }
  }
}
