/**
 * ZappyEmotionController — holds Zappy's emotional state.
 *
 * setEmotion() is the single write point: the ZappyAI facade calls it when
 * routing brain responses (and thinking/error policy), and game systems may
 * call it directly. Emits onEmotionStateChanged only on real changes, so
 * consumers (voice, animation, poses) can react without deduplicating.
 */
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ZappyEmotion, ZappyEmotionData } from "./ZappyBrain";

/** Intensity moves smaller than this don't count as a state change. */
const INTENSITY_EPSILON = 0.001;

@component
export class ZappyEmotionController extends BaseScriptComponent {
  @input
  @hint("Enable debug logging")
  enableLogging: boolean = false;

  private readonly onEmotionStateChangedEvent = new Event<ZappyEmotionData>();

  readonly onEmotionStateChanged: PublicApi<ZappyEmotionData> =
    this.onEmotionStateChangedEvent.publicApi();

  private _currentEmotion: ZappyEmotionData = {
    emotion: ZappyEmotion.Neutral,
    intensity: 0.5,
  };

  get currentEmotion(): Readonly<ZappyEmotionData> {
    return this._currentEmotion;
  }

  /** The single write point for Zappy's emotion. Suppresses no-op writes. */
  setEmotion(emotion: ZappyEmotion, intensity: number): void {
    const clamped = Math.max(0, Math.min(1, intensity));

    const unchanged =
      emotion === this._currentEmotion.emotion &&
      Math.abs(clamped - this._currentEmotion.intensity) < INTENSITY_EPSILON;
    if (unchanged) {
      return;
    }

    this._currentEmotion = { emotion, intensity: clamped };
    this.log("Emotion -> " + emotion + " (" + clamped + ")");
    this.onEmotionStateChangedEvent.invoke(this._currentEmotion);
  }

  // ─── Private ──────────────────────────────────────────────────

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ZappyEmotionController] " + message);
    }
  }
}
