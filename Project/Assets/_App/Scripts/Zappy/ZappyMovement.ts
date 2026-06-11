/**
 * ZappyMovement — Zappy's locomotion: constant-speed travel to a target plus
 * a continuous float bob. Driven imperatively by the ZappyAI facade
 * (moveTo / returnHome). Adapted from AiCharacterMover, dropping the
 * AiCharacter state-store subscription in favor of direct method calls.
 *
 * Pause is a freeze, not a fade: while paused, travel, bob, AND the bob phase
 * all stop, so resuming continues the motion exactly where it left off. (This
 * is the deliberate behavior — an eased weight read as a jolt.) The options
 * menu pauses movement while it's open, when wired.
 */
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { ZappyOptionsController } from "./ZappyOptionsController";

const TWO_PI = Math.PI * 2;
const ARRIVE_EPSILON = 0.01; // cm — distances below this count as "arrived"

@component
export class ZappyMovement extends BaseScriptComponent {


  @input
  optionsController!: ZappyOptionsController;

  @ui.group_start("Float Bob")
  @input
  @hint("How far Zappy bobs up and down (magnitude), in cm")
  floatAmplitude: number = 2.0;
  @input
  @hint("How fast Zappy bobs, in cycles per second")
  floatFrequency: number = 0.5;
  @ui.group_end
  @ui.group_start("Travel")
  @input
  @hint("Travel speed toward the destination, in cm per second")
  moveToDestinationSpeed: number = 30.0;
  @ui.group_end
  private readonly onArrivedEvent = new Event<void>();

  readonly onArrived: PublicApi<void> = this.onArrivedEvent.publicApi();

  private _transform!: Transform;
  private _homePosition!: vec3;
  private _basePosition!: vec3;
  private _destination!: vec3;
  private readonly _scratchWorldPosition = new vec3(0, 0, 0); // reused every frame

  private _isPaused: boolean = false;
  private _floatPhase: number = 0; // advances only while unpaused, so pause/resume is seamless
  private _hasArrived: boolean = true; // resting at destination; gates onArrived to fire once

  private _unsubscribeFromOptions?: unsubscribe;

  onAwake(): void {
    this._transform = this.getTransform();
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    this._homePosition = copyOf(this._transform.getWorldPosition());
    this._basePosition = copyOf(this._homePosition);
    this._destination = copyOf(this._homePosition);

    if (!isNull(this.optionsController)) {
      this._unsubscribeFromOptions =
        this.optionsController.onOptionsToggled.add((visible) =>
          this.setPaused(visible),
        );
      this.setPaused(this.optionsController.optionsVisible); // sync with pre-subscribe state
    }

    // Bound here, not in onAwake, so the update loop only runs on valid wiring.
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  private onDestroy(): void {
    this._unsubscribeFromOptions?.();
  }

  moveToPosition(target: vec3): void {
    this._destination = copyOf(target);
    this._hasArrived = false;
  }

  returnHome(): void {
    this.moveToPosition(this._homePosition);
  }

  setHomePosition(position: vec3): void {
    this._homePosition = copyOf(position);
  }

  setPaused(paused: boolean): void {
    this._isPaused = paused;
  }

  private onUpdate(): void {
    if (this._isPaused) {
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
      if (!this._hasArrived) {
        this._hasArrived = true;
        this.onArrivedEvent.invoke(undefined);
      }
      return;
    }

    this._basePosition = this._basePosition.add(
      toDestination.uniformScale(step / distance),
    );
  }
}

const copyOf = (v: vec3): vec3 => new vec3(v.x, v.y, v.z);
