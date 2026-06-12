import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";
import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import type TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand";
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { SpaceSetup } from "./SpaceSetup";

type HoldState =
  | { phase: "idle" }
  | { phase: "holding"; anchor: vec3; elapsed: number }
  | { phase: "completed" };

@component
export class ExperienceInitialization extends BaseScriptComponent {
  @input
  pointingConeAngle: number = 25;

  @input
  debugText!: Text;

  @input
  spaceSetup!: SpaceSetup;

  private _stillnessRadius: number = 2.0;
  private _holdDuration: number = 0.5;
  private _holdCompleteDuration: number = 1.5;

  private hand!: TrackedHand;
  private state: HoldState = { phase: "idle" };

  private onHoldStartEvent = new Event<vec3>();
  readonly onHoldStart: PublicApi<vec3> = this.onHoldStartEvent.publicApi();
  private onHoldEndEvent = new Event<void>();
  readonly onHoldEnd: PublicApi<void> = this.onHoldEndEvent.publicApi();

  private _initializationComplete: boolean = false;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());

    // TEJAS: Won't work in LS editor...
    this.hand = HandInputData.getInstance().getDominantHand();
  }

  onStart() {
    print("Scene setup deactivaed");
    this.spaceSetup.enabled = false;
  }

  private onUpdate() {
    if (this._initializationComplete) return;

    if (!this.hand.isTracked()) {
      this.debugText.text = "Hand is not tracked!";
      this.state = { phase: "idle" };
      return;
    }

    const tip = this.hand.indexTip.position;

    if (!this.isPointingDown(tip, this.hand.indexKnuckle.position)) {
      this.state = { phase: "idle" };
      return;
    }

    switch (this.state.phase) {
      case "idle":
        this.state = { phase: "holding", anchor: tip, elapsed: 0 };
        break;

      case "holding": {
        if (!this.isStill(tip, this.state.anchor)) {
          this.state = { phase: "idle" }; // moved → cancel, no onHoldEnd
          break;
        }
        const prev = this.state.elapsed;
        const elapsed = prev + getDeltaTime();

        // Fire onHoldStart on the single frame the engage threshold is crossed.
        if (prev < this._holdDuration && elapsed >= this._holdDuration) {
          this.onHoldStartEvent.invoke(this.state.anchor);
        }

        if (elapsed >= this._holdCompleteDuration) {
          this.state = { phase: "completed" };
          this.onHoldEndEvent.invoke();
        } else {
          this.state = { phase: "holding", anchor: this.state.anchor, elapsed };
        }
        break;
      }

      case "completed":
        this.onHoldComplete();
        break;
    }
  }

  private isPointingDown(tip: vec3, knuckle: vec3): boolean {
    const direction = tip.sub(knuckle).normalize();
    const down = vec3.up().uniformScale(-1);

    // dot ≥ cos(coneAngle) ⇒ within the allowed cone of straight-down.
    const pointingDown =
      direction.dot(down) >=
      Math.cos(this.pointingConeAngle * MathUtils.DegToRad);

    this.debugText.text = "Pointing down: " + pointingDown;

    return pointingDown;
  }

  private isStill(tip: vec3, anchor: vec3): boolean {
    return tip.distance(anchor) <= this._stillnessRadius;
  }

  private onHoldComplete() {
    var setupPosition = this.hand.indexFinger[4].position;

    this.spaceSetup.setup(setupPosition);

    var transform = this.getTransform();
    var camera = WorldCameraFinderProvider.getInstance();
    var toCamera = camera
      .getWorldPosition()
      .sub(transform.getWorldPosition())
      .normalize();

    toCamera.y = 0;

    transform.setWorldRotation(quat.lookAt(toCamera.normalize(), vec3.up()));

    this._initializationComplete = true;
  }
}
