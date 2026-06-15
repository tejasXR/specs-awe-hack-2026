/**
 * GeminiService — the single, system-agnostic entry point for Gemini calls.
 *
 * Transport only: it builds the request, calls the Remote Service Gateway, and
 * resolves with the raw text of the first candidate. It holds NO personality,
 * conversation history, or shared busy state — every caller (ZappyBrain chat,
 * CheckWork verdicts, ComponentDetector vision) owns its own request lifecycle
 * via the returned Promise, so independent features never contend for one lock.
 *
 * SETUP: Requires RemoteServiceGateway.lspkg installed + a Google token in
 *        RemoteServiceGatewayCredentials.
 */
import { Gemini } from "RemoteServiceGateway.lspkg/HostedExternal/Gemini";
import { GeminiTypes } from "RemoteServiceGateway.lspkg/HostedExternal/GeminiTypes";

// ─── Content shape (Gemini's generateContent format) ────────────

export type GeminiTextPart = { text: string };
export type GeminiImagePart = {
  inlineData: { mimeType: string; data: string };
};
export type GeminiPart = GeminiTextPart | GeminiImagePart;
export type GeminiContent = { role: string; parts: GeminiPart[] };

export interface GeminiGenerateOptions {
  /** Override the model. Defaults to gemini-2.5-flash (vision-capable). */
  model?: string;
  /**
   * Generation config — e.g. responseMimeType "application/json" +
   * responseSchema for structured/bounding-box output.
   */
  generationConfig?: GeminiTypes.Common.GenerationConfig;
  /**
   * System instruction — persona / standing context, kept out of the turn
   * contents so it never enters conversation history. Mapped to Gemini's
   * dedicated systemInstruction field.
   */
  systemInstruction?: string;
}

const DEFAULT_MODEL = "gemini-2.5-flash";

// ─── Service ────────────────────────────────────────────────────

export class GeminiService {
  /**
   * Send fully-formed contents to Gemini and resolve with the first
   * candidate's text. The caller composes its own contents (system prompt,
   * history, image parts) and parses the result however it needs.
   */
  static generate(
    contents: GeminiContent[],
    options: GeminiGenerateOptions = {},
  ): Promise<string> {
    const body: {
      contents: GeminiContent[];
      generationConfig?: object;
      systemInstruction?: { parts: GeminiTextPart[] };
    } = {
      contents: contents,
    };
    if (options.generationConfig) {
      body.generationConfig = options.generationConfig;
    }
    if (options.systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: options.systemInstruction }],
      };
    }

    const request = {
      model: options.model ?? DEFAULT_MODEL,
      type: "generateContent",
      body: body,
    } as GeminiTypes.Models.GenerateContentRequest;

    return Gemini.models(request).then(
      (response) => response.candidates[0].content.parts[0].text,
    );
  }

  /**
   * Convenience for a single multimodal user turn (text + one image). Returns
   * the raw response text; pass generationConfig via options for JSON/schema.
   */
  static generateWithImage(
    promptText: string,
    base64Image: string,
    mimeType: string,
    options: GeminiGenerateOptions = {},
  ): Promise<string> {
    const contents: GeminiContent[] = [
      {
        role: "user",
        parts: [
          { text: promptText },
          { inlineData: { mimeType: mimeType, data: base64Image } },
        ],
      },
    ];
    return GeminiService.generate(contents, options);
  }
}
