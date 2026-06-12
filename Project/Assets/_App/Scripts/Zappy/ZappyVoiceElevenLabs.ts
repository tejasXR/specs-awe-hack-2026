/**
 * ZappyVoiceElevenLabs — ElevenLabs-powered expressive voice for Zappy.
 *
 * Drop-in companion to ZappyVoice: exposes the same public surface
 * (speak / stop / isSpeaking / onSpeakingChanged) so the ZappyAI facade
 * can drive either backend without changing its own code.
 *
 * On speak(), the emotion controller's current mood is mapped to an
 * ElevenLabs v3 audio tag (via ZappyEmotionToSpeech), the tagged text is
 * POSTed to the ElevenLabs REST API, and the returned audio is played
 * through the assigned AudioComponent. A generation counter ensures stale
 * responses from slow network round-trips are silently dropped.
 *
 * Falls back to the Snap TextToSpeechModule (ZappyVoice) when the API key
 * is empty or the request fails, so the experience never goes silent.
 *
 * SETUP:
 *   1. Wire the emotionController, audioComponent, and (optionally)
 *      speechText + fallbackVoice in the Inspector.
 *   2. Set your ElevenLabs API key and voice ID — get these from Sasha.
 *   3. The InternetModule must be added to the scene via
 *      Resources > + > Internet Module.
 */
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ZappyEmotionController } from "./ZappyEmotionController";
import { ZappyVoice } from "./ZappyVoice";
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
export class ZappyVoiceElevenLabs extends BaseScriptComponent {
  @ui.separator
  @ui.label("References")
  @input
  @allowUndefined
  emotionController!: ZappyEmotionController;

  @input
  @hint("AudioComponent that plays the synthesized speech")
  @allowUndefined
  audioComponent!: AudioComponent;

  @input
  @hint("Optional caption text — mirrors whatever Zappy says (tags stripped)")
  @allowUndefined
  speechText!: Text;

  @input
  @hint("Fallback: the built-in Snap TTS voice, used when ElevenLabs fails")
  @allowUndefined
  fallbackVoice!: ZappyVoice;

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

  // ─── Events ───────────────────────────────────────────────────

  private readonly onSpeakingChangedEvent = new Event<boolean>();
  /** Fires when audible playback starts (true) and ends or is stopped (false). */
  readonly onSpeakingChanged: PublicApi<boolean> =
    this.onSpeakingChangedEvent.publicApi();

  // ─── Private State ────────────────────────────────────────────

  private _isSpeaking: boolean = false;
  /** Bumped on every speak()/stop() so late-arriving responses are dropped. */
  private _speechGeneration: number = 0;

  /** True while synthesized audio is audibly playing. */
  get isSpeaking(): boolean {
    return this._isSpeaking;
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  onAwake(): void {
    if (!isNull(this.audioComponent)) {
      this.audioComponent.setOnFinish(() => this.setSpeaking(false));
    }
  }

  // ─── Public API ───────────────────────────────────────────────

  /**
   * Voice a line with expressive ElevenLabs TTS. The emotion controller's
   * current mood is mapped to audio tags before synthesis. Falls back to
   * Snap TTS if ElevenLabs is not configured or the request fails.
   */
  speak(text: string): void {
    const generation = ++this._speechGeneration;

    // --- Caption (always immediate, tags stripped) ---
    if (!isNull(this.speechText)) {
      this.speechText.text = stripAudioTags(text);
    }

    // --- Guard: API not configured → fallback ---
    if (this.apiKey === "" || this.voiceId === "") {
      this.log("API key or voice ID not set — falling back to Snap TTS");
      this.speakFallback(text);
      return;
    }

    // --- Map emotion to ElevenLabs audio tags ---
    let taggedText = text;
    if (!isNull(this.emotionController)) {
      const mood = this.emotionController.currentEmotion;
      const tagged = tagSpeechWithEmotion(mood, text);
      taggedText = tagged.text;
      this.log(
        "Emotion: " +
          mood.emotion +
          " (" +
          mood.intensity.toFixed(2) +
          ") → tag: " +
          tagged.tag,
      );
    }

    // --- Build request ---
    const url =
      "https://api.elevenlabs.io/v1/text-to-speech/" +
      this.voiceId +
      "?output_format=" +
      OUTPUT_FORMAT;

    const body = JSON.stringify({
      text: taggedText,
      model_id: this.modelId,
      voice_settings: {
        stability: this.stability,
        similarity_boost: this.similarityBoost,
        style: this.styleExaggeration,
        use_speaker_boost: true,
      },
    });

    this.log("POST " + url.substring(0, 60) + "...");

    // --- Send via InternetModule fetch ---
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
        if (generation !== this._speechGeneration) {
          this.log("Discarding stale ElevenLabs result");
          return;
        }

        if (!response.ok) {
          this.log(
            "ElevenLabs error: " +
              response.status +
              " — falling back to Snap TTS",
          );
          this.speakFallback(text);
          return;
        }

        // @ts-ignore — Lens Studio type declarations don't include arrayBuffer,
        // but the runtime may support it. If not, the catch block falls back.
        return response.arrayBuffer();
      })
      .then((audioData: ArrayBuffer | undefined) => {
        if (!audioData) return;
        if (generation !== this._speechGeneration) return;

        this.log(
          "Audio received (" +
            Math.round(audioData.byteLength / 1024) +
            " KB)",
        );

        this.playAudioData(audioData);
      })
      .catch((error: any) => {
        this.log("Fetch failed: " + error + " — falling back to Snap TTS");
        if (generation === this._speechGeneration) {
          this.speakFallback(text);
        }
      });
  }

  /** Cut the current line short and drop any in-flight synthesis. */
  stop(): void {
    this._speechGeneration++;
    if (!isNull(this.audioComponent) && this.audioComponent.isPlaying()) {
      this.audioComponent.stop(false);
    }
    this.setSpeaking(false);
  }

  // ─── Private — Audio Playback ─────────────────────────────────

  /**
   * Play raw audio data through the AudioComponent. Lens Studio's
   * AudioComponent can load from AudioTrackAsset — we create one from
   * the raw bytes at runtime.
   *
   * NOTE: If AudioTrackAsset.createFromBuffer is not available in the
   * current Lens Studio version, this will fall back to Snap TTS.
   */
  private playAudioData(data: ArrayBuffer): void {
    if (isNull(this.audioComponent)) {
      this.log("AudioComponent not assigned — cannot play");
      return;
    }

    try {
      // Lens Studio 5.9+ supports creating audio tracks from raw data.
      // If this API isn't available yet, the catch block handles it.
      // @ts-ignore — API may not be in type declarations yet
      const track = AudioTrackAsset.createFromBuffer(data, "audio/mpeg");
      this.audioComponent.audioTrack = track;
      this.audioComponent.play(1);
      this.setSpeaking(true);
    } catch (e) {
      this.log(
        "AudioTrackAsset.createFromBuffer not available: " +
          e +
          " — falling back",
      );
      this.speakFallback(
        this.speechText ? this.speechText.text : "...",
      );
    }
  }

  // ─── Private — Fallback ───────────────────────────────────────

  /** Delegate to the built-in Snap TTS voice when ElevenLabs is unusable. */
  private speakFallback(text: string): void {
    if (!isNull(this.fallbackVoice)) {
      this.log("Using fallback Snap TTS");
      this.fallbackVoice.speak(text);
    } else {
      this.log("No fallback voice wired — caption only");
    }
  }

  // ─── Private — State ──────────────────────────────────────────

  private setSpeaking(value: boolean): void {
    if (this._isSpeaking === value) {
      return;
    }
    this._isSpeaking = value;
    this.onSpeakingChangedEvent.invoke(value);
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ZappyVoiceElevenLabs] " + message);
    }
  }
}
