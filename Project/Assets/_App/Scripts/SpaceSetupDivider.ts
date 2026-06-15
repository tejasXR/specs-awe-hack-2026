import { ScaleVisibilityAnimator } from "./Utils/ScaleVisibilityAnimator";

export type DividerKind = "breadboard" | "wires" | "leds" | "transistors";

@component
export class SpaceSetupDivider extends BaseScriptComponent {
  @input
  @hint("Which component this divider represents — how SpaceSetup addresses it")
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Breadboard", "breadboard"),
      new ComboBoxItem("Wires", "wires"),
      new ComboBoxItem("LEDs", "leds"),
      new ComboBoxItem("Transistors", "transistors"),
    ]),
  )
  kind: string = "breadboard";

  @input
  @hint(
    "Line anchor for this divider's connector line — held for line-visibility control, not the show/hide target.",
  )
  lineAnchor!: SceneObject;

  private animator!: ScaleVisibilityAnimator;

  onAwake(): void {
    this.animator = new ScaleVisibilityAnimator(this.getSceneObject());
    this.animator.hideImmediate();
  }

  get dividerKind(): DividerKind {
    return this.kind as DividerKind;
  }

  show(): void {
    this.animator.show();
  }

  hide(): void {
    this.animator.hide();
  }

  getLocalLineAnchor(): SceneObject {
    return this.lineAnchor;
  }
}
