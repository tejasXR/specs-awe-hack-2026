/**
 * ZappySnapVoiceProvider — Snap TextToSpeechModule backend for ZappyVoice.
 *
 * The built-in, offline-friendly voice: synthesizes via the on-device
 * TextToSpeechModule and hands the resulting AudioTrackAsset back to the
 * ZappyVoice coordinator, which owns playback, captions, and speaking state.
 *
 * Speaks text verbatim (no audio tags), so toCaption() is identity. This is
 * also ZappyVoice's default fallback when an expressive backend (ElevenLabs)
 * is unconfigured or fails — so the experience never goes silent.
 */
import { ZappyEmotionData } from "./ZappyResponse";
import { IVoiceProvider, VoiceSynthesisCallbacks } from "./IVoiceProvider";

@component
export class ZappyTTSVoiceProvider
  extends BaseScriptComponent
  implements IVoiceProvider
{
  @ui.separator
  @ui.label("Snap TTS")
  @input
  @hint(
    "TextToSpeechModule asset — add via Resources > + > Text To Speech Module",
  )
  @allowUndefined
  ttsModule!: TextToSpeechModule;

  @input
  @hint("TTS voice preset name")
  voiceName: string = "Sasha";

  @ui.separator
  @ui.label("Settings")
  @input
  @hint("Enable debug logging")
  enableLogging: boolean = false;

  // ─── IVoiceProvider ───────────────────────────────────────────

  isAvailable(): boolean {
    return !isNull(this.ttsModule);
  }

  /** Snap TTS speaks text verbatim — captions match the spoken line. */
  toCaption(text: string): string {
    return text;
  }

  synthesize(
    text: string,
    mood: Readonly<ZappyEmotionData>,
    callbacks: VoiceSynthesisCallbacks,
  ): void {
    if (isNull(this.ttsModule)) {
      callbacks.onError("TextToSpeechModule not assigned");
      return;
    }

    // Snap TTS has no delivery knobs yet — mood is informational only. This
    // is the extension point where a future preset/pitch mapping would read it.
    this.log("Speaking as " + mood.emotion + " (" + mood.intensity + ")");

    const options = TextToSpeech.Options.create();
    options.voiceName = this.voiceName;

    this.ttsModule.synthesize(
      text,
      options,
      (audioTrack: AudioTrackAsset, wordInfo: TextToSpeech.WordInfo[]) => {
        this.log("TTS audio ready (" + wordInfo.length + " words)");
        callbacks.onReady(audioTrack);
      },
      (error: number, description: string) => {
        callbacks.onError("TTS error " + error + ": " + description);
      },
    );
  }

  // ─── Private ──────────────────────────────────────────────────

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ZappySnapVoiceProvider] " + message);
    }
  }
}
