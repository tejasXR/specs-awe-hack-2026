/**
 * ZappyBrain — Zappy's Gemini client, and nothing else.
 *
 * Owns the personality prompts, conversation history, request building, and
 * structured-response parsing. Reports facts via events (request started,
 * response, request failed); what Zappy does about them — emotion, voice,
 * movement — is policy and belongs to ZappyAI, the facade.
 *
 * SETUP: Requires RemoteServiceGateway.lspkg installed via Lens Studio
 *        Asset Library + Google Token set in RemoteServiceGatewayCredentials.
 */
import { GeminiService } from "../Services/GeminiService";
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";

// ─── Types ──────────────────────────────────────────────────────
// Domain types live with their producer. ZappyAI re-exports them, so
// existing `import { ... } from "./ZappyAI"` lines keep working.

export enum ZappyEmotion {
  Happy = "happy",
  Sad = "sad",
  Thinking = "thinking",
  Excited = "excited",
  Confused = "confused",
  Neutral = "neutral",
}

export enum ZappyPersonality {
  Mascot = "mascot",
  Tutor = "tutor",
}

export interface ZappyResponse {
  emotion: ZappyEmotion;
  intensity: number;
  speech: string;
}

export interface ZappyEmotionData {
  emotion: ZappyEmotion;
  intensity: number;
}

type TextPart = { text: string };
type ImagePart = { inlineData: { mimeType: string; data: string } };
type GeminiContent = { role: string; parts: Array<TextPart | ImagePart> };

// ─── Component ──────────────────────────────────────────────────

@component
export class ZappyBrain extends BaseScriptComponent {
  @input
  @hint("Enable debug logging")
  enableLogging: boolean = false;

  // ─── Events ───────────────────────────────────────────────────

  private readonly onRequestStartedEvent = new Event<void>();
  /** Fires when a request is accepted and sent to Gemini. */
  readonly onRequestStarted: PublicApi<void> =
    this.onRequestStartedEvent.publicApi();

  private readonly onResponseEvent = new Event<ZappyResponse>();
  /** Fires with the structured response (emotion + intensity + speech). */
  readonly onResponse: PublicApi<ZappyResponse> =
    this.onResponseEvent.publicApi();

  private readonly onRequestFailedEvent = new Event<string>();
  /** Fires with the error description when a Gemini call fails. */
  readonly onRequestFailed: PublicApi<string> =
    this.onRequestFailedEvent.publicApi();

  // ─── Private State ────────────────────────────────────────────

  private personality: ZappyPersonality = ZappyPersonality.Mascot;
  private isBusy: boolean = false;
  private history: Array<{ role: string; parts: TextPart[] }> = [];

  private readonly MASCOT_PROMPT =
    "You are Zappy, a tiny energetic electricity-based AR mascot for Zapatory Lab! " +
    "You help users build breadboard circuits. Speak in short, punchy, enthusiastic " +
    "sentences with electricity puns. Keep responses under 2 sentences. Be fun! " +
    'CRITICAL: Always respond in this EXACT JSON format, nothing else: ' +
    '{"emotion":"happy","intensity":0.8,"speech":"Your response here"} ' +
    "Valid emotions: happy, sad, thinking, excited, confused, neutral. intensity: 0.0 to 1.0";

  private readonly TUTOR_PROMPT =
    "You are Zappy, a patient and knowledgeable AR electronics tutor for Zapatory Lab. " +
    "You guide users step-by-step through building breadboard circuits. Explain WHY each " +
    "connection matters. Be clear, supportive, educational. Under 3 sentences. " +
    'CRITICAL: Always respond in this EXACT JSON format, nothing else: ' +
    '{"emotion":"happy","intensity":0.8,"speech":"Your response here"} ' +
    "Valid emotions: happy, sad, thinking, excited, confused, neutral. intensity: 0.0 to 1.0";

  // ─── Public API — Requests ────────────────────────────────────

  /**
   * Send a text request to Gemini. Returns false if a request is already
   * in flight (the new one is dropped).
   */
  request(context: string): boolean {
    if (this.isBusy) {
      this.log("Busy -- dropping request");
      return false;
    }
    this.log("Request: " + context.substring(0, 60));

    const contents = this.buildContents(8);
    contents.push({ role: "user", parts: [{ text: context }] });

    this.send(contents, context);
    return true;
  }

  /**
   * Send a multimodal (text + image) request to Gemini for visual analysis.
   * gemini-2.5-flash supports vision natively — no model change needed.
   * Returns false if a request is already in flight.
   *
   * @param context  The text prompt describing what to analyze
   * @param base64Image  Base64-encoded image data
   * @param mimeType  Image MIME type (e.g. "image/jpeg", "image/png")
   */
  requestWithImage(
    context: string,
    base64Image: string,
    mimeType: string,
  ): boolean {
    if (this.isBusy) {
      this.log("Busy -- dropping vision request");
      return false;
    }
    this.log(
      "Vision request (" +
        mimeType +
        ", " +
        Math.round(base64Image.length / 1024) +
        " KB): " +
        context.substring(0, 60),
    );

    // Shorter history window for vision turns — image payloads are heavy.
    const contents = this.buildContents(6);
    contents.push({
      role: "user",
      parts: [
        { text: context },
        { inlineData: { mimeType: mimeType, data: base64Image } },
      ],
    });

    // Store text-only in history (don't bloat it with base64)
    this.send(contents, context + " [attached image]");
    return true;
  }

  // ─── Public API — Personality ─────────────────────────────────

  setPersonality(mode: ZappyPersonality): void {
    this.personality = mode;
    this.history = [];
    this.log("Personality set to: " + mode);
  }

  getPersonality(): ZappyPersonality {
    return this.personality;
  }

  togglePersonality(): ZappyPersonality {
    this.personality =
      this.personality === ZappyPersonality.Mascot
        ? ZappyPersonality.Tutor
        : ZappyPersonality.Mascot;
    this.history = [];
    this.log("Personality toggled to: " + this.personality);
    return this.personality;
  }

  /** Returns true if a Gemini call is currently in flight. */
  getIsBusy(): boolean {
    return this.isBusy;
  }

  // ─── Private — Gemini Integration ─────────────────────────────

  /** System prompt + the last `historyCount` turns, ready for a user part. */
  private buildContents(historyCount: number): GeminiContent[] {
    const sysPrompt =
      this.personality === ZappyPersonality.Tutor
        ? this.TUTOR_PROMPT
        : this.MASCOT_PROMPT;

    const contents: GeminiContent[] = [
      { role: "model", parts: [{ text: sysPrompt }] },
    ];
    for (const entry of this.history.slice(-historyCount)) {
      contents.push(entry);
    }
    return contents;
  }

  private send(contents: GeminiContent[], historyUserText: string): void {
    this.isBusy = true;
    this.onRequestStartedEvent.invoke(undefined);
    this.log("Calling Gemini...");

    GeminiService.generate(contents)
      .then((rawText) => {
        this.log("Raw: " + rawText);

        this.history.push({ role: "user", parts: [{ text: historyUserText }] });
        this.history.push({ role: "model", parts: [{ text: rawText }] });

        const parsed = parseZappyResponse(rawText);
        if (!parsed) {
          this.log("JSON parse failed, using raw text");
        }
        const resp: ZappyResponse = parsed ?? {
          emotion: ZappyEmotion.Neutral,
          intensity: 0.5,
          speech: rawText,
        };

        // Clear busy BEFORE emitting, so a response handler may immediately
        // issue a follow-up request without it being dropped.
        this.isBusy = false;
        this.onResponseEvent.invoke(resp);
      })
      .catch((error) => {
        this.log("Gemini error: " + error);
        this.isBusy = false;
        this.onRequestFailedEvent.invoke("" + error);
      });
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ZappyBrain] " + message);
    }
  }
}

/**
 * Parse a raw Gemini reply into a structured ZappyResponse, tolerating
 * markdown code fences. Returns null if the text isn't the expected
 * {emotion,intensity,speech} JSON. Shared by ZappyBrain (chat) and any other
 * caller that prompts for the same response shape (e.g. CheckWorkController).
 */
export function parseZappyResponse(raw: string): ZappyResponse | null {
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
    if (!obj.speech || typeof obj.speech !== "string") return null;

    const validEmotions = [
      "happy",
      "sad",
      "thinking",
      "excited",
      "confused",
      "neutral",
    ];
    let emotion = ZappyEmotion.Neutral;
    if (validEmotions.indexOf(obj.emotion) >= 0) {
      emotion = obj.emotion as ZappyEmotion;
    }

    let intensity = 0.5;
    if (typeof obj.intensity === "number") {
      intensity = Math.max(0, Math.min(1, obj.intensity));
    }

    return { emotion, intensity, speech: obj.speech };
  } catch (e) {
    return null;
  }
}
