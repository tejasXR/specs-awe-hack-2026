/**
 * ComponentDetector — identifies electronic components via Gemini vision.
 *
 * Captures a frame from the camera texture, sends it to Gemini 2.5 Flash
 * (via ZappyBrain.requestWithImage), and parses the structured JSON
 * response into a list of DetectedComponent entries. Fires
 * onComponentsDetected so overlay systems can react.
 *
 * This is a "scan and label" approach — NOT continuous tracking. The user
 * triggers a scan (pinch, voice command, or automatic on step change),
 * Gemini analyzes the snapshot, and results are anchored until the next
 * scan. This avoids the latency and compute cost of real-time YOLO on
 * the Spectacles hardware while still delivering the "floating tag" effect.
 *
 * SETUP:
 *   1. Wire the ZappyBrain reference (already in the scene on the Zappy
 *      object — it handles the Gemini call).
 *   2. Wire the CameraTextureProvider (the CropCameraTexture asset Tejas
 *      added provides this).
 *   3. Optionally wire the breadboard origin for grid-relative positioning.
 */
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import {
  DetectedComponent,
  COMPONENT_INFO,
  ComponentClass,
} from "./ComponentIdentifier";
import { ZappyResponse } from "../Zappy/ZappyAI";
import { ZappyBrain } from "../Zappy/ZappyBrain";

// ─── Types ──────────────────────────────────────────────────────

export interface ComponentDetectionResult {
  /** All components found in the current scan. */
  components: DetectedComponent[];
  /** Timestamp of the scan (milliseconds since epoch). */
  timestamp: number;
}

// ─── Component ──────────────────────────────────────────────────

@component
export class ComponentDetector extends BaseScriptComponent {
  @ui.separator
  @ui.label("References")
  @input
  @hint("ZappyBrain — used for Gemini vision requests")
  @allowUndefined
  brain!: ZappyBrain;

  @input
  @hint("Texture from the device camera (CropCameraTexture or DeviceCamera)")
  @allowUndefined
  cameraTexture!: Texture;

  @ui.separator
  @ui.label("Settings")
  @input
  @hint("Minimum confidence to include a detection (0.0–1.0)")
  @widget(new SliderWidget(0.0, 1.0, 0.05))
  confidenceThreshold: number = 0.5;

  @input
  @hint("Cooldown between scans in seconds — prevents spamming Gemini")
  scanCooldownSeconds: number = 3.0;

  @input
  @hint("Enable debug logging")
  enableLogging: boolean = false;

  // ─── Events ───────────────────────────────────────────────────

  private readonly onComponentsDetectedEvent =
    new Event<ComponentDetectionResult>();
  /** Fires with the list of detected components after a successful scan. */
  readonly onComponentsDetected: PublicApi<ComponentDetectionResult> =
    this.onComponentsDetectedEvent.publicApi();

  private readonly onScanStartedEvent = new Event<void>();
  /** Fires when a scan request is accepted and sent. */
  readonly onScanStarted: PublicApi<void> = this.onScanStartedEvent.publicApi();

  private readonly onScanFailedEvent = new Event<string>();
  /** Fires with the error description when a scan fails. */
  readonly onScanFailed: PublicApi<string> = this.onScanFailedEvent.publicApi();

  // ─── Private State ────────────────────────────────────────────

  private _lastScanTime: number = 0;
  private _isScanning: boolean = false;
  private _lastResult: ComponentDetectionResult | null = null;
  private _unsubs: unsubscribe[] = [];

  get isScanning(): boolean {
    return this._isScanning;
  }

  get lastResult(): ComponentDetectionResult | null {
    return this._lastResult;
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => {
      this._unsubs.forEach((unsub) => unsub());
      this._unsubs = [];
    });
  }

  private onStart(): void {
    if (isNull(this.brain)) {
      this.log("brain not wired — component detection disabled");
      return;
    }
    // Listen for brain responses to parse component data from them.
    // The brain is shared with ZappyAI — we listen but only process
    // responses that match our prompt format (contain "components" array).
    this._unsubs.push(
      this.brain.onResponse.add((resp) => this.tryParseDetection(resp)),
    );
    this._unsubs.push(
      this.brain.onRequestFailed.add((error) => {
        if (this._isScanning) {
          this._isScanning = false;
          this.onScanFailedEvent.invoke(error);
        }
      }),
    );
  }

  // ─── Public API ───────────────────────────────────────────────

  /**
   * Trigger a component scan. Captures the current camera frame via
   * Base64.encodeTextureAsync, sends the base64 to Gemini with a
   * structured prompt, and fires onComponentsDetected when results arrive.
   * Returns false if on cooldown or already scanning.
   */
  scan(): boolean {
    const now = getTime() * 1000;
    if (this._isScanning) {
      this.log("Already scanning — dropping request");
      return false;
    }
    if (now - this._lastScanTime < this.scanCooldownSeconds * 1000) {
      this.log("On cooldown — dropping request");
      return false;
    }

    if (isNull(this.cameraTexture)) {
      this.log("Camera texture not assigned — cannot scan");
      this.onScanFailedEvent.invoke("Camera texture not assigned");
      return false;
    }

    this._isScanning = true;
    this._lastScanTime = now;
    this.onScanStartedEvent.invoke(undefined);

    // Encode the camera texture to base64 asynchronously.
    // This is the same API used by CheckWorkController — proven to work.
    this.captureAndSend();

    return true;
  }

  // ─── Private — Frame Capture ──────────────────────────────────

  /**
   * Capture the current camera texture as base64 JPEG and send to Gemini.
   * Uses Base64.encodeTextureAsync — the standard Lens Studio API for
   * encoding textures (same approach as CheckWorkController).
   */
  private captureAndSend(): void {
    try {
      Base64.encodeTextureAsync(
        this.cameraTexture,
        (base64Data: string) => {
          this.log(
            "Frame encoded (" + Math.round(base64Data.length / 1024) + " KB)",
          );
          const prompt = this.buildDetectionPrompt();
          this.brain.requestWithImage(prompt, base64Data, "image/jpeg");
        },
        () => {
          this.log("Failed to encode texture to base64");
          this._isScanning = false;
          this.onScanFailedEvent.invoke("Failed to encode camera frame");
        },
        CompressionQuality.LowQuality,
        EncodingType.Jpg,
      );
    } catch (e) {
      this.log("Frame capture error: " + e);
      this._isScanning = false;
      this.onScanFailedEvent.invoke("Frame capture error: " + e);
    }
  }

  // ─── Private — Prompt ─────────────────────────────────────────

  private buildDetectionPrompt(): string {
    return (
      "Analyze this image of electronic components on or near a breadboard. " +
      "Identify each visible component and return a JSON object with this EXACT format:\n" +
      '{"components":[{"classId":"resistor","label":"220Ω Resistor",' +
      '"description":"Limits current","confidence":0.95,' +
      '"imagePosX":0.5,"imagePosY":0.3}]}\n\n' +
      "Valid classId values: resistor, led_red, led_green, led_blue, " +
      "led_yellow, buzzer, capacitor, button, jumper_wire, potentiometer, " +
      "battery, unknown.\n" +
      "imagePosX and imagePosY are normalized 0.0–1.0 from top-left.\n" +
      "confidence is your certainty 0.0–1.0.\n" +
      "Include a specific label (e.g. '220Ω Resistor' not just 'Resistor').\n" +
      'If no components are visible, return {"components":[]}.\n' +
      "RESPOND WITH ONLY THE JSON, NO OTHER TEXT."
    );
  }

  // ─── Private — Response Parsing ───────────────────────────────

  /**
   * Attempt to parse a ZappyBrain response as component detection data.
   * Only processes responses that contain a "components" array — regular
   * Zappy chat responses are ignored.
   */
  private tryParseDetection(resp: ZappyResponse): void {
    if (!this._isScanning) return;

    const raw = resp.speech;
    const components = this.parseComponents(raw);
    if (!components) {
      // Not a detection response — might be a regular Zappy reply.
      // Don't fail the scan, just ignore.
      this.log("Response doesn't look like detection data — ignoring");
      return;
    }

    this._isScanning = false;

    // Filter by confidence threshold
    const filtered = components.filter(
      (c) => c.confidence >= this.confidenceThreshold,
    );

    // Enrich with standard info for any components that have minimal labels
    for (const comp of filtered) {
      const info = COMPONENT_INFO[comp.classId];
      if (info && (!comp.description || comp.description.length < 5)) {
        comp.description = info.description;
      }
    }

    const result: ComponentDetectionResult = {
      components: filtered,
      timestamp: getTime() * 1000,
    };

    this._lastResult = result;
    this.log("Detected " + filtered.length + " components");
    this.onComponentsDetectedEvent.invoke(result);
  }

  private parseComponents(raw: string): DetectedComponent[] | null {
    try {
      let jsonStr = raw.trim();

      // Strip markdown code fences if Gemini wraps JSON in ```
      if (jsonStr.indexOf("```") === 0) {
        const start = jsonStr.indexOf("{");
        const end = jsonStr.lastIndexOf("}") + 1;
        if (start >= 0 && end > start) {
          jsonStr = jsonStr.substring(start, end);
        }
      }

      const obj = JSON.parse(jsonStr);
      if (!Array.isArray(obj.components)) return null;

      const results: DetectedComponent[] = [];
      for (const item of obj.components) {
        if (!item.classId || typeof item.classId !== "string") continue;
        results.push({
          classId: item.classId,
          label: item.label || item.classId,
          description: item.description || "",
          confidence:
            typeof item.confidence === "number" ? item.confidence : 0.5,
          imagePosX: typeof item.imagePosX === "number" ? item.imagePosX : 0.5,
          imagePosY: typeof item.imagePosY === "number" ? item.imagePosY : 0.5,
        });
      }

      return results;
    } catch (e) {
      this.log("Parse error: " + e);
      return null;
    }
  }

  // ─── Private ──────────────────────────────────────────────────

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ComponentDetector] " + message);
    }
  }
}
