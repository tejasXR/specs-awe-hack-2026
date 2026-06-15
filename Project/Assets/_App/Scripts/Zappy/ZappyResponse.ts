/**
 * ZappyResponse — the single source of truth for Zappy's structured reply.
 *
 * The response shape ({emotion, intensity, speech}) lives here exactly once, in
 * three coupled forms that must never drift:
 *   - RESPONSE_CONTRACT — the prose instruction injected into the system prompt
 *   - RESPONSE_SCHEMA   — the Gemini responseSchema that enforces the same shape
 *   - parseZappyResponse — the tolerant parser that reads it back
 *
 * Co-locating them means a change to Zappy's reply format is a one-file edit and
 * the prompt, the schema, and the parser stay in lockstep. Every caller
 * (ZappyBrain chat, CheckWork verdicts) imports from here — directly or via
 * ZappyBrain's re-exports.
 */
import { GeminiTypes } from "RemoteServiceGateway.lspkg/HostedExternal/GeminiTypes";

// ─── Domain types ───────────────────────────────────────────────

export enum ZappyEmotion {
  Happy = "happy",
  Sad = "sad",
  Thinking = "thinking",
  Excited = "excited",
  Confused = "confused",
  Neutral = "neutral",
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

/** The valid emotion strings, kept beside the enum so the schema and parser agree. */
const VALID_EMOTIONS: string[] = [
  ZappyEmotion.Happy,
  ZappyEmotion.Sad,
  ZappyEmotion.Thinking,
  ZappyEmotion.Excited,
  ZappyEmotion.Confused,
  ZappyEmotion.Neutral,
];

// ─── The contract (prose + schema) ──────────────────────────────

/** Prose form of the contract — injected into the system prompt. */
export const RESPONSE_CONTRACT =
  "Always respond as ONLY a single JSON object in this exact shape, with no " +
  'other text: {"emotion":"happy","intensity":0.8,"speech":"..."}. ' +
  "Valid emotions: " +
  VALID_EMOTIONS.join(", ") +
  ". intensity is a number from 0.0 to 1.0.";

/** Schema form of the same contract — enforced via Gemini's responseSchema. */
export const RESPONSE_SCHEMA: GeminiTypes.Common.Schema = {
  type: "OBJECT",
  properties: {
    emotion: { type: "STRING", enum: VALID_EMOTIONS },
    intensity: { type: "NUMBER" },
    speech: { type: "STRING" },
  },
  required: ["emotion", "intensity", "speech"],
};

// ─── Parsing ────────────────────────────────────────────────────

/**
 * Parse a raw Gemini reply into a structured ZappyResponse, tolerating
 * markdown code fences. Returns null if the text isn't the expected
 * {emotion,intensity,speech} JSON. Still used as a safety net even with
 * schema-enforced output, since transports can wrap or degrade the response.
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

    let emotion = ZappyEmotion.Neutral;
    if (VALID_EMOTIONS.indexOf(obj.emotion) >= 0) {
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
