import { ScaleVisibilityAnimator } from "../Utils/ScaleVisibilityAnimator";

@component
export class ZappySpeechBox extends BaseScriptComponent {
  @input
  @hint("Caption text that mirrors whatever Zappy says")
  speechText!: Text;

  @input
  @hint("Optional label naming the current speaker (e.g. You / Zappy)")
  speakerLabel!: Text;

  private _animator!: ScaleVisibilityAnimator;

  onAwake(): void {
    this._animator = new ScaleVisibilityAnimator(this.getSceneObject());
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    this._animator.hideImmediate();
  }

  setCaption(caption: string): void {
    if (isNull(this.speechText)) {
      return;
    }
    this.speechText.text = caption;
  }

  setSpeaker(label: string): void {
    if (isNull(this.speakerLabel)) {
      return;
    }
    if (this.speakerLabel.text !== label) {
      this.speakerLabel.text = label;
    }
  }

  show(): void {
    this._animator.show();
  }

  hide(): void {
    this._animator.hide();
  }
}
