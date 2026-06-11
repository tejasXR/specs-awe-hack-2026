/**
 * ZappyVoice — everything about how Zappy sounds, in one place.
 *
 * Driven by the ZappyAI facade, which calls speak() for each line: synthesis
 * via the TextToSpeechModule, playback through the assigned AudioComponent,
 * and an optional caption Text mirror. Any system may also call speak()
 * directly to voice a fixed line without a Gemini round-trip.
 *
 * Reads ZappyEmotionController.currentEmotion at speak time — the extension
 * point where a future voice system derives delivery (style/pace/volume)
 * from mood. Exposes onSpeakingChanged so animation can react to playback.
 */
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ZappyEmotionController } from "./ZappyEmotionController";

@component
export class ZappyVoice extends BaseScriptComponent {
  @ui.separator
  @ui.label("References")
  @input
  @allowUndefined
  emotionController!: ZappyEmotionController;

  @input
  @hint(
    "TextToSpeechModule asset — add via Resources > + > Text To Speech Module",
  )
  @allowUndefined
  ttsModule!: TextToSpeechModule;

  @input
  @hint("AudioComponent that plays the synthesized speech")
  @allowUndefined
  audioComponent!: AudioComponent;

  @input
  @hint("Optional caption text — mirrors whatever Zappy says")
  @allowUndefined
  speechText!: Text;

  @ui.separator
  @ui.label("Settings")
  @input
  @hint("TTS voice preset name")
  voiceName: string = "Sasha";

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
      this.audioComponent.setOnFinish(() => this.setSpeaking(false));
    }
  }

  // ─── Public API ───────────────────────────────────────────────

  /**
   * Voice a line: caption immediately, then synthesize and play. A newer
   * speak() supersedes any synthesis still in flight.
   */
  speak(text: string): void {
    const generation = ++this._speechGeneration;

    // Extension point: when the voice system supports delivery knobs
    // (or is replaced), derive them from the current mood here.
    if (!isNull(this.emotionController)) {
      const mood = this.emotionController.currentEmotion;
      this.log("Speaking as " + mood.emotion + " (" + mood.intensity + ")");
    }

    if (!isNull(this.speechText)) {
      this.speechText.text = text;
    }

    if (isNull(this.ttsModule) || isNull(this.audioComponent)) {
      this.log("TTS module or AudioComponent not assigned -- caption only");
      return;
    }

    const options = TextToSpeech.Options.create();
    options.voiceName = this.voiceName;

    this.ttsModule.synthesize(
      text,
      options,
      (audioTrack: AudioTrackAsset, wordInfo: TextToSpeech.WordInfo[]) => {
        if (generation !== this._speechGeneration) {
          this.log("Discarding stale TTS result");
          return;
        }
        this.log("TTS audio ready (" + wordInfo.length + " words)");
        this.audioComponent.audioTrack = audioTrack;
        this.audioComponent.play(1);
        this.setSpeaking(true);
      },
      (error: number, description: string) => {
        this.log("TTS error " + error + ": " + description);
        this.setSpeaking(false);
      },
    );
  }

  /** Cut the current line short and drop any in-flight synthesis. */
  stop(): void {
    this._speechGeneration++;
    if (!isNull(this.audioComponent) && this.audioComponent.isPlaying()) {
      this.audioComponent.stop(false);
    }
    this.setSpeaking(false);
  }

  // ─── Private ──────────────────────────────────────────────────

  private setSpeaking(value: boolean): void {
    if (this._isSpeaking === value) {
      return;
    }
    this._isSpeaking = value;
    this.onSpeakingChangedEvent.invoke(value);
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ZappyVoice] " + message);
    }
  }
}
