/**
 * CheckWorkController -- Captures a camera frame and sends it to ZappyAI (Gemini)
 * for visual analysis of the user's breadboard work.
 *
 * Flow:
 *   1. User pinches "Check Work" option -> triggers capture
 *   2. CropCameraTexture grabs a cropped frame of the breadboard area
 *   3. Frame is encoded to base64
 *   4. Sent to Gemini (2.5 Flash supports vision) with step context
 *   5. Gemini analyzes the image and returns feedback via ZappyAI
 *
 * Requires:
 *   - CropCameraTexture.lspkg (already in Project/Packages)
 *   - RemoteServiceGateway.lspkg (installed)
 *   - A CameraModule asset in the scene
 */
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ZappyAI, ZappyResponse } from "../Zappy/ZappyAI";
import { GameManager, StepData } from "../GameManager";

// --- Types ---

export interface CheckWorkResult {
  step: StepData;
  stepIndex: number;
  response: ZappyResponse;
}

// --- Component ---

@component
export class CheckWorkController extends BaseScriptComponent {
  // These are found automatically -- no Inspector wiring needed
  private zappyAI: ZappyAI;
  private gameManager: GameManager;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Camera Capture</span>')
  @input
  @hint("CameraModule from the scene for capturing frames (optional for now)")
  @allowUndefined
  camModule!: CameraModule;

  @input
  @hint(
    "Optional: cropped texture for focused breadboard view. If not set, uses full camera frame.",
  )
  @allowUndefined
  cropTexture!: Texture;

  @input
  @hint("Crop rectangle left boundary (-1 to 1)")
  cropLeft: number = -0.4;

  @input
  @hint("Crop rectangle right boundary (-1 to 1)")
  cropRight: number = 0.4;

  @input
  @hint("Crop rectangle bottom boundary (-1 to 1)")
  cropBottom: number = -0.4;

  @input
  @hint("Crop rectangle top boundary (-1 to 1)")
  cropTop: number = 0.4;

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

  private cameraTexture: Texture | null = null;
  private cameraRequest: CameraModule.CameraRequest | null = null;
  private isBusy: boolean = false;

  // --- Lifecycle ---

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    // Auto-discover ZappyAI and GameManager from the scene
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

    const gmObj = this.findObjectByName(scene, "GameManager");
    if (gmObj) {
      const comps = gmObj.getComponents("Component.ScriptComponent");
      for (let i = 0; i < comps.length; i++) {
        const comp = comps[i];
        if (comp.getTypeName() === "GameManager") {
          this.gameManager = comp as unknown as GameManager;
        }
      }
    }

    // Also check same object
    if (!this.gameManager) {
      const comps = this.getSceneObject().getComponents(
        "Component.ScriptComponent",
      );
      for (let i = 0; i < comps.length; i++) {
        const comp = comps[i];
        if (comp.getTypeName() === "GameManager") {
          this.gameManager = comp as unknown as GameManager;
        }
      }
    }

    if (isNull(this.zappyAI)) {
      this.log("zappyAI not found in scene");
      return;
    }
    if (isNull(this.gameManager)) {
      this.log("gameManager not found in scene");
      return;
    }
    this.log("Components resolved");
    this.setupCamera();
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

    const currentStep = this.gameManager.getCurrentStep();
    if (!currentStep) {
      this.log("No active step -- nothing to check");
      return;
    }

    this.isBusy = true;
    this.onCaptureStartedEvent.invoke();
    this.log("Capturing frame for step: " + currentStep.instruction);

    // Get the camera texture (cropped or full)
    const texture = this.getActiveTexture();
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
    this.encodeAndSend(texture, currentStep);
  }

  // --- Private: Camera Setup ---

  private setupCamera(): void {
    try {
      if (isNull(this.camModule)) {
        this.log("No CameraModule assigned -- capture disabled");
        return;
      }

      this.cameraRequest = CameraModule.createCameraRequest();
      this.cameraRequest.cameraId = CameraModule.CameraId.Default_Color;

      const isEditor = global.deviceInfoSystem.isEditor();
      this.cameraRequest.imageSmallerDimension = isEditor ? 352 : 756;

      this.cameraTexture = this.camModule.requestCamera(this.cameraRequest);
      this.log(
        "Camera initialized (resolution: " +
          this.cameraRequest.imageSmallerDimension +
          ")",
      );

      // Set up crop if texture provided
      if (!isNull(this.cropTexture)) {
        const cropProvider = this.cropTexture.control as any;
        if (cropProvider && cropProvider.inputTexture !== undefined) {
          cropProvider.inputTexture = this.cameraTexture;
          if (cropProvider.cropRect) {
            cropProvider.cropRect.left = this.cropLeft;
            cropProvider.cropRect.right = this.cropRight;
            cropProvider.cropRect.bottom = this.cropBottom;
            cropProvider.cropRect.top = this.cropTop;
          }
          this.log("Crop texture configured");
        }
      }
    } catch (error) {
      this.log("Camera setup failed: " + error);
    }
  }

  private getActiveTexture(): Texture | null {
    if (!isNull(this.cropTexture)) {
      return this.cropTexture;
    }
    return this.cameraTexture;
  }

  // --- Private: Encode & Send to Gemini ---

  private encodeAndSend(texture: Texture, step: StepData): void {
    try {
      // Use Base64.encodeTextureAsync to convert the camera frame
      Base64.encodeTextureAsync(
        texture,
        (base64Data: string) => {
          this.log("Frame encoded (" + base64Data.length + " chars)");
          this.sendToGemini(base64Data, step);
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

  private sendToGemini(base64Image: string, step: StepData): void {
    const stepIndex = this.gameManager.getCurrentStepIndex();
    const totalSteps = this.gameManager.getTotalSteps();
    const level = this.gameManager.getCurrentLevel();
    const levelName = level ? level.name : "Unknown";

    // Build a vision-capable prompt with the image
    const prompt =
      "You are Zappy, an AR electronics tutor. The user is building the '" +
      levelName +
      "' circuit. They are on Step " +
      (stepIndex + 1) +
      " of " +
      totalSteps +
      ': "' +
      step.instruction +
      '" (Hint: ' +
      step.hint +
      "). " +
      "I'm attaching a photo of their current breadboard. " +
      "Analyze the image and tell the user: " +
      "1) Is the current step done correctly? " +
      "2) If not, what needs to be fixed? " +
      "3) Any safety concerns? " +
      "Keep it short (2-3 sentences), encouraging, and use electricity puns. " +
      'CRITICAL: Respond in JSON: {"emotion":"happy","intensity":0.8,"speech":"Your feedback here"}';

    // Use ZappyAI's activateWithImage method for vision
    this.zappyAI.activateWithImage(prompt, base64Image, "image/jpeg");

    // Listen for the response to complete the check
    const unsub = this.zappyAI.onResponse.add((resp) => {
      unsub(); // one-shot listener
      this.isBusy = false;

      // Hide preview
      if (!isNull(this.previewPanel)) {
        this.previewPanel.enabled = false;
      }

      this.onCheckCompleteEvent.invoke({
        step,
        stepIndex,
        response: resp,
      });

      this.log("Check complete -- Zappy says: " + resp.speech);
    });
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[CheckWork] " + message);
    }
  }
}
