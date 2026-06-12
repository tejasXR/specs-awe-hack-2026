/**
 * GATT profile of the Zappy-Board breadboard ESP32.
 * Mirror of firmware/zappy-board/zappy-board.ino — keep the two in sync.
 *
 * Protocol note: all payload bytes stay in 0..127. Spectacles' BLE write path
 * currently mangles bytes above 0x7F (see BLE Playground HueEventEmitter), so
 * the whole protocol lives in the 7-bit-safe range.
 */
export namespace BreadboardBleData {
  /** Exact advertised name — ScanFilter.deviceName matching is case-sensitive. */
  export const deviceName = "Zappy-Board";

  export const serviceUUID = "0d83c1f0-2026-4a57-a1d0-86e25ce40001";

  /** WRITE — 1 byte: 0 = off, 1..127 = LED brightness (PWM). */
  export const ledCharacteristicUUID = "0d83c1f0-2026-4a57-a1d0-86e25ce40002";

  /**
   * NOTIFY — 2 bytes: [heartbeat 0..127 (1 Hz, wraps), current LED level 0..127].
   * The board also notifies immediately after every LED write (state echo).
   */
  export const statusCharacteristicUUID =
    "0d83c1f0-2026-4a57-a1d0-86e25ce40003";
}
