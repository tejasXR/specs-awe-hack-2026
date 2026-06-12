/**
 * ZappyEmotionToSpeech — maps Zappy's emotion state to ElevenLabs audio tags.
 *
 * Pure transform, no side-effects: given a ZappyEmotionData and a speech
 * string, returns the speech text prefixed (and optionally suffixed) with
 * ElevenLabs v3 audio tags that match the mood. Intensity governs which
 * variant of a tag is chosen (e.g. low-intensity happy → "[cheerful]",
 * high-intensity happy → "[laughs]").
 *
 * Separated from the voice component so the mapping can be unit-tested,
 * reused by other systems (captions, animation cues), and swapped
 * independently of the network layer.
 */
import { ZappyEmotion, ZappyEmotionData } from "./ZappyBrain";

// ─── Types ──────────────────────────────────────────────────────

export interface TaggedSpeech {
  /** The speech string with ElevenLabs audio tags injected. */
  text: string;
  /** The tag that was prepended (for logging / caption stripping). */
  tag: string;
}

// ─── Thresholds ─────────────────────────────────────────────────

/** Intensity above this uses the "high" variant of a tag. */
const HIGH_INTENSITY = 0.7;

// ─── Mapping ────────────────────────────────────────────────────

interface TagVariants {
  low: string;
  high: string;
}

const EMOTION_TAG_MAP: Record<ZappyEmotion, TagVariants> = {
  [ZappyEmotion.Happy]: { low: "[cheerful] ", high: "[laughs] " },
  [ZappyEmotion.Sad]: { low: "[sighs] ", high: "[crying] " },
  [ZappyEmotion.Thinking]: { low: "[thoughtful] ", high: "[whispers] " },
  [ZappyEmotion.Excited]: { low: "[enthusiastic] ", high: "[excited] " },
  [ZappyEmotion.Confused]: { low: "[curious] ", high: "[gasps] " },
  [ZappyEmotion.Neutral]: { low: "", high: "" },
};

// ─── Public API ─────────────────────────────────────────────────

/**
 * Given an emotion and a raw speech string, return the string with the
 * appropriate ElevenLabs audio tag prepended.
 */
export function tagSpeechWithEmotion(
  emotion: ZappyEmotionData,
  speech: string,
): TaggedSpeech {
  const variants = EMOTION_TAG_MAP[emotion.emotion];
  if (!variants) {
    return { text: speech, tag: "" };
  }
  const tag =
    emotion.intensity >= HIGH_INTENSITY ? variants.high : variants.low;
  return { text: tag + speech, tag };
}

/**
 * Strip all ElevenLabs audio tags from a string — useful for displaying
 * clean caption text while the voice uses the tagged version.
 */
export function stripAudioTags(text: string): string {
  // Tags follow the pattern [word] or [word word]
  // Manual replacement since Lens Studio TS doesn't support full RegExp.
  let result = text;
  let safety = 0;
  while (result.indexOf("[") >= 0 && safety < 20) {
    const open = result.indexOf("[");
    const close = result.indexOf("]", open);
    if (close < 0) break;
    result =
      result.substring(0, open) + result.substring(close + 1).trimStart();
    safety++;
  }
  return result;
}
