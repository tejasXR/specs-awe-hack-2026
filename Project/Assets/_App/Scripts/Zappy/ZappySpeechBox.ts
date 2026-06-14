import { ScaleVisibilityAnimator } from "../Utils/ScaleVisibilityAnimator";

@component
export class ZappySpeechBox extends BaseScriptComponent {
  @ui.separator
  @ui.label("References")
  @input
  @hint("Caption text that mirrors whatever Zappy says")
  @allowUndefined
  speechText!: Text;

  private _animator!: ScaleVisibilityAnimator;

  onAwake(): void {
    // Capture the authored (visible) scale now, before anything hides the box.
    this._animator = new ScaleVisibilityAnimator(this.getSceneObject());
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    // Start hidden — the box only appears when there's something to say.
    this._animator.hideImmediate();
  }

  /** Show `caption` in the box. Pass the already-rendered string (tags stripped). */
  setCaption(caption: string): void {
    if (isNull(this.speechText)) {
      return;
    }
    this.speechText.text = caption;
  }

  /** Animate the speech box in. */
  show(): void {
    this._animator.show();
  }

  /** Animate the speech box out (disables the object once the shrink completes). */
  hide(): void {
    this._animator.hide();
  }
}
