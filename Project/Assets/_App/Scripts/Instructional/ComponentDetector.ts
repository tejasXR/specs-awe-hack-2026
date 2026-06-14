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
  BoundingBox,
} from "./ComponentIdentifier";
import { GeminiService } from "../Services/GeminiService";
import { CameraTexture } from "CropCameraTexture.lspkg/Scripts/CameraTexture";

// ─── Types ──────────────────────────────────────────────────────

export interface ComponentDetectionResult {
  /** All components found in the current scan. */
  components: DetectedComponent[];
  /** Timestamp of the scan (milliseconds since epoch). */
  timestamp: number;
}

/**
 * Gemini structured-output schema for a detection scan — paired with
 * responseMimeType "application/json" so the model returns parseable JSON
 * (no markdown fences) with a real bounding box per component.
 * Box format: [ymin, xmin, ymax, xmax], normalized 0–1000, top-left origin.
 */
const DETECTION_SCHEMA = {
  type: "object",
  properties: {
    components: {
      type: "array",
      items: {
        type: "object",
        properties: {
          classId: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
          confidence: { type: "number" },
          box: { type: "array", items: { type: "number" } },
        },
        required: ["classId", "label", "confidence", "box"],
      },
    },
  },
  required: ["components"],
};

// ─── Component ──────────────────────────────────────────────────

@component
export class ComponentDetector extends BaseScriptComponent {
  @ui.separator
  @ui.label("References")
  @input
  @hint("Shared CameraTexture source — provides the full camera frame")
  @allowUndefined
  cameraSource!: CameraTexture;

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
    if (isNull(this.cameraSource)) {
      this.log("camera source not wired — component detection disabled");
    }
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

    if (isNull(this.cameraSource)) {
      this.log("Camera source not assigned — cannot scan");
      this.onScanFailedEvent.invoke("Camera source not assigned");
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
    const texture = this.cameraSource.getOriginalCameraTexture();
    if (!texture) {
      this.log("Camera source has no texture yet — cannot scan");
      this._isScanning = false;
      this.onScanFailedEvent.invoke("Camera texture unavailable");
      return;
    }
    try {
      Base64.encodeTextureAsync(
        texture,
        (base64Data: string) => {
          this.log(
            "Frame encoded (" + Math.round(base64Data.length / 1024) + " KB)",
          );
          this.requestDetection(base64Data);
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
      "Detect the electronic components on or near a breadboard in this image. " +
      "For each component, return its class, a specific label, a brief " +
      "educational one-line description, your confidence (0.0–1.0), and a " +
      "bounding box.\n" +
      "Bounding box format: [ymin, xmin, ymax, xmax], each value normalized " +
      "0–1000 with the origin at the top-left of the image.\n" +
      "Valid classId values: resistor, led_red, led_green, led_blue, " +
      "led_yellow, buzzer, capacitor, button, jumper_wire, potentiometer, " +
      "battery, unknown.\n" +
      "Use a specific label (e.g. '220Ω Resistor' not just 'Resistor'). " +
      "If no components are visible, return an empty components array."
    );
  }

  // ─── Private — Response Parsing ───────────────────────────────

  /**
   * Make the scoped, schema-constrained Gemini call for this scan. Owns its
   * own promise — independent of Zappy chat or any other vision caller.
   */
  private requestDetection(base64Data: string): void {
    const prompt = this.buildDetectionPrompt();
    const generationConfig = {
      responseMimeType: "application/json",
      responseSchema: DETECTION_SCHEMA,
    } as any;

    GeminiService.generateWithImage(prompt, base64Data, "image/jpeg", {
      generationConfig,
    })
      .then((rawText) => this.handleDetectionResponse(rawText))
      .catch((error) => {
        this.log("Detection request failed: " + error);
        this._isScanning = false;
        this.onScanFailedEvent.invoke("" + error);
      });
  }

  /**
   * Parse and publish the structured detection response. Unlike the old
   * shared-brain path, this response belongs to us alone, so a parse failure
   * is a real scan failure (not someone else's chat reply to ignore).
   */
  private handleDetectionResponse(raw: string): void {
    if (!this._isScanning) return;

    const components = this.parseComponents(raw);
    this._isScanning = false;

    if (!components) {
      this.log("Could not parse detection response");
      this.onScanFailedEvent.invoke("Malformed detection response");
      return;
    }

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
        const box = this.normalizeBox(item.box);
        if (!box) continue; // a detection without a usable box can't be placed
        results.push({
          classId: item.classId,
          label: item.label || item.classId,
          description: item.description || "",
          confidence:
            typeof item.confidence === "number" ? item.confidence : 0.5,
          box,
        });
      }

      return results;
    } catch (e) {
      this.log("Parse error: " + e);
      return null;
    }
  }

  /**
   * Gemini returns boxes as [ymin, xmin, ymax, xmax] normalized 0–1000.
   * Convert to a normalized 0–1 BoundingBox, or null if malformed.
   */
  private normalizeBox(raw: any): BoundingBox | null {
    if (!Array.isArray(raw) || raw.length < 4) return null;
    const ymin = raw[0];
    const xmin = raw[1];
    const ymax = raw[2];
    const xmax = raw[3];
    if (
      typeof ymin !== "number" ||
      typeof xmin !== "number" ||
      typeof ymax !== "number" ||
      typeof xmax !== "number"
    ) {
      return null;
    }
    return {
      xMin: xmin / 1000,
      yMin: ymin / 1000,
      xMax: xmax / 1000,
      yMax: ymax / 1000,
    };
  }

  // ─── Private ──────────────────────────────────────────────────

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ComponentDetector] " + message);
    }
  }
}
