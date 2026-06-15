/**
 * CheckWorkResponse — the structured reply for a "check my work" pass.
 *
 * The check-work call needs one more field than Zappy's chat reply: which step
 * the user should repeat. Rather than pollute the shared ZappyResponse contract
 * (used by chat), this co-locates the check-work-only tri-form — prose contract,
 * Gemini schema, and tolerant parser — the same single-source-of-truth pattern
 * ZappyResponse uses, layered on top of it.
 *
 *   - CHECK_WORK_CONTRACT — prose injected via the persona's contract override
 *   - CHECK_WORK_SCHEMA   — the Gemini responseSchema enforcing the 4-field shape
 *   - parseCheckWorkResponse — reads it back, defaulting targetStepNumber to 0
 *
 * targetStepNumber is a 1-based position in the numbered build-so-far list the
 * caller injects (see InstructionsController.describeCompletedStepsNumbered);
 * 0 means everything checks out and nothing needs repeating.
 */
import { GeminiTypes } from "RemoteServiceGateway.lspkg/HostedExternal/GeminiTypes";
import {
  parseZappyResponse,
  RESPONSE_SCHEMA,
  ZappyResponse,
} from "./ZappyResponse";

// ─── Domain type ────────────────────────────────────────────────

export interface CheckWorkResponse extends ZappyResponse {
  /**
   * 1-based number (from the injected build-so-far list) of the earliest step
   * the user should repeat, or 0 when the build is correct so far.
   */
  targetStepNumber: number;
}

// ─── The contract (prose + schema) ──────────────────────────────

/** Prose form — injected as the persona's contract override for check-work turns. */
export const CHECK_WORK_CONTRACT =
  "Always respond as ONLY a single JSON object in this exact shape, with no " +
  'other text: {"emotion":"happy","intensity":0.8,"speech":"...","targetStepNumber":0}. ' +
  "Valid emotions: happy, sad, thinking, excited, confused, neutral. intensity " +
  "is a number from 0.0 to 1.0. targetStepNumber must be a step number taken " +
  "EXACTLY as shown in the numbered completed-steps list in the user message: " +
  "set it to the number of the earliest step that is wrong, missing, or " +
  "incomplete so the user can repeat it. If the build matches every completed " +
  "step, set targetStepNumber to 0.";

/** Schema form — RESPONSE_SCHEMA plus the targetStepNumber field. */
export const CHECK_WORK_SCHEMA: GeminiTypes.Common.Schema = {
  type: "OBJECT",
  properties: {
    ...(RESPONSE_SCHEMA.properties ?? {}),
    targetStepNumber: { type: "NUMBER" },
  },
  required: ["emotion", "intensity", "speech", "targetStepNumber"],
};

// ─── Parsing ────────────────────────────────────────────────────

/**
 * Parse a raw Gemini reply into a CheckWorkResponse. Reuses the tolerant
 * ZappyResponse parser for the shared fields, then reads targetStepNumber,
 * defaulting it to 0 (treat as "all good") when absent or unreadable. Returns
 * null only when the base {emotion,intensity,speech} can't be parsed at all.
 */
export function parseCheckWorkResponse(raw: string): CheckWorkResponse | null {
  const base = parseZappyResponse(raw);
  if (!base) {
    return null;
  }

  let targetStepNumber = 0;
  try {
    let jsonStr = raw.trim();
    if (jsonStr.indexOf("```") === 0) {
      const start = jsonStr.indexOf("{");
      const end = jsonStr.lastIndexOf("}") + 1;
      if (start >= 0 && end > start) {
        jsonStr = jsonStr.substring(start, end);
      }
    }
    const obj = JSON.parse(jsonStr);
    if (typeof obj.targetStepNumber === "number" && obj.targetStepNumber >= 0) {
      targetStepNumber = Math.round(obj.targetStepNumber);
    }
  } catch (e) {
    // Base parsed but the step number was unreadable — default to 0 (pass).
  }

  return {
    emotion: base.emotion,
    intensity: base.intensity,
    speech: base.speech,
    targetStepNumber,
  };
}
