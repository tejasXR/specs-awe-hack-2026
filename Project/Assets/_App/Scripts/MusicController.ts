/**
 * MusicController — continuous background music via two crossfading decks.
 *
 * Owns two AudioComponents ("decks") and nothing else: no clip catalog. The
 * caller hands a track to play(); the controller blends the currently playing
 * deck out while the idle deck plays the new track in, so there is never a
 * silent gap. The decks ping-pong roles on each call.
 *
 * Volume is one product per deck:  deck.volume = weight × master × trackGain
 *   • weight    — per deck, 0→1, lerped by the crossfade. One deck rises to 1
 *     while the other falls to 0.
 *   • master    — one global level, normally musicVolume. While Zappy speaks it
 *     eases down to duckVolume and back, so music ducks under TTS.
 *   • trackGain — per deck, the volume requested for that deck's track via
 *     play(track, volume). Set instantly when a track fades in (weight is 0
 *     then, so it's inaudible anyway) and eased when the playing track's volume
 *     is changed live.
 *   Crossfade, duck, and per-track gain ride independent levers, so they
 *   compose without fighting.
 *
 * Ducking subscribes to ZappyVoice.onSpeakingChanged. The voice surface
 * (onSpeakingChanged / isSpeaking) is shared with ZappyVoiceElevenLabs, so a
 * future swap is just repointing the `voice` input — no code change here.
 */
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ZappyVoice } from "./Zappy/ZappyVoice";

const SETTLE_EPSILON = 0.001; // levels within this of target count as settled
const MIN_FADE_SECONDS = 0.01; // floor so a 0s fade is an instant (not /0) snap

@component
export class MusicController extends BaseScriptComponent {
  @ui.separator
  @ui.label("References")
  @input
  @hint("First music deck — a non-spatial AudioComponent")
  deckA!: AudioComponent;

  @input
  @hint("Second music deck — a non-spatial AudioComponent")
  deckB!: AudioComponent;

  @input
  @hint("ZappyVoice — music ducks under its speech (optional)")
  @allowUndefined
  voice!: ZappyVoice;

  @ui.separator
  @ui.label("Settings")
  @input
  @hint("Base music volume when not ducked (0–1)")
  musicVolume: number = 0.7;

  @input
  @hint("Seconds to crossfade from one track to the next")
  crossfadeSeconds: number = 1.5;

  @ui.group_start("Ducking")
  @input
  @hint("Lower music volume while Zappy is speaking")
  enableDucking: boolean = true;

  @input
  @hint("Music volume target while Zappy speaks (0–1)")
  duckVolume: number = 0.25;

  @input
  @hint("Seconds to duck down / release back up")
  duckFadeSeconds: number = 0.3;
  @ui.group_end
  @input
  @hint("Enable debug logging")
  enableLogging: boolean = false;

  private readonly onTrackChangedEvent = new Event<AudioTrackAsset>();

  readonly onTrackChanged: PublicApi<AudioTrackAsset> =
    this.onTrackChangedEvent.publicApi();

  private _decks: AudioComponent[] = [];
  private _weights: number[] = [0, 0]; // current per-deck blend weight
  private _targets: number[] = [0, 0]; // weight each deck is lerping toward
  private _trackGains: number[] = [1, 1]; // current per-deck track volume (0–1)
  private _trackGainTargets: number[] = [1, 1]; // track gain each deck eases toward
  private _activeIndex: number = 0; // deck that owns the current track

  private _master: number = 0; // current global level (set from inputs onStart)
  private _masterTarget: number = 0;
  private _ducking: boolean = false;

  private _update?: SceneEvent;
  private _unsubscribeFromVoice?: unsubscribe;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    this._decks = [this.deckA, this.deckB];

    // Start silent; the first play() fades a track in from nothing.
    this._master = this.musicVolume;
    this._masterTarget = this.musicVolume;
    this._decks.forEach((deck) => {
      deck.volume = 0;
    });

    if (!isNull(this.voice) && this.enableDucking) {
      this._unsubscribeFromVoice = this.voice.onSpeakingChanged.add(
        (speaking) => this.setDucked(speaking),
      );
    }

    // Bound here (not onAwake) so the loop only runs on valid wiring, and
    // disabled until there is something to fade — an idle empty update is waste.
    this._update = this.createEvent("UpdateEvent");
    this._update.bind(() => this.onUpdate());
    this._update.enabled = false;
  }

  private onDestroy(): void {
    this._unsubscribeFromVoice?.();
  }

  /**
   * Crossfade to `track`, playing it at `volume` (0–1, default full). If it's
   * already the active track, the crossfade is skipped but a changed volume
   * eases in live.
   */
  play(track: AudioTrackAsset, volume: number = 1): void {
    const gain = clamp01(volume);
    const active = this._activeIndex;
    const activeDeck = this._decks[active];
    const alreadyPlayingIt =
      activeDeck.audioTrack === track && this._targets[active] === 1;
    if (alreadyPlayingIt) {
      // Same track — no crossfade, but honor a new volume by easing the active
      // deck's gain toward it (onUpdate lerps _trackGains via approach()).
      if (this._trackGainTargets[active] !== gain) {
        this._trackGainTargets[active] = gain;
        this.log("Requested track already playing — easing to new volume.");
        this.wake();
      } else {
        this.log("Requested track already playing — ignoring.");
      }
      return;
    }

    const incoming = 1 - active;
    // Incoming deck is silent (weight 0), so set its gain instantly — the weight
    // crossfade does the audible fade-in, already at the requested volume.
    this._trackGains[incoming] = gain;
    this._trackGainTargets[incoming] = gain;
    this.prepareDeck(incoming, track);
    this._targets[incoming] = 1;
    this._targets[active] = 0;
    this._activeIndex = incoming;

    this.log("Crossfading to new track.");
    this.onTrackChangedEvent.invoke(track);
    this.wake();
  }

  /** Fade all music out to silence. Decks stop once silent; safe to crossfade after. */
  stop(): void {
    this._targets[0] = 0;
    this._targets[1] = 0;
    this.wake();
  }

  /** Set the base (non-ducked) music volume, 0–1. Eases there live. */
  setMusicVolume(volume: number): void {
    this.musicVolume = clamp01(volume);
    this._masterTarget = this.desiredMaster();
    this.wake();
  }

  /** Duck the music under speech (true) or release it (false). */
  setDucked(ducked: boolean): void {
    if (this._ducking === ducked) return;
    this._ducking = ducked;
    this._masterTarget = this.desiredMaster();
    this.wake();
  }

  // ─── Per-frame blend ──────────────────────────────────────────

  private onUpdate(): void {
    const deltaTime = getDeltaTime();
    const fadeStep =
      deltaTime / Math.max(this.crossfadeSeconds, MIN_FADE_SECONDS);
    const duckStep =
      deltaTime / Math.max(this.duckFadeSeconds, MIN_FADE_SECONDS);

    this._weights[0] = approach(this._weights[0], this._targets[0], fadeStep);
    this._weights[1] = approach(this._weights[1], this._targets[1], fadeStep);
    this._trackGains[0] = approach(
      this._trackGains[0],
      this._trackGainTargets[0],
      fadeStep,
    );
    this._trackGains[1] = approach(
      this._trackGains[1],
      this._trackGainTargets[1],
      fadeStep,
    );
    this._master = approach(this._master, this._masterTarget, duckStep);

    this.applyVolumes();

    if (this.isSettled()) {
      this.snapSettled();
      if (this._update) this._update.enabled = false;
    }
  }

  private applyVolumes(): void {
    for (let i = 0; i < this._decks.length; i++) {
      this._decks[i].volume =
        this._weights[i] * this._master * this._trackGains[i];
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────

  /** Load `track` into a deck and ensure it is looping. Preserves current weight for continuity. */
  private prepareDeck(index: number, track: AudioTrackAsset): void {
    const deck = this._decks[index];
    if (deck.audioTrack !== track) {
      if (deck.isPlaying()) deck.stop(false);
      deck.audioTrack = track;
    }
    deck.volume = this._weights[index] * this._master * this._trackGains[index];
    if (!deck.isPlaying()) deck.play(-1);
  }

  private desiredMaster(): number {
    if (this._ducking && this.enableDucking) {
      // Duck can only lower, never raise above the base ceiling.
      return Math.min(this.musicVolume, clamp01(this.duckVolume));
    }
    return this.musicVolume;
  }

  private isSettled(): boolean {
    return (
      Math.abs(this._weights[0] - this._targets[0]) < SETTLE_EPSILON &&
      Math.abs(this._weights[1] - this._targets[1]) < SETTLE_EPSILON &&
      Math.abs(this._trackGains[0] - this._trackGainTargets[0]) <
        SETTLE_EPSILON &&
      Math.abs(this._trackGains[1] - this._trackGainTargets[1]) <
        SETTLE_EPSILON &&
      Math.abs(this._master - this._masterTarget) < SETTLE_EPSILON
    );
  }

  /** Snap to exact targets and stop any deck that has faded fully out. */
  private snapSettled(): void {
    this._master = this._masterTarget;
    for (let i = 0; i < this._decks.length; i++) {
      this._weights[i] = this._targets[i];
      this._trackGains[i] = this._trackGainTargets[i];
      const deck = this._decks[i];
      if (this._targets[i] === 0 && deck.isPlaying()) {
        deck.stop(false);
      }
    }
    this.applyVolumes();
  }

  private wake(): void {
    if (this._update) this._update.enabled = true;
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[MusicController] " + message);
    }
  }
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Move `current` toward `target` by at most `maxDelta`. */
const approach = (
  current: number,
  target: number,
  maxDelta: number,
): number => {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
};
