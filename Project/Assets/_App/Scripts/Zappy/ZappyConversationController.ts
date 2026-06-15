/**
 * ZappyConversationController — wires the press-and-hold-to-talk loop.
 *
 *   hold start → duck Zappy, show "Listening…", open the ASR turn
 *   speaking    → live transcript mirrored into the speech box ("You")
 *   release     → final query sent to Zappy (ZappyAI.activate); the persona's
 *                 system instruction already carries the build context, so the
 *                 turn is just the spoken question
 *   reply       → ZappyVoice flips the box to "Zappy" and hides it on finish
 *
 * Owns the no-response paths the voice layer can't see: empty transcript, a
 * busy Zappy (lightweight guard), or a failed request — each hides the box so
 * it's never orphaned showing the user's words.
 */
import { unsubscribe } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ZappyInteractionsController } from "./ZappyInteractionsController";
import { ZappyListeningController } from "./ZappyListeningController";
import { ZappyAI } from "./ZappyAI";
import { ZappySpeechController } from "./ZappySpeechController";

const LISTENING_PLACEHOLDER = "Listening…";

@component
export class ZappyConversationController extends BaseScriptComponent {
  @ui.separator
  @ui.label("References")
  @input
  @hint("Tap/hold classifier on Zappy — provides onHoldStart / onHoldEnd")
  @allowUndefined
  interactions!: ZappyInteractionsController;

  @input
  @hint("ASR session owner — captures the spoken query")
  @allowUndefined
  listening!: ZappyListeningController;

  @input
  @hint("Zappy facade — answers via Gemini and voices the reply")
  @allowUndefined
  zappyAI!: ZappyAI;

  @input
  @hint("Speech controller — shows the live transcript while listening")
  @allowUndefined
  speechController!: ZappySpeechController;

  @input
  @hint("Enable debug logging")
  enableLogging: boolean = false;

  private _unsubs: unsubscribe[] = [];

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    const problems: string[] = [];
    if (isNull(this.interactions)) problems.push("interactions");
    if (isNull(this.listening)) problems.push("listening");
    if (isNull(this.zappyAI)) problems.push("zappyAI");
    if (isNull(this.speechController)) problems.push("speechController");
    if (problems.length > 0) {
      this.log("Unassigned inputs, disabled: " + problems.join(", "));
      return;
    }

    this._unsubs.push(
      this.interactions.onHoldStart.add(() => this.onHoldStart()),
    );
    this._unsubs.push(this.interactions.onHoldEnd.add(() => this.onHoldEnd()));
    this._unsubs.push(
      this.listening.onTranscriptUpdated.add((text) =>
        this.onTranscriptUpdated(text),
      ),
    );
    this._unsubs.push(
      this.listening.onQueryReady.add((query) => this.onQueryReady(query)),
    );
    this._unsubs.push(
      this.zappyAI.onRequestFailed.add(() => this.onRequestFailed()),
    );
  }

  private onHoldStart(): void {
    // Duck Zappy first so its stop()→endZappy can't wipe the listening caption.
    // The speech controller is source-aware, so this stays safe even if reordered.
    this.zappyAI.stopSpeaking();
    this.speechController.showListening(LISTENING_PLACEHOLDER);
    this.listening.startListening();
  }

  private onHoldEnd(): void {
    this.listening.stopAndSend();
  }

  private onTranscriptUpdated(text: string): void {
    this.speechController.updateListening(
      text.length > 0 ? text : LISTENING_PLACEHOLDER,
    );
  }

  private onQueryReady(query: string): void {
    if (query.length === 0) {
      this.log("Empty query — nothing to ask");
      this.speechController.hide();
      return;
    }

    // Freeze the final heard text under "You" until Zappy's reply takes over.
    this.speechController.showListening(query);

    if (this.zappyAI.isResponding()) {
      this.log("Zappy busy — dropping query: " + query.substring(0, 40));
      this.speechController.hide();
      return;
    }

    this.log("Asking Zappy: " + query.substring(0, 40));
    this.zappyAI.activate(query);
  }

  private onRequestFailed(): void {
    this.log("Request failed — hiding the speech box");
    this.speechController.hide();
  }

  private onDestroy(): void {
    this._unsubs.forEach((unsub) => unsub());
    this._unsubs = [];
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ZappyConversation] " + message);
    }
  }
}
