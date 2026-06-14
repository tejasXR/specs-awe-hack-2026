import { unsubscribe } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { OnboardingController } from "./OnboardingController";
import { SpaceSetup } from "./SpaceSetup";
import { ZappyAI } from "./Zappy/ZappyAI";
import { InstructionalLine } from "./InstructionalLine";

// Using 0-based step index
const STEP_SHOW_SPACE_SETUP = 1;
const STEP_SHOW_ZAPPY = 2;

@component
export class OnboardingResponder extends BaseScriptComponent {
  @input
  onboardingController!: OnboardingController;

  @input
  @hint("Line prefab instantiated at runtime to point at the breadboard")
  linePrefab!: ObjectPrefab;

  @input
  @allowUndefined
  @hint("Optional parent for the instantiated line (defaults to this object)")
  linePrefabParent: SceneObject | undefined;

  @input
  @hint("World anchor the onboarding callout line starts from")
  lineStartAnchor!: SceneObject;

  @input
  spaceSetup!: SpaceSetup;

  @input
  zappy!: ZappyAI;

  @input
  @hint("World transform Zappy travels to when its step is reached")
  zappySetupAnchor!: SceneObject;

  private _unsubscribers: unsubscribe[] = [];

  // Callout line instantiated from the prefab on first use and owned here.
  private _line: InstructionalLine | undefined;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    this._unsubscribers.push(
      this.onboardingController.onStepChanged.add((step) =>
        this.handleStepChanged(step),
      ),
    );
  }

  private onDestroy(): void {
    this._unsubscribers.forEach((unsub) => unsub());
    this._unsubscribers = [];
  }

  private handleStepChanged(step: number): void {
    switch (step) {
      case STEP_SHOW_SPACE_SETUP:
        const breadboardLineAnchor =
          this.spaceSetup.getDividerLineAnchor("breadboard");

        if (breadboardLineAnchor) {
          this.showBreadboardCallout(breadboardLineAnchor);
        }

        this.zappy.hide();
        this.spaceSetup.show();
        break;
      case STEP_SHOW_ZAPPY:
        this._line?.hide();
        this.spaceSetup.hide();
        this.zappy.show();
        this.zappy.moveTo(
          this.zappySetupAnchor.getTransform().getWorldPosition(),
        );
        break;
    }
  }

  /**
   * Point the onboarding callout at the breadboard divider. The line's end
   * marker is reparented under the space-setup object at the divider's local
   * anchor, so it tracks that object for free as the user positions it.
   */
  private showBreadboardCallout(linAnchorObj: SceneObject): void {
    const line = this.ensureLine();

    line.attachEnd(linAnchorObj);
    line.show();
    line.setRedrawOnUpdate(true);
  }

  /**
   * Instantiate the callout line from the prefab on first use and cache it.
   * Parented under linePrefabParent when set, otherwise this object.
   */
  private ensureLine(): InstructionalLine {
    if (this._line) {
      return this._line;
    }

    const parent = this.linePrefabParent ?? this.getSceneObject();
    const lineObject = this.linePrefab.instantiate(parent);
    const line = lineObject.getComponent(
      InstructionalLine.getTypeName(),
    ) as unknown as InstructionalLine;
    if (isNull(line)) {
      throw new Error(
        "OnboardingResponder: linePrefab is missing an InstructionalLine component",
      );
    }

    line.hide();
    line.attachStart(this.lineStartAnchor);
    this._line = line;
    return this._line;
  }
}
