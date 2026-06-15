/**
 * ZappySpeechController — the single authority over the one ZappySpeechBox.
 *
 * Two flows write captions: the listening flow (the user's live transcript) and
 * ZappyVoice (Zappy's reply). Routing both through this controller — instead of
 * letting each touch the box directly — gives one owner and a source-aware state
 * machine, so the writers can't race:
 *
 *   - showZappy() supersedes a listening caption (Zappy's answer wins)
 *   - endZappy() only hides if Zappy is the current source, so a duck-stop
 *     during a fresh hold can't wipe the listening caption
 *   - render() dedupes identical writes to avoid per-frame Text relayout
 */
import { ZappySpeechBox } from "./ZappySpeechBox";

type CaptionSource = "hidden" | "listening" | "zappy";

const SPEAKER_USER = "LISTENING...";
const SPEAKER_ZAPPY = "";

@component
export class ZappySpeechController extends BaseScriptComponent {
  @input
  @hint("The speech box this controller exclusively owns")
  speechBox!: ZappySpeechBox;

  @input
  @hint("Enable debug logging")
  enableLogging: boolean = false;

  private _source: CaptionSource = "hidden";
  private _rendered = "";

  onAwake(): void {}

  showListening(text: string): void {
    this._source = "listening";
    this.render(SPEAKER_USER, text);
    this.reveal();
  }

  updateListening(text: string): void {
    if (this._source !== "listening") {
      return;
    }
    this.render(SPEAKER_USER, text);
  }

  showZappy(caption: string): void {
    this._source = "zappy";
    this.render(SPEAKER_ZAPPY, caption);
    this.reveal();
  }

  endZappy(): void {
    if (this._source !== "zappy") {
      return;
    }
    this.conceal();
  }

  hide(): void {
    this.conceal();
  }

  private reveal(): void {
    if (!isNull(this.speechBox)) {
      this.speechBox.show();
    }
  }

  private conceal(): void {
    this._source = "hidden";
    this._rendered = "";
    if (!isNull(this.speechBox)) {
      this.speechBox.hide();
    }
  }

  private render(speaker: string, text: string): void {
    const key = speaker + "" + text;
    if (key === this._rendered) {
      return;
    }
    this._rendered = key;

    this.speechBox.setSpeaker(speaker);
    this.speechBox.setCaption(text);
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ZappySpeechController] " + message);
    }
  }
}
