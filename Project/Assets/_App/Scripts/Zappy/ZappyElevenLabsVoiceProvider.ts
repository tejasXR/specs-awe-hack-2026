/**
 * ZappyElevenLabsVoiceProvider — ElevenLabs REST backend for ZappyVoice.
 *
 * The expressive voice: maps Zappy's current mood to an ElevenLabs v3 audio
 * tag (via ZappyEmotionToSpeech), POSTs the tagged line to the ElevenLabs TTS
 * API, decodes the returned audio into an AudioTrackAsset, and hands it back
 * to the ZappyVoice coordinator. Playback, captions, speaking state, and the
 * fallback-to-Snap decision all live in the coordinator — this component only
 * turns text + mood into a track.
 *
 * Because captions should stay clean, toCaption() strips the audio tags the
 * voice actually speaks.
 *
 * SETUP:
 *   1. Set your ElevenLabs API key and voice ID (get these from Sasha).
 *   2. The InternetModule must be added to the scene via
 *      Resources > + > Internet Module.
 *   3. Wire this component into ZappyVoice's "ElevenLabs Provider" slot.
 */
import { ZappyEmotionData } from "./ZappyBrain";
import { IVoiceProvider, VoiceSynthesisCallbacks } from "./IVoiceProvider";
import {
  tagSpeechWithEmotion,
  stripAudioTags,
} from "./ZappyEmotionToSpeech";

// ─── Types ──────────────────────────────────────────────────────

/** Supported ElevenLabs model IDs. */
enum ElevenLabsModel {
  /** Maximum emotional range — best expressiveness, ~1-2s latency. */
  V3 = "eleven_v3",
  /** Low-latency conversational — good expression, ~300ms latency. */
  FlashV2_5 = "eleven_flash_v2_5",
}

/** Audio output format — mp3 is universally supported. */
const OUTPUT_FORMAT = "mp3_44100_128";

// ─── Component ──────────────────────────────────────────────────

@component
export class ZappyElevenLabsVoiceProvider
  extends BaseScriptComponent
  implements IVoiceProvider
{
  @ui.separator
  @ui.label("ElevenLabs Config")
  @input
  @hint("Your ElevenLabs API key (xi-api-key header)")
  apiKey: string = "";

  @input
  @hint("ElevenLabs voice ID — find this in the ElevenLabs dashboard")
  voiceId: string = "";

  @input
  @hint("Use V3 for max expression (~1-2s) or Flash for low latency (~300ms)")
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("V3 (Max Expression)", "eleven_v3"),
      new ComboBoxItem("Flash v2.5 (Low Latency)", "eleven_flash_v2_5"),
    ]),
  )
  modelId: string = ElevenLabsModel.FlashV2_5;

  @ui.separator
  @ui.label("Settings")
  @input
  @hint("Stability (0.0 = variable/expressive, 1.0 = stable/consistent)")
  @widget(new SliderWidget(0.0, 1.0, 0.05))
  stability: number = 0.3;

  @input
  @hint("Similarity boost (higher = closer to original voice)")
  @widget(new SliderWidget(0.0, 1.0, 0.05))
  similarityBoost: number = 0.75;

  @input
  @hint("Style exaggeration (higher = more expressive, costs latency)")
  @widget(new SliderWidget(0.0, 1.0, 0.05))
  styleExaggeration: number = 0.4;

  @input
  @hint("Enable debug logging")
  enableLogging: boolean = false;

  // ─── IVoiceProvider ───────────────────────────────────────────

  isAvailable(): boolean {
    return this.apiKey !== "" && this.voiceId !== "";
  }

  /** The spoken line carries audio tags — strip them for the caption. */
  toCaption(text: string): string {
    return stripAudioTags(text);
  }

  synthesize(
    text: string,
    mood: Readonly<ZappyEmotionData>,
    callbacks: VoiceSynthesisCallbacks,
  ): void {
    if (!this.isAvailable()) {
      callbacks.onError("API key or voice ID not set");
      return;
    }

    // --- Map emotion to ElevenLabs audio tags ---
    const tagged = tagSpeechWithEmotion(mood, text);
    this.log(
      "Emotion: " +
        mood.emotion +
        " (" +
        mood.intensity.toFixed(2) +
        ") → tag: " +
        tagged.tag,
    );

    // --- Build request ---
    const url =
      "https://api.elevenlabs.io/v1/text-to-speech/" +
      this.voiceId +
      "?output_format=" +
      OUTPUT_FORMAT;

    const body = JSON.stringify({
      text: tagged.text,
      model_id: this.modelId,
      voice_settings: {
        stability: this.stability,
        similarity_boost: this.similarityBoost,
        style: this.styleExaggeration,
        use_speaker_boost: true,
      },
    });

    this.log("POST " + url.substring(0, 60) + "...");

    const request = new Request(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: body,
    });

    // @ts-ignore — Lens Studio InternetModule global fetch
    fetch(request)
      .then((response: Response) => {
        if (!response.ok) {
          callbacks.onError("ElevenLabs HTTP " + response.status);
          return undefined;
        }
        // @ts-ignore — arrayBuffer may not be in the type declarations, but
        // the runtime may support it; the catch below handles absence.
        return response.arrayBuffer();
      })
      .then((audioData: ArrayBuffer | undefined) => {
        if (!audioData) return;
        this.log(
          "Audio received (" +
            Math.round(audioData.byteLength / 1024) +
            " KB)",
        );
        this.decodeAndReturn(audioData, callbacks);
      })
      .catch((error: any) => {
        callbacks.onError("Fetch failed: " + error);
      });
  }

  // ─── Private ──────────────────────────────────────────────────

  /**
   * Decode the raw mp3 bytes into an AudioTrackAsset and report it. If the
   * runtime doesn't expose AudioTrackAsset.createFromBuffer yet, this fails
   * via onError so the coordinator can fall back to Snap TTS.
   */
  private decodeAndReturn(
    data: ArrayBuffer,
    callbacks: VoiceSynthesisCallbacks,
  ): void {
    try {
      // Lens Studio 5.9+ supports creating audio tracks from raw data.
      // @ts-ignore — API may not be in the type declarations yet
      const track = AudioTrackAsset.createFromBuffer(data, "audio/mpeg");
      callbacks.onReady(track);
    } catch (e) {
      callbacks.onError("AudioTrackAsset.createFromBuffer unavailable: " + e);
    }
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ZappyElevenLabsVoiceProvider] " + message);
    }
  }
}
