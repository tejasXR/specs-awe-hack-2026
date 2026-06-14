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
import { parseZappyResponse } from "./ZappyBrain";
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
  // ZappyAI is still found automatically by name; the step source is now an
  // explicit reference (single source of truth = InstructionsController).
  private zappyAI: ZappyAI;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Instructions</span>')
  @input
  @hint("Source of truth for the current step and the build-so-far transcript")
  @allowUndefined
  instructionsController!: InstructionsController;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Camera Capture</span>')
  @input
  @hint("Shared CameraTexture source — provides the full camera frame")
  @allowUndefined
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
    // Auto-discover ZappyAI from the scene (presentation target for Step 2).
    const scene = global.scene;
    const zappyObj = this.findObjectByName(scene, "Zappy");
    if (zappyObj) {
      const comps = zappyObj.getComponents("Component.ScriptComponent");
      for (let i = 0; i < comps.length; i++) {
        const comp = comps[i];
        if (comp.getTypeName() === "ZappyAI") {
          this.zappyAI = comp as unknown as ZappyAI;
        }
      }
    }

    if (isNull(this.zappyAI)) {
      this.log("zappyAI not found -- verdict will be event-only (no voice)");
    }
    if (isNull(this.instructionsController)) {
      this.log("instructionsController not assigned -- check disabled");
      return;
    }
    if (isNull(this.cameraSource)) {
      this.log("cameraSource not assigned -- capture disabled");
    }
    this.log("CheckWorkController ready");
  }

  // --- Scene Traversal Helpers ---

  private findObjectByName(
    scene: ScriptScene,
    name: string,
  ): SceneObject | null {
    const rootCount = scene.getRootObjectsCount();
    for (let i = 0; i < rootCount; i++) {
      const found = this.searchTree(scene.getRootObject(i), name);
      if (found) return found;
    }
    return null;
  }

  private searchTree(obj: SceneObject, name: string): SceneObject | null {
    if (obj.name === name) return obj;
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      const found = this.searchTree(obj.getChild(i), name);
      if (found) return found;
    }
    return null;
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

    const currentInstruction = this.instructionsController.getCurrentInstruction();
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

    // Build a cumulative transcript of every step the user should have
    // completed so far, each rendered with its cell/rail placement, so Gemini
    // judges the whole build-to-date rather than the current step in isolation.
    const completed = this.instructionsController.getCompletedInstructions();
    const transcript = completed
      .map(
        (def, i) =>
          i + 1 + ". " + this.instructionsController.describeInstruction(def),
      )
      .join("\n");

    const prompt =
      "You are Zappy, an AR electronics tutor. A user is building a breadboard " +
      "circuit one step at a time. These are the steps they should have " +
      "completed so far:\n" +
      transcript +
      "\n\nThe most recent step is #" +
      completed.length +
      ". Attached is a photo of their current breadboard. Examine it and tell " +
      "the user: " +
      "1) Does the build match the steps above? " +
      "2) If something is wrong or missing, what specifically needs fixing? " +
      "3) Any safety concerns? " +
      "Keep it short (2-3 sentences), encouraging, and use electricity puns. " +
      'CRITICAL: Respond in JSON: {"emotion":"happy","intensity":0.8,"speech":"Your feedback here"}';

    // Independent, scoped Gemini call via the shared service. This does NOT go
    // through ZappyBrain, so it never contends with Zappy's chat busy state.
    GeminiService.generateWithImage(prompt, base64Image, "image/jpeg")
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
    this.onCheckCompleteEvent.invoke({ instruction, stepIndex, response: resp });
    this.log("Check complete -- Zappy says: " + resp.speech);
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[CheckWork] " + message);
    }
  }
}
