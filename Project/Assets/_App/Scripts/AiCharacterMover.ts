import type { unsubscribe } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { AiCharacter, AiCharacterState } from "./AiCharacter";
import { AiCharacterOptionsController } from "./AiCharacterOptionsController";

const TWO_PI = Math.PI * 2;
const ARRIVE_EPSILON = 0.01; // cm — distances below this count as "arrived"

@component
export class AiCharacterMover extends BaseScriptComponent {
  @input
  @hint("The AiCharacter state store this mover follows")
  assistant!: AiCharacter;

  @input
  @hint("While this controller's options are visible, the mover pauses (bob and travel)")
  @allowUndefined
  optionsController!: AiCharacterOptionsController;

  @ui.group_start("Float Bob")
  @input
  @hint("How far the character bobs up and down (magnitude), in cm")
  floatAmplitude: number = 2.0;
  @input
  @hint("How fast the character bobs, in cycles per second")
  floatFrequency: number = 0.5;
  @ui.group_end
  @ui.group_start("Travel")
  @input
  @hint("Travel speed toward the destination, in cm per second")
  moveToDestinationSpeed: number = 30.0;
  @ui.group_end
  private _transform!: Transform;

  private _basePosition!: vec3;
  private _destination!: vec3;
  private readonly _scratchWorldPosition = new vec3(0, 0, 0); // reused every frame

  private _isFloatSuppressed: boolean = false;
  private _floatPhase: number = 0; // advances only while unsuppressed, so pause/resume is seamless

  private _unsubscribeFromState?: unsubscribe;
  private _unsubscribeFromOptions?: unsubscribe;

  onAwake(): void {
    this._transform = this.getTransform();
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    this._basePosition = copyOf(this._transform.getWorldPosition());
    this._destination = copyOf(this._basePosition);

    this._unsubscribeFromState = this.assistant.onStateChanged.add((state) =>
      this.onStateChanged(state),
    );
    this.onStateChanged(this.assistant.state); // sync with the pre-subscribe state

    if (!isNull(this.optionsController)) {
      this._unsubscribeFromOptions =
        this.optionsController.onOptionsToggled.add((visible) =>
          this.onOptionsToggled(visible),
        );
      this.onOptionsToggled(this.optionsController.optionsVisible); // sync
    }

    // Bound here, not in onAwake, so the update loop only runs on valid wiring.
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  private onDestroy(): void {
    this._unsubscribeFromState?.();
    this._unsubscribeFromOptions?.();
  }

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

  private onOptionsToggled(optionsVisible: boolean): void {
    this._isFloatSuppressed = optionsVisible;
  }

  private onUpdate(): void {
    // Paused while the options are open — phase freezes with everything else,
    // so resume continues the bob exactly where it left off.
    if (this._isFloatSuppressed) {
      return;
    }

    const deltaTime = getDeltaTime();
    this.moveBaseTowardDestination(deltaTime);
    this._floatPhase += deltaTime * this.floatFrequency * TWO_PI;

    const bob = Math.sin(this._floatPhase) * this.floatAmplitude;
    this._scratchWorldPosition.x = this._basePosition.x;
    this._scratchWorldPosition.y = this._basePosition.y + bob;
    this._scratchWorldPosition.z = this._basePosition.z;
    this._transform.setWorldPosition(this._scratchWorldPosition);
  }

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

const copyOf = (v: vec3): vec3 => new vec3(v.x, v.y, v.z);

const assertNever = (x: never): never => {
  throw new Error(`Unhandled AiCharacterState: ${JSON.stringify(x)}`);
};
