import type { unsubscribe } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { AiCharacter, AiCharacterState } from "./AiCharacter";

const TWO_PI = Math.PI * 2;
const ARRIVE_EPSILON = 0.01; // cm — distances below this count as "arrived"

@component
export class AiCharacterMover extends BaseScriptComponent {
  @input
  @hint("The AiCharacter state store this mover follows")
  assistant!: AiCharacter;

  @input
  @hint("Vertical bob amplitude, in cm")
  floatAmplitude: number = 2.0;

  @input
  @hint("Bob cycles per second")
  floatFrequency: number = 0.5;

  @input
  @hint("Travel speed toward the destination, in cm per second")
  moveToDestinationSpeed: number = 30.0;

  private _transform!: Transform;
  private _basePosition!: vec3; // smoothed position the bob is layered onto
  private _destination!: vec3; // resting world position the base eases toward
  private readonly _scratchWorldPosition = new vec3(0, 0, 0); // reused every frame

  private _unsubscribeFromState?: unsubscribe;

  onAwake(): void {
    this._transform = this.getTransform();
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() =>
      this._unsubscribeFromState?.(),
    );
  }

  private onStart(): void {
    if (isNull(this.assistant)) {
      print("[AiCharacterMover] 'assistant' input is not wired — disabled.");
      return;
    }

    this._basePosition = copyOf(this._transform.getWorldPosition());
    this._destination = copyOf(this._basePosition);

    this._unsubscribeFromState = this.assistant.onStateChanged.add((state) =>
      this.onStateChanged(state),
    );
    this.onStateChanged(this.assistant.state); // sync with the pre-subscribe state

    // Bound here, not in onAwake, so the update loop only runs on valid wiring.
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  /** The single place that branches on state — it only picks the destination. */
  private onStateChanged(state: AiCharacterState): void {
    switch (state.kind) {
      case "idling":
        this._destination = copyOf(this._basePosition); // settle & float in place
        break;
      case "helping":
      case "investigating":
        this._destination = copyOf(state.target);
        break;
      default:
        assertNever(state);
    }
  }

  private onUpdate(): void {
    this.moveBaseTowardDestination(getDeltaTime());

    const bob =
      Math.sin(getTime() * this.floatFrequency * TWO_PI) * this.floatAmplitude;
    this._scratchWorldPosition.x = this._basePosition.x;
    this._scratchWorldPosition.y = this._basePosition.y + bob;
    this._scratchWorldPosition.z = this._basePosition.z;
    this._transform.setWorldPosition(this._scratchWorldPosition);
  }

  /** Constant-speed move-towards with a clean snap on arrival. */
  private moveBaseTowardDestination(deltaTime: number): void {
    const toDestination = this._destination.sub(this._basePosition);
    const distance = toDestination.length;
    const step = this.moveToDestinationSpeed * deltaTime;

    if (distance <= step || distance < ARRIVE_EPSILON) {
      this._basePosition = copyOf(this._destination);
      return;
    }

    this._basePosition = this._basePosition.add(
      toDestination.uniformScale(step / distance),
    );
  }
}

/** vec3 is a mutable reference type — copy at ownership boundaries, don't alias. */
const copyOf = (v: vec3): vec3 => new vec3(v.x, v.y, v.z);

const assertNever = (x: never): never => {
  throw new Error(`Unhandled AiCharacterState: ${JSON.stringify(x)}`);
};
