/**
 * ZappyPersona — the single source of truth for who Zappy is and what he knows.
 *
 * Composes the system prompt from layered, independently-owned parts:
 *   - identity  : who Zappy is + register/tone (inspector-tunable)
 *   - mission   : the domain — guiding a beginner placing primitive components
 *                 on a breadboard (inspector-tunable)
 *   - tone()    : an adaptive band derived from build progress
 *   - RESPONSE_CONTRACT : the output shape (single-sourced in ZappyResponse)
 *   - situation(): the live build state (current step + compacted build-so-far),
 *                  read fresh each turn from a BuildContextProvider
 *
 * Every Gemini caller (ZappyBrain chat, CheckWork verdicts) feeds
 * systemInstruction() into Gemini's systemInstruction field, so Zappy's voice,
 * mission, and step-awareness are defined here and nowhere else.
 */
import { InstructionsController } from "../Instructional/InstructionsController";
import type { BuildContextProvider } from "../Instructional/BuildContextProvider";
import { RESPONSE_CONTRACT } from "./ZappyResponse";

/** Adaptive register, derived from how far along the build the user is. */
type Tone = "warmup" | "flowing" | "struggling";

const TONE_SNIPPET: Record<Tone, string> = {
  warmup:
    "The user is just getting started — be especially welcoming and orienting, " +
    "and don't assume any prior electronics knowledge.",
  flowing:
    "The user has momentum — stay encouraging and concise, and keep them moving.",
  // Authored now, unused until a struggle signal (e.g. repeated failed checks)
  // exists to select it — see tone(). Progress-based bands only for v1.
  struggling:
    "The user seems to be struggling — slow down, be reassuring, and break the " +
    "next action into the single smallest concrete step.",
};

/** Below this fraction of the sequence, Zappy is still in warmup register. */
const WARMUP_FRACTION = 0.25;

/** Most recent completed steps rendered in full; older ones are summarized away. */
const MAX_RECENT_STEPS = 5;

@component
export class ZappyPersona extends BaseScriptComponent {
  @ui.separator
  @ui.label("Identity")
  @input
  @widget(new TextAreaWidget())
  @hint("Who Zappy is and how he speaks — register/tone")
  identity: string =
    "You are Zappy, a tiny, upbeat electricity-based AR mascot and a patient " +
    "hands-on tutor for Zapatory Lab. You speak in short, encouraging sentences " +
    "with the occasional light electricity pun, and you never run past 2-3 sentences.";

  @input
  @widget(new TextAreaWidget())
  @hint("Zappy's mission and domain — what he's helping with")
  mission: string =
    "You are guiding a beginner student through building simple LED circuits by " +
    "placing primitive electronic components (LEDs, resistors, wires, transistors) " +
    "on a breadboard. Explain why each connection matters in plain language, keep " +
    "things safe, and always meet the user at a novice level.";

  @ui.separator
  @ui.label("Context Source")
  @input
  @allowUndefined
  @hint("Source of the live build state (current step + build-so-far)")
  instructionsController!: InstructionsController;

  /** The context source viewed through its abstraction — logic depends on the role, not the class. */
  private get context(): BuildContextProvider | null {
    return isNull(this.instructionsController) ? null : this.instructionsController;
  }

  onAwake(): void {}

  // ─── Public API ───────────────────────────────────────────────

  /**
   * The full systemInstruction for a turn: who Zappy is + his mission + the
   * adaptive tone + the response contract + the live build situation. Callers
   * pass this into Gemini's systemInstruction field and supply the user's task
   * as the turn content.
   *
   * Pass `directive` to append a per-call instruction (e.g. a conversational
   * reply-length cap) after the situation, so it reads as the most specific,
   * last-stated rule. Orthogonal to contractOverride, which swaps the JSON shape.
   */
  systemInstruction(contractOverride?: string, directive?: string): string {
    const base = `${this.systemPrompt(contractOverride)}\n\n${this.situation()}`;
    const trimmed = directive?.trim();
    return trimmed ? `${base}\n\n${trimmed}` : base;
  }

  /**
   * The stable identity layers: identity + mission + tone + output contract.
   * Pass contractOverride to swap the default response contract for a
   * caller-specific one (e.g. the check-work contract, which adds a field) so
   * the prose and that caller's responseSchema agree.
   */
  systemPrompt(contractOverride?: string): string {
    return [
      this.identity.trim(),
      this.mission.trim(),
      TONE_SNIPPET[this.tone()],
      contractOverride ?? RESPONSE_CONTRACT,
    ]
      .filter((part) => part.length > 0)
      .join("\n\n");
  }

  /** The live build state: current step (full) + a compacted build-so-far. */
  situation(): string {
    const context = this.context;
    if (context === null) {
      return "The build state is unavailable right now.";
    }

    const current = context.getCurrentInstruction();
    if (current === null) {
      return "The user hasn't started the build yet.";
    }

    const stepNumber = context.currentIndex + 1;
    let situation = `The user is on step ${stepNumber} of ${context.stepCount}: "${current.title}".`;
    if (current.description) {
      situation += ` ${current.description}`;
    }

    const transcript = this.buildSoFar(context);
    if (transcript.length > 0) {
      situation += `\nSteps completed so far:\n${transcript}`;
    }
    return situation;
  }

  // ─── Private ──────────────────────────────────────────────────

  /**
   * Progress-derived tone band. "struggling" needs a failed-check/mistake
   * signal that doesn't exist yet, so v1 only selects warmup vs flowing — the
   * struggling snippet is authored above and ready to wire when that signal lands.
   */
  private tone(): Tone {
    const context = this.context;
    if (context === null || context.stepCount === 0) {
      return "warmup";
    }
    const fraction = (context.currentIndex + 1) / context.stepCount;
    return fraction <= WARMUP_FRACTION ? "warmup" : "flowing";
  }

  /**
   * The build-so-far, compacted to a bounded token cost: the last
   * MAX_RECENT_STEPS rendered one line each, with a "(+N earlier)" note so the
   * prompt stays bounded regardless of how long the sequence is.
   */
  private buildSoFar(context: BuildContextProvider): string {
    const completed = context.getCompletedInstructions();
    if (completed.length === 0) {
      return "";
    }

    const recent = completed.slice(-MAX_RECENT_STEPS);
    const earlier = completed.length - recent.length;

    const lines = recent.map(
      (def, i) => `${earlier + i + 1}. ${context.describeInstruction(def)}`,
    );

    const prefix =
      earlier > 0
        ? `(+${earlier} earlier step${earlier === 1 ? "" : "s"} completed)\n`
        : "";
    return prefix + lines.join("\n");
  }
}
