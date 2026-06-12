/**
 * MusicController — continuous background music via two crossfading decks.
 *
 * Owns two AudioComponents ("decks") and nothing else: no clip catalog. The
 * caller hands a track to crossfadeTo(); the controller blends the currently
 * playing deck out while the idle deck plays the new track in, so there is
 * never a silent gap. The decks ping-pong roles on each call.
 *
 * Volume is one product per deck:  deck.volume = weight × master
 *   • weight  — per deck, 0→1, lerped by the crossfade. One deck rises to 1
 *     while the other falls to 0.
 *   • master  — one global level, normally musicVolume. While Zappy speaks it
 *     eases down to duckVolume and back, so music ducks under TTS. Crossfade
 *     and duck ride independent levers, so they compose without fighting.
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

  // ─── Events ───────────────────────────────────────────────────

  private readonly onTrackChangedEvent = new Event<AudioTrackAsset>();
  /** Fires when a new track begins crossing in (with that track). */
  readonly onTrackChanged: PublicApi<AudioTrackAsset> =
    this.onTrackChangedEvent.publicApi();

  // ─── Private State ────────────────────────────────────────────

  private _decks: AudioComponent[] = [];
  private _weights: number[] = [0, 0]; // current per-deck blend weight
  private _targets: number[] = [0, 0]; // weight each deck is lerping toward
  private _activeIndex: number = 0; // deck that owns the current track

  private _master: number = 0; // current global level (set from inputs onStart)
  private _masterTarget: number = 0;
  private _ducking: boolean = false;

  private _update?: SceneEvent;
  private _unsubscribeFromVoice?: unsubscribe;

  // ─── Lifecycle ────────────────────────────────────────────────

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    if (isNull(this.deckA) || isNull(this.deckB)) {
      this.log("Both deck AudioComponents must be wired — disabled.");
      return;
    }
    this._decks = [this.deckA, this.deckB];

    // Start silent; the first crossfadeTo() fades a track in from nothing.
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

  // ─── Public API ───────────────────────────────────────────────

  /**
   * Crossfade to `track`, looping it. The idle deck takes the new track and
   * rises while the active deck falls. No-op if `track` is already the one
   * being played to.
   */
  crossfadeTo(track: AudioTrackAsset): void {
    if (isNull(track)) {
      this.log("crossfadeTo called with no track — ignoring.");
      return;
    }
    if (this._decks.length < 2) {
      this.log("Decks not ready — ignoring crossfadeTo.");
      return;
    }

    const activeDeck = this._decks[this._activeIndex];
    const alreadyPlayingIt =
      activeDeck.audioTrack === track && this._targets[this._activeIndex] === 1;
    if (alreadyPlayingIt) {
      this.log("Requested track already playing — ignoring.");
      return;
    }

    const incoming = 1 - this._activeIndex;
    this.prepareDeck(incoming, track);
    this._targets[incoming] = 1;
    this._targets[this._activeIndex] = 0;
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
    const fadeStep = deltaTime / Math.max(this.crossfadeSeconds, MIN_FADE_SECONDS);
    const duckStep = deltaTime / Math.max(this.duckFadeSeconds, MIN_FADE_SECONDS);

    this._weights[0] = approach(this._weights[0], this._targets[0], fadeStep);
    this._weights[1] = approach(this._weights[1], this._targets[1], fadeStep);
    this._master = approach(this._master, this._masterTarget, duckStep);

    this.applyVolumes();

    if (this.isSettled()) {
      this.snapSettled();
      if (this._update) this._update.enabled = false;
    }
  }

  private applyVolumes(): void {
    for (let i = 0; i < this._decks.length; i++) {
      this._decks[i].volume = this._weights[i] * this._master;
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
    deck.volume = this._weights[index] * this._master;
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
      Math.abs(this._master - this._masterTarget) < SETTLE_EPSILON
    );
  }

  /** Snap to exact targets and stop any deck that has faded fully out. */
  private snapSettled(): void {
    this._master = this._masterTarget;
    for (let i = 0; i < this._decks.length; i++) {
      this._weights[i] = this._targets[i];
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
const approach = (current: number, target: number, maxDelta: number): number => {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
};
