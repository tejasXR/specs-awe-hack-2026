/**
 * CheckWorkController -- Captures a camera frame and sends it to Gemini for
 * visual analysis of the user's breadboard work, then has Zappy present the
 * verdict.
 *
 * Flow:
 *   1. User pinches "Check Work" option -> triggers capture
 *   2. The shared CameraTexture provides the full camera frame
 *   3. Frame is encoded to base64
 *   4. Sent to Gemini (2.5 Flash) via GeminiService with the build-so-far
 *   5. The parsed verdict is handed to ZappyAI to voice + emote
 *
 * Requires:
 *   - CropCameraTexture.lspkg (provides the CameraTexture source)
 *   - RemoteServiceGateway.lspkg (installed)
 */
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ZappyAI, ZappyResponse, ZappyEmotion } from "../Zappy/ZappyAI";
import { parseZappyResponse, RESPONSE_SCHEMA } from "./ZappyBrain";
import { ZappyPersona } from "./ZappyPersona";
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
  response: ZappyResponse;
}

// --- Component ---

@component
export class CheckWorkController extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Zappy</span>')
  @input
  @hint("Zappy facade — voices and emotes the verdict")
  zappyAI!: ZappyAI;

  @input
  @hint("Persona — supplies the standing system instruction + build context")
  persona!: ZappyPersona;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Instructions</span>')
  @input
  @hint("Source of truth for the current step and the build-so-far transcript")
  instructionsController!: InstructionsController;

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
    if (isNull(this.zappyAI)) {
      this.log("zappyAI not assigned -- verdict will be event-only (no voice)");
    }
    if (isNull(this.persona)) {
      this.log("persona not assigned -- check will run without build context");
    }
    this.log("CheckWorkController ready");
  }

  // --- Public API ---

  /**
   * Capture a camera frame and send it to Gemini for analysis.
   * Call this from an AiCharacterOption's onOptionSelected or any trigger.
   */
  captureAndCheck(): void {
    if (this.isBusy) {
      this.log("Already processing a check -- skipping");
      return;
    }

    const currentInstruction =
      this.instructionsController.getCurrentInstruction();
    if (!currentInstruction) {
      this.log("No active step -- nothing to check");
      return;
    }

    if (isNull(this.cameraSource)) {
      this.log("No camera source assigned -- cannot capture");
      return;
    }

    this.isBusy = true;
    this.onCaptureStartedEvent.invoke();
    this.log("Capturing frame for step: " + currentInstruction.title);

    // Full camera frame from the single shared source.
    const texture = this.cameraSource.getOriginalCameraTexture();
    if (!texture) {
      this.log("No camera texture available -- cannot capture");
      this.isBusy = false;
      return;
    }

    // Show preview if configured
    if (!isNull(this.previewPanel)) {
      this.previewPanel.enabled = true;
    }
    if (!isNull(this.previewImage)) {
      this.previewImage.mainPass.baseTex = texture;
    }

    // Encode the texture to base64 and send to Gemini
    this.encodeAndSend(texture, currentInstruction);
  }

  // --- Private: Encode & Send to Gemini ---

  private encodeAndSend(
    texture: Texture,
    instruction: InstructionDefinition,
  ): void {
    try {
      // Use Base64.encodeTextureAsync to convert the camera frame
      Base64.encodeTextureAsync(
        texture,
        (base64Data: string) => {
          this.log("Frame encoded (" + base64Data.length + " chars)");
          this.sendToGemini(base64Data, instruction);
        },
        () => {
          this.log("Failed to encode texture to base64");
          this.isBusy = false;
        },
        CompressionQuality.LowQuality,
        EncodingType.Jpg,
      );
    } catch (error) {
      this.log("Encode error: " + error);
      this.isBusy = false;
    }
  }

  private sendToGemini(
    base64Image: string,
    instruction: InstructionDefinition,
  ): void {
    const stepIndex = this.instructionsController.currentIndex;

    // The build-so-far transcript, current step, identity, and JSON contract all
    // come from the persona's system instruction (single source of truth), so
    // this turn carries only the examination task plus the photo.
    const task =
      "Look at the attached photo of the user's breadboard and compare it to the " +
      "steps they should have completed so far. Tell them: does the build match? " +
      "If something is wrong or missing, what specifically needs fixing? Are there " +
      "any safety concerns?";

    const options = {
      systemInstruction: isNull(this.persona)
        ? undefined
        : this.persona.systemInstruction(),
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    };

    // Independent, scoped Gemini call via the shared service. This does NOT go
    // through ZappyBrain, so it never contends with Zappy's chat busy state.
    GeminiService.generateWithImage(task, base64Image, "image/jpeg", options)
      .then((rawText) => {
        const resp: ZappyResponse = parseZappyResponse(rawText) ?? {
          emotion: ZappyEmotion.Neutral,
          intensity: 0.5,
          speech: rawText,
        };
        // Presentation only: hand the verdict to Zappy to voice + emote.
        if (!isNull(this.zappyAI)) {
          this.zappyAI.present(resp);
        }
        this.finishCheck(instruction, stepIndex, resp);
      })
      .catch((error) => {
        this.log("Check failed: " + error);
        this.isBusy = false;
        if (!isNull(this.previewPanel)) {
          this.previewPanel.enabled = false;
        }
      });
  }

  private finishCheck(
    instruction: InstructionDefinition,
    stepIndex: number,
    resp: ZappyResponse,
  ): void {
    this.isBusy = false;
    if (!isNull(this.previewPanel)) {
      this.previewPanel.enabled = false;
    }
    this.onCheckCompleteEvent.invoke({
      instruction,
      stepIndex,
      response: resp,
    });
    this.log("Check complete -- Zappy says: " + resp.speech);
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[CheckWork] " + message);
    }
  }
}
