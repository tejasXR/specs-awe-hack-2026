import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { BreadboardBleData } from "./BreadboardBleData";

export type BreadboardConnectionState =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "failed"; reason: string };

export interface BreadboardStatus {
  /** 1 Hz counter from the board, 0..127, wraps. Proof of a live link. */
  heartbeat: number;
  /** Current LED level on the board, 0..127. */
  ledLevel: number;
}

/**
 * A full LED command in human units. The controller encodes it into the
 * 3-byte wire packet (see BreadboardBleData) at the write boundary.
 */
export interface LedCommand {
  mode: BreadboardBleData.LedMode;
  /** 0..1 — PWM duty while lit. */
  brightness: number;
  /** Flash rate in Hz; ignored when mode = Solid. */
  flashHz: number;
}

/**
 * Owns the BLE link to the Zappy-Board ESP32 (firmware/zappy-board).
 * Scan → connect → subscribe to status notifications; exposes typed events
 * and a throttled LED write (HueEventEmitter pattern: one write in flight,
 * latest value wins).
 *
 * BLE is device-only — in the editor (or with simulateInEditor) this fakes a
 * connection and a 1 Hz heartbeat so dependent UI can be built without hardware.
 */
@component
export class BreadboardBleController extends BaseScriptComponent {
  @input
  @hint("BluetoothCentralModule asset from the project's Modules folder")
  bluetoothModule!: Bluetooth.BluetoothCentralModule;

  @input
  @hint("Start scanning for the board as soon as the lens starts")
  autoConnectOnStart: boolean = true;

  @input
  @hint("Seconds to scan before giving up")
  scanTimeoutSeconds: number = 15;

  @input
  @hint("Fake the connection + heartbeat in the editor / without hardware")
  simulateInEditor: boolean = true;

  private _state: BreadboardConnectionState = { kind: "idle" };

  private readonly onStateChangedEvent = new Event<BreadboardConnectionState>();
  readonly onStateChanged: PublicApi<BreadboardConnectionState> =
    this.onStateChangedEvent.publicApi();

  private readonly onStatusEvent = new Event<BreadboardStatus>();
  /** Fires on every status notification from the board (~1 Hz + LED echoes). */
  readonly onStatus: PublicApi<BreadboardStatus> =
    this.onStatusEvent.publicApi();

  private _gatt?: Bluetooth.BluetoothGatt;
  private _ledCharacteristic?: Bluetooth.BluetoothGattCharacteristic;

  // Throttle state: one BLE write in flight; latest requested command wins.
  private _isWriteInFlight: boolean = false;
  private _pendingCommand?: LedCommand;

  // Editor simulation
  private _simulatedHeartbeat: number = 0;
  private _simulatedLedLevel: number = 0;

  get state(): BreadboardConnectionState {
    return this._state;
  }

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    if (this.autoConnectOnStart) {
      this.connect();
    }
  }

  /** Scan for the board by advertised name and connect. Safe to call again after "failed". */
  connect(): void {
    if (this._state.kind !== "idle" && this._state.kind !== "failed") {
      return;
    }

    if (this.isSimulated()) {
      this.setState({ kind: "connected" });
      this.startSimulatedHeartbeat();
      return;
    }

    if (isNull(this.bluetoothModule)) {
      this.log("'bluetoothModule' input is not wired — cannot connect.");
      this.setState({ kind: "failed", reason: "bluetoothModule not wired" });
      return;
    }

    this.setState({ kind: "scanning" });

    const filter = new Bluetooth.ScanFilter();
    filter.deviceName = BreadboardBleData.deviceName;

    const settings = new Bluetooth.ScanSettings();
    settings.uniqueDevices = true;
    settings.timeoutSeconds = this.scanTimeoutSeconds;

    this.bluetoothModule
      // Resolves when the predicate returns true; timeout lands in catch.
      .startScan(
        [filter],
        settings,
        (result) => result.deviceName === BreadboardBleData.deviceName,
      )
      .then((result) => this.onBoardFound(result))
      .catch((error) => {
        this.setState({ kind: "failed", reason: "scan: " + error });
      });
  }

  disconnect(): void {
    this._gatt?.disconnect();
    this._gatt = undefined;
    this._ledCharacteristic = undefined;
    this._isWriteInFlight = false;
    this._pendingCommand = undefined;
    this.setState({ kind: "idle" });
  }

  /**
   * Set a solid LED brightness, 0..1 (0 = off). Thin wrapper over setCommand
   * kept for the legacy/simple call site.
   */
  setLed(normalizedLevel: number): void {
    this.setCommand({
      mode: BreadboardBleData.LedMode.Solid,
      brightness: normalizedLevel,
      flashHz: 0,
    });
  }

  /**
   * Send a full LED command (mode + brightness + flash rate). Call as often as
   * you like (e.g. from a per-frame gesture) — writes are throttled to one in
   * flight and the latest command wins once the in-flight write lands.
   */
  setCommand(command: LedCommand): void {
    if (this.isSimulated()) {
      this._simulatedLedLevel = BreadboardBleData.brightnessToByte(
        command.brightness,
      );
      return;
    }
    if (isNull(this._ledCharacteristic)) {
      return; // not connected yet — drop, don't queue stale commands
    }

    if (this._isWriteInFlight) {
      this._pendingCommand = command; // latest wins once the in-flight write lands
    } else {
      this._isWriteInFlight = true;
      this.writeCommand(command);
    }
  }

  private writeCommand(command: LedCommand): void {
    const packet = BreadboardBleData.buildLedPacket(
      command.mode,
      BreadboardBleData.brightnessToByte(command.brightness),
      BreadboardBleData.flashHzToByte(command.flashHz),
    );

    this._ledCharacteristic!.writeValue(packet)
      .then(() => {
        if (this._pendingCommand !== undefined) {
          const next = this._pendingCommand;
          this._pendingCommand = undefined;
          this.writeCommand(next);
        } else {
          this._isWriteInFlight = false;
        }
      })
      .catch((error) => {
        this._isWriteInFlight = false;
        this._pendingCommand = undefined;
        this.log("LED write failed: " + error);
      });
  }

  private onBoardFound(result: Bluetooth.ScanResult): void {
    this.setState({ kind: "connecting" });

    this.bluetoothModule
      .connectGatt(result.deviceAddress)
      .then((gatt) => {
        this._gatt = gatt as Bluetooth.BluetoothGatt;
        this._gatt.onConnectionStateChangedEvent.add((e) =>
          this.onConnectionStateChanged(e),
        );
        this.subscribeToBoard();
      })
      .catch((error) => {
        this.setState({ kind: "failed", reason: "connect: " + error });
      });
  }

  private subscribeToBoard(): void {
    try {
      const service = this._gatt!.getService(BreadboardBleData.serviceUUID);

      this._ledCharacteristic = service.getCharacteristic(
        BreadboardBleData.ledCharacteristicUUID,
      );

      const statusCharacteristic = service.getCharacteristic(
        BreadboardBleData.statusCharacteristicUUID,
      );
      statusCharacteristic
        .registerNotifications((value) => this.onStatusNotification(value))
        .catch((error) => this.log("registerNotifications failed: " + error));

      this.setState({ kind: "connected" });
    } catch (error) {
      this.setState({ kind: "failed", reason: "gatt setup: " + error });
    }
  }

  private onStatusNotification(value: Uint8Array): void {
    if (isNull(value) || value.length < 2) {
      return;
    }
    this.onStatusEvent.invoke({ heartbeat: value[0], ledLevel: value[1] });
  }

  private onConnectionStateChanged(
    e: Bluetooth.ConnectionStateChangedEvent,
  ): void {
    // 0 = disconnected, 1 = connected (see BLE Playground ScanResult.ts)
    if (e.state.toString() === "0") {
      this._ledCharacteristic = undefined;
      this.setState({ kind: "failed", reason: "link dropped" });
    }
  }

  // ---- Editor simulation ----------------------------------------------------

  private isSimulated(): boolean {
    return this.simulateInEditor && global.deviceInfoSystem.isEditor();
  }

  private startSimulatedHeartbeat(): void {
    const tick = () => {
      if (this._state.kind !== "connected") {
        return;
      }
      this._simulatedHeartbeat = (this._simulatedHeartbeat + 1) & 0x7f;
      this.onStatusEvent.invoke({
        heartbeat: this._simulatedHeartbeat,
        ledLevel: this._simulatedLedLevel,
      });
      const delay = this.createEvent("DelayedCallbackEvent");
      delay.bind(() => {
        this.removeEvent(delay);
        tick();
      });
      delay.reset(1);
    };
    tick();
  }

  private setState(next: BreadboardConnectionState): void {
    this._state = next;
    this.log(
      "state → " +
        next.kind +
        (next.kind === "failed" ? " (" + next.reason + ")" : ""),
    );
    this.onStateChangedEvent.invoke(next);
  }

  private log(message: string): void {
    print("[" + BreadboardBleController.name + "] " + message);
  }
}
