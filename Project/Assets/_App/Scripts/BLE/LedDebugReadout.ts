import {
  BreadboardBleController,
  BreadboardConnectionState,
  BreadboardStatus,
  LedCommand,
} from "./BreadboardBleController";
import { BreadboardBleData } from "./BreadboardBleData";
import { LedGestureController } from "./LedGestureController";

/**
 * On-screen debug readout for the breadboard LED link. Subscribes to the BLE
 * controller (connection state + board status echo) and, optionally, the
 * gesture controller (the command we're sending), and renders both into a Text.
 *
 * Pure display: it owns no state of its own beyond the latest values it draws.
 */
@component
export class LedDebugReadout extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">LedDebugReadout</span><br/><span style="color: #94A3B8; font-size: 11px;">Renders BLE link + LED command state to a Text for on-device debugging.</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("Text component the readout is written to")
  text!: Text;

  @input
  @hint("The BLE link — provides connection state and board status")
  bleController!: BreadboardBleController;

  @input
  @allowUndefined
  @hint("Optional — shows the live command (mode / brightness / Hz) being sent")
  gestureController: LedGestureController | undefined;

  private state: BreadboardConnectionState = { kind: "idle" };
  private status: BreadboardStatus | undefined;
  private command: LedCommand | undefined;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    if (isNull(this.text)) {
      print("[LedDebugReadout] 'text' input is not wired.");
      return;
    }

    if (!isNull(this.bleController)) {
      this.state = this.bleController.state;
      this.bleController.onStateChanged.add((s) => {
        this.state = s;
        this.render();
      });
      this.bleController.onStatus.add((st) => {
        this.status = st;
        this.render();
      });
    }

    if (this.gestureController) {
      this.gestureController.onCommandChanged.add((c) => {
        this.command = c;
        this.render();
      });
    }

    this.render();
  }

  private render(): void {
    const lines: string[] = ["Zappy-Board", "Link: " + this.describeState()];

    if (this.status !== undefined) {
      lines.push(
        "HB " +
          this.status.heartbeat +
          "   board LED " +
          this.pct(this.status.ledLevel / BreadboardBleData.MAX_BYTE),
      );
    }

    if (this.command !== undefined) {
      const isFlash = this.command.mode === BreadboardBleData.LedMode.Flash;
      let line = "Mode " + (isFlash ? "FLASH" : "SOLID") + "   Bri " + this.pct(this.command.brightness);
      if (isFlash) {
        line += "   " + this.command.flashHz.toFixed(1) + " Hz";
      }
      lines.push(line);
    }

    this.text.text = lines.join("\n");
  }

  private describeState(): string {
    if (this.state.kind === "failed") {
      return "failed (" + this.state.reason + ")";
    }
    return this.state.kind;
  }

  private pct(normalized: number): string {
    return Math.round(normalized * 100) + "%";
  }
}
