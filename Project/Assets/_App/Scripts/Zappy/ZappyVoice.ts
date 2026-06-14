/**
 * ZappyVoice — the voice coordinator: one stable surface, swappable backend.
 *
 * Driven by the ZappyAI facade, which calls speak() for each line. ZappyVoice
 * owns everything shared across voice backends — the speaking-state machine,
 * audio playback, the onSpeakingChanged event, and staleness handling — and
 * delegates synthesis ("text + mood → audio track") to a swappable
 * IVoiceProvider and caption display to a ZappySpeechBox. Any system may also
 * call speak() directly to voice a fixed line without a Gemini round-trip.
 *
 * Two providers are wired in the Inspector (Snap TTS and ElevenLabs); the
 * `backend` selector picks the primary. If the primary is unconfigured or its
 * synthesis fails and fallback is enabled, ZappyVoice automatically delegates
 * to the Snap provider so the experience never goes silent.
 *
 * The public surface (speak / stop / isSpeaking / onSpeakingChanged) is
 * unchanged from earlier versions, so ZappyAI and MusicController bind to it
 * exactly as before — swapping voices is an Inspector change, not a code one.
 */
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ZappyEmotion, ZappyEmotionData } from "./ZappyBrain";
import { ZappyEmotionController } from "./ZappyEmotionController";
import { IVoiceProvider } from "./IVoiceProvider";
import { ZappyTTSVoiceProvider } from "./ZappyTTSVoiceProvider";
import { ZappyElevenLabsVoiceProvider } from "./ZappyElevenLabsVoiceProvider";
import { ZappySpeechBox } from "./ZappySpeechBox";

// ─── Types ──────────────────────────────────────────────────────

/** Which provider speaks by default. */
enum VoiceBackend {
  Snap = "snap",
  ElevenLabs = "elevenlabs",
}

/** Mood used when no emotion controller is wired. */
const DEFAULT_MOOD: ZappyEmotionData = {
  emotion: ZappyEmotion.Neutral,
  intensity: 0.5,
};

// ─── Component ──────────────────────────────────────────────────

@component
export class ZappyVoice extends BaseScriptComponent {
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
  @hint("Optional speech box — mirrors whatever Zappy says (tags stripped)")
  @allowUndefined
  speechBox!: ZappySpeechBox;

  @ui.separator
  @ui.label("Backends")
  @input
  @hint("Which backend speaks by default")
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Snap TTS", "snap"),
      new ComboBoxItem("ElevenLabs", "elevenlabs"),
    ]),
  )
  backend: string = VoiceBackend.Snap;

  @input
  @hint("Snap TextToSpeechModule provider — also the fallback voice")
  @allowUndefined
  snapProvider!: ZappyTTSVoiceProvider;

  @input
  @hint("ElevenLabs expressive provider")
  @allowUndefined
  elevenLabsProvider!: ZappyElevenLabsVoiceProvider;

  @ui.separator
  @ui.label("Settings")
  @input
  @hint("If the primary backend is unusable or errors, fall back to Snap TTS")
  enableFallback: boolean = true;

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
  /** Bumped on every speak()/stop() so late-arriving synthesis is dropped. */
  private _speechGeneration: number = 0;

  /** True while synthesized audio is audibly playing. */
  get isSpeaking(): boolean {
    return this._isSpeaking;
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  onAwake(): void {
    if (!isNull(this.audioComponent)) {
      this.audioComponent.setOnFinish(() => {
        this.setSpeaking(false);
        this.hideSpeechBox();
      });
    }
  }

  // ─── Public API ───────────────────────────────────────────────

  /**
   * Voice a line: caption immediately, then synthesize via the selected
   * backend and play. A newer speak() supersedes any synthesis still in
   * flight, and a failed/unavailable primary falls back to Snap TTS.
   */
  speak(text: string): void {
    const generation = ++this._speechGeneration;
    const primary = this.resolvePrimary();
    this.synthesizeWith(text, primary, generation, this.enableFallback);
  }

  /** Cut the current line short and drop any in-flight synthesis. */
  stop(): void {
    this._speechGeneration++;
    if (!isNull(this.audioComponent) && this.audioComponent.isPlaying()) {
      this.audioComponent.stop(false);
    }
    this.setSpeaking(false);
    this.hideSpeechBox();
  }

  // ─── Private — Synthesis Routing ──────────────────────────────

  /**
   * Caption, then synthesize via `provider`. On unavailability or error,
   * route to the Snap fallback once (allowFallback guards against loops).
   */
  private synthesizeWith(
    text: string,
    provider: IVoiceProvider | null,
    generation: number,
    allowFallback: boolean,
  ): void {
    // Caption immediately, rendered the way this backend speaks the line, and
    // reveal the box — kept up even in the caption-only (no audio) fallback.
    if (!isNull(this.speechBox)) {
      this.speechBox.setCaption(provider ? provider.toCaption(text) : text);
      this.speechBox.show();
    }

    if (!provider || !provider.isAvailable()) {
      this.log("Primary backend unavailable");
      this.routeFallback(text, provider, generation, allowFallback);
      return;
    }

    const mood = !isNull(this.emotionController)
      ? this.emotionController.currentEmotion
      : DEFAULT_MOOD;

    provider.synthesize(text, mood, {
      onReady: (track: AudioTrackAsset) => {
        if (generation !== this._speechGeneration) {
          this.log("Discarding stale synthesis result");
          return;
        }
        this.playTrack(track);
      },
      onError: (message: string) => {
        if (generation !== this._speechGeneration) {
          return;
        }
        this.log("Synthesis failed: " + message);
        this.routeFallback(text, provider, generation, allowFallback);
      },
    });
  }

  /** Delegate to the Snap fallback if allowed and distinct from the primary. */
  private routeFallback(
    text: string,
    failedProvider: IVoiceProvider | null,
    generation: number,
    allowFallback: boolean,
  ): void {
    const fallback = this.resolveFallback();
    if (allowFallback && fallback && fallback !== failedProvider) {
      this.log("Falling back to Snap TTS");
      this.synthesizeWith(text, fallback, generation, false);
      return;
    }
    this.log("No usable fallback — caption only");
    this.setSpeaking(false);
  }

  private resolvePrimary(): IVoiceProvider | null {
    const provider =
      this.backend === VoiceBackend.ElevenLabs
        ? this.elevenLabsProvider
        : this.snapProvider;
    return isNull(provider) ? null : provider;
  }

  private resolveFallback(): IVoiceProvider | null {
    return isNull(this.snapProvider) ? null : this.snapProvider;
  }

  // ─── Private — Playback & State ───────────────────────────────

  private playTrack(track: AudioTrackAsset): void {
    if (isNull(this.audioComponent)) {
      this.log("AudioComponent not assigned — caption only");
      return;
    }
    this.audioComponent.audioTrack = track;
    this.audioComponent.play(1);
    this.setSpeaking(true);
  }

  private setSpeaking(value: boolean): void {
    if (this._isSpeaking === value) {
      return;
    }
    this._isSpeaking = value;
    this.onSpeakingChangedEvent.invoke(value);
  }

  private hideSpeechBox(): void {
    if (!isNull(this.speechBox)) {
      this.speechBox.hide();
    }
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ZappyVoice] " + message);
    }
  }
}
