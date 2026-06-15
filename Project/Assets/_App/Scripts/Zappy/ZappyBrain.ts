/**
 * ZappyBrain — Zappy's Gemini client: transport + conversation history only.
 *
 * Who Zappy is and what he knows now lives in ZappyPersona (identity, mission,
 * adaptive tone, live build context); the response shape lives in ZappyResponse.
 * ZappyBrain just composes [history + user turn], attaches the persona's
 * systemInstruction and the schema-enforced JSON contract, sends, and reports
 * facts via events. What Zappy does about a response — emotion, voice, movement
 * — is policy and belongs to ZappyAI, the facade.
 *
 * SETUP: Requires RemoteServiceGateway.lspkg installed via Lens Studio
 *        Asset Library + Google Token set in RemoteServiceGatewayCredentials.
 */
import { GeminiService } from "../Services/GeminiService";
import { ZappyPersona } from "./ZappyPersona";
import {
  parseZappyResponse,
  RESPONSE_SCHEMA,
  ZappyEmotion,
  ZappyResponse,
} from "./ZappyResponse";
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";

// Re-export the response domain so existing `import { ... } from "./ZappyBrain"`
// lines (ZappyAI, ZappyVoice, CheckWork) keep working from one place.
export {
  parseZappyResponse,
  RESPONSE_CONTRACT,
  RESPONSE_SCHEMA,
  ZappyEmotion,
} from "./ZappyResponse";
export type { ZappyResponse, ZappyEmotionData } from "./ZappyResponse";

// ─── Content shape (local to the chat transport) ────────────────

type TextPart = { text: string };
type ImagePart = { inlineData: { mimeType: string; data: string } };
type GeminiContent = { role: string; parts: Array<TextPart | ImagePart> };

// Generation config that enforces the structured response contract.
const JSON_GENERATION_CONFIG = {
  responseMimeType: "application/json",
  responseSchema: RESPONSE_SCHEMA,
};

// ─── Component ──────────────────────────────────────────────────

@component
export class ZappyBrain extends BaseScriptComponent {
  @input
  @hint("Persona — Zappy's identity, mission, tone, and live build context")
  @allowUndefined
  persona!: ZappyPersona;

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

  private isBusy: boolean = false;
  private history: Array<{ role: string; parts: TextPart[] }> = [];

  // ─── Public API — Requests ────────────────────────────────────

  /**
   * Send a text request to Gemini. Returns false if a request is already
   * in flight (the new one is dropped).
   *
   * `directive` is an optional per-call instruction appended to the system
   * instruction for this turn only (e.g. a conversational reply-length cap).
   */
  sendRequest(context: string, directive?: string): boolean {
    if (this.isBusy) {
      this.log("Busy -- dropping request");
      return false;
    }
    this.log("Request: " + context.substring(0, 60));

    const contents = this.buildContents(8);
    contents.push({ role: "user", parts: [{ text: context }] });

    this.send(contents, context, directive);
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

  /** Returns true if a Gemini call is currently in flight. */
  getIsBusy(): boolean {
    return this.isBusy;
  }

  // ─── Private — Gemini Integration ─────────────────────────────

  /** The last `historyCount` turns, ready for a user part to be appended. */
  private buildContents(historyCount: number): GeminiContent[] {
    const contents: GeminiContent[] = [];
    for (const entry of this.history.slice(-historyCount)) {
      contents.push(entry);
    }
    return contents;
  }

  private send(
    contents: GeminiContent[],
    historyUserText: string,
    directive?: string,
  ): void {
    this.isBusy = true;
    this.onRequestStartedEvent.invoke(undefined);
    this.log("Calling Gemini...");

    GeminiService.generate(contents, {
      systemInstruction: this.resolveSystemInstruction(directive),
      generationConfig: JSON_GENERATION_CONFIG,
    })
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

  /** Persona-composed standing context, or undefined if the persona is unwired. */
  private resolveSystemInstruction(directive?: string): string | undefined {
    if (isNull(this.persona)) {
      this.log("Persona not assigned -- sending without system instruction");
      return undefined;
    }
    return this.persona.systemInstruction(undefined, directive);
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ZappyBrain] " + message);
    }
  }
}
