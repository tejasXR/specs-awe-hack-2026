/**
 * CheckWorkBridge — Connects a PinchButtonCapsule to the CheckWorkController.
 */
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { CheckWorkController } from "../CheckWorkController";

@component
export class CheckWorkBridge extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("The Interactable on the Check Work button")
  interactable!: Interactable;

  @input
  @allowUndefined
  @hint("The CheckWorkController component")
  checkWork!: CheckWorkController;

  onAwake(): void {
    print("[CheckWorkBridge] onAwake");
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    if (isNull(this.interactable)) {
      print("[CheckWorkBridge] ⚠ interactable not assigned yet — skipping");
      return;
    }
    if (isNull(this.checkWork)) {
      print("[CheckWorkBridge] ⚠ checkWork not assigned yet — skipping");
      return;
    }

    this.interactable.onTriggerEnd.add(() => {
      print("[CheckWorkBridge] 🎯 Check Work pinched!");
      this.checkWork.captureAndCheck();
    });

    print("[CheckWorkBridge] ✅ Ready — pinch to check work");
  }
}
