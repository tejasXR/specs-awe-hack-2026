@component
export class ZappySpeechBox extends BaseScriptComponent {
  @ui.separator
  @ui.label("References")
  @input
  @hint("Caption text that mirrors whatever Zappy says")
  @allowUndefined
  speechText!: Text;

  /** Show `caption` in the box. Pass the already-rendered string (tags stripped). */
  setCaption(caption: string): void {
    if (isNull(this.speechText)) {
      return;
    }
    this.speechText.text = caption;
  }
}
