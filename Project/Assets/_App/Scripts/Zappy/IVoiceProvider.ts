/**
 * IVoiceProvider — the swap contract for Zappy's voice backends.
 *
 * A provider's only job is "given text + mood, produce an AudioTrackAsset."
 * It owns nothing about playback, captions, speaking state, or events — those
 * are the ZappyVoice coordinator's concerns. This keeps each backend (Snap
 * TextToSpeechModule, ElevenLabs REST) a thin, single-purpose synth unit that
 * ZappyVoice can pick between or fall back across without duplicating the
 * shared machinery.
 *
 * Implemented by ZappyTTSVoiceProvider and ZappyElevenLabsVoiceProvider —
 * both @component classes, so they're wired into ZappyVoice in the Inspector.
 */
import { ZappyEmotionData } from "./ZappyResponse";

/** Async result channel for a single synthesis request. */
export interface VoiceSynthesisCallbacks {
  /** Fired with the playable track once synthesis succeeds. */
  onReady: (track: AudioTrackAsset) => void;
  /** Fired with a human-readable reason when synthesis fails. */
  onError: (message: string) => void;
}

/** A swappable text-to-speech backend for Zappy. */
export interface IVoiceProvider {
  /**
   * Synthesize `text` in the given `mood` and report the result via
   * `callbacks`. Implementations must call exactly one of onReady/onError.
   * Staleness (a newer line superseding this one) is the coordinator's
   * concern — providers always report; the coordinator decides what to keep.
   *
   * Defense in depth: the coordinator also treats a synchronous throw, and any
   * repeat callback, as a single reported failure — so a buggy backend degrades
   * to fallback instead of breaking playback. Report cleanly anyway; don't rely
   * on this.
   */
  synthesize(
    text: string,
    mood: Readonly<ZappyEmotionData>,
    callbacks: VoiceSynthesisCallbacks,
  ): void;

  /**
   * Render the caption string for a raw line — e.g. strip backend-specific
   * audio tags. Defaults to identity for backends that speak text verbatim.
   */
  toCaption(text: string): string;

  /** True when this backend is configured and usable right now. */
  isAvailable(): boolean;
}
