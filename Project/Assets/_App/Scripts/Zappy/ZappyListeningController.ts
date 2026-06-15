/**
 * ZappyListeningController — the sole owner of the on-device ASR session.
 *
 * Release-to-send: startListening() opens transcription, the live transcript is
 * published as it arrives, and stopAndSend() ends the turn and emits the final
 * query. The *release* terminates the turn, not silence, so silence-termination
 * is set high; finalized fragments are accumulated with the in-progress interim
 * so a multi-fragment utterance is captured whole.
 *
 * Device-only: AsrModule is a Spectacles capability. In the editor there is no
 * mic, so a configurable debug utterance stands in, keeping the whole
 * listen → transcript → query flow testable in Preview.
 *
 * Requires: microphone permission + internet; Spectacles OS / LS versions that
 * ship AsrModule (LS >= 5.9, OS >= 5.61).
 */
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";

/** High, so a release (not a pause) ends the turn; pauses just split fragments. */
const LISTEN_SILENCE_MS = 8000;

@component
export class ZappyListeningController extends BaseScriptComponent {
  @ui.separator
  @ui.label("References")
  @input
  @hint("Optional object enabled while listening (a mic / waveform indicator)")
  @allowUndefined
  activityIndicator!: SceneObject;

  @ui.separator
  @ui.label("Editor")
  @input
  @hint("Stand-in spoken query used in the editor (no on-device microphone)")
  debugUtterance: string = "How do I wire up this LED?";

  @input
  @hint("Enable debug logging")
  enableLogging: boolean = false;

  // AsrModule is Spectacles-only; require it once. Access is guarded by isEditor().
  private asrModule: AsrModule = require("LensStudio:AsrModule");

  private _isListening = false;
  /** Finalized fragments concatenated so far this turn. */
  private _committed = "";
  /** Latest in-progress (non-final) fragment. */
  private _interim = "";

  // ─── Events ───────────────────────────────────────────────────

  private readonly onListeningChangedEvent = new Event<boolean>();
  /** Fires true when a listening turn opens, false when it ends. */
  readonly onListeningChanged: PublicApi<boolean> =
    this.onListeningChangedEvent.publicApi();

  private readonly onTranscriptUpdatedEvent = new Event<string>();
  /** Fires with the live transcript (committed + interim) as it grows. */
  readonly onTranscriptUpdated: PublicApi<string> =
    this.onTranscriptUpdatedEvent.publicApi();

  private readonly onQueryReadyEvent = new Event<string>();
  /** Fires once on release with the final query (may be empty). */
  readonly onQueryReady: PublicApi<string> = this.onQueryReadyEvent.publicApi();

  // ─── Lifecycle ────────────────────────────────────────────────

  onAwake(): void {
    this.setIndicator(false);
  }

  // ─── Public API ───────────────────────────────────────────────

  /** Open a listening turn. No-op if already listening. */
  startListening(): void {
    if (this._isListening) {
      return;
    }
    this._isListening = true;
    this._committed = "";
    this._interim = "";
    this.setIndicator(true);
    this.onListeningChangedEvent.invoke(true);

    if (this.isEditor()) {
      this.log("Editor — ASR skipped; release will send the debug utterance");
      return;
    }

    try {
      const options = AsrModule.AsrTranscriptionOptions.create();
      options.mode = AsrModule.AsrMode.HighAccuracy;
      options.silenceUntilTerminationMs = LISTEN_SILENCE_MS;
      options.onTranscriptionUpdateEvent.add((args) =>
        this.handleTranscription(args.text, args.isFinal),
      );
      options.onTranscriptionErrorEvent.add((code) =>
        this.handleAsrError(code),
      );
      this.asrModule.startTranscribing(options);
      this.log("ASR started");
    } catch (e) {
      this.handleAsrError(e);
    }
  }

  /** Close the listening turn and emit the final query (release-to-send). */
  stopAndSend(): void {
    if (!this._isListening) {
      return;
    }
    this._isListening = false;
    this.setIndicator(false);
    this.onListeningChangedEvent.invoke(false);

    let query: string;
    if (this.isEditor()) {
      query = this.debugUtterance;
    } else {
      this.asrModule
        .stopTranscribing()
        .catch((e) => this.log("stopTranscribing failed: " + e));
      query = this.currentText();
    }

    this.onQueryReadyEvent.invoke(query.trim());
  }

  /** True while a listening turn is open. */
  getIsListening(): boolean {
    return this._isListening;
  }

  // ─── Private ──────────────────────────────────────────────────

  private handleTranscription(text: string, isFinal: boolean): void {
    if (isFinal) {
      this._committed = this.appendFragment(this._committed, text);
      this._interim = "";
    } else {
      this._interim = text;
    }
    this.onTranscriptUpdatedEvent.invoke(this.currentText());
  }

  private handleAsrError(code: unknown): void {
    // The user may still be holding; leave the turn open so stopAndSend() tears
    // down on release and sends whatever (if anything) was captured.
    this.log("ASR error: " + code);
  }

  private currentText(): string {
    return [this._committed.trim(), this._interim.trim()]
      .filter((part) => part.length > 0)
      .join(" ");
  }

  private appendFragment(base: string, fragment: string): string {
    const trimmed = fragment.trim();
    if (trimmed.length === 0) {
      return base;
    }
    return base.length === 0 ? trimmed : base + " " + trimmed;
  }

  private setIndicator(on: boolean): void {
    if (!isNull(this.activityIndicator)) {
      this.activityIndicator.enabled = on;
    }
  }

  private isEditor(): boolean {
    return global.deviceInfoSystem.isEditor();
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ZappyListening] " + message);
    }
  }
}
