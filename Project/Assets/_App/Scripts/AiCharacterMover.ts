import { AiCharacter, AiCharacterState } from "./AiCharacter";

const TWO_PI = Math.PI * 2;
const ARRIVE_EPSILON = 0.01;

@component
export class AiCharacterMover extends BaseScriptComponent {
  @input
  public assistant!: AiCharacter;
  @input
  public floatAmplitude: number = 2.0;
  @input
  public floatFrequency: number = 0.5;
  @input
  public moveSpeed: number = 30.0;

  private _transform!: Transform;
  private _anchor!: vec3; // resting world position the character travels toward
  private _currentBaseSpeed!: vec3; // smoothly-moving base, before the float offset

  onAwake() {
    this._transform = this.getTransform();
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  private onStart() {
    this._currentBaseSpeed = this._transform.getWorldPosition();
    this._anchor = this._currentBaseSpeed;
    this.assistant.onStateChanged.add((s) => this.onStateChanged(s));
    this.onStateChanged(this.assistant.state); // sync initial state
  }

  /** Only place that branches on state — moves the anchor; motion itself is state-agnostic. */
  private onStateChanged(state: AiCharacterState): void {
    switch (state.kind) {
      case "idling":
        this._anchor = this._currentBaseSpeed; // settle & float in place
        break;
      case "helping":
      case "investigating":
        this._anchor = state.target;
        break;
      default:
        assertNever(state);
    }
  }

  private onUpdate(): void {
    const dt = getDeltaTime();

    // Ease the base toward the anchor at constant speed (move-towards, clean arrival).
    const toAnchor = this._anchor.sub(this._currentBaseSpeed);
    const dist = toAnchor.length;
    const step = this.moveSpeed * dt;
    if (dist <= step || dist < ARRIVE_EPSILON) {
      this._currentBaseSpeed = this._anchor;
    } else {
      this._currentBaseSpeed = this._currentBaseSpeed.add(
        toAnchor.uniformScale(step / dist),
      );
    }

    // Layer the always-on float bob on top.
    const bob =
      Math.sin(getTime() * this.floatFrequency * TWO_PI) * this.floatAmplitude;
    this._transform.setWorldPosition(
      this._currentBaseSpeed.add(new vec3(0, bob, 0)),
    );
  }
}

const assertNever = (x: never): never => {
  throw new Error(`Unhandled AiCharacterState: ${JSON.stringify(x)}`);
};
