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

  /**
   * WRITE — 3-byte command packet: [mode, brightness, flashRate].
   *   [0] mode       0 = solid, 1 = flash (see LedMode)
   *   [1] brightness 0..127  PWM duty while lit
   *   [2] flashRate  0..127  units of 0.1 Hz (0..12.7 Hz); ignored when solid
   * A 1-byte write is still accepted by the firmware as legacy solid brightness.
   */
  export const ledCharacteristicUUID = "0d83c1f0-2026-4a57-a1d0-86e25ce40002";

  /**
   * NOTIFY — 2 bytes: [heartbeat 0..127 (1 Hz, wraps), current LED level 0..127].
   * The board also notifies immediately after every LED write (state echo).
   */
  export const statusCharacteristicUUID =
    "0d83c1f0-2026-4a57-a1d0-86e25ce40003";

  /** Largest value any protocol byte may carry (7-bit-safe ceiling). */
  export const MAX_BYTE = 0x7f; // 127

  /** LED command mode — byte[0] of the LED write packet. */
  export const LedMode = { Solid: 0, Flash: 1 } as const;
  export type LedMode = (typeof LedMode)[keyof typeof LedMode];

  /** Flash-rate range the board supports, in Hz (byte[2] is 0.1 Hz units). */
  export const MIN_FLASH_HZ = 0;
  export const MAX_FLASH_HZ = MAX_BYTE / 10; // 12.7 Hz

  /** Normalized 0..1 brightness → 0..127 protocol byte. */
  export function brightnessToByte(normalized: number): number {
    const clamped = Math.max(0, Math.min(1, normalized));
    return Math.round(clamped * MAX_BYTE);
  }

  /** Flash rate in Hz → 0..127 deci-hertz protocol byte. */
  export function flashHzToByte(hz: number): number {
    const clamped = Math.max(MIN_FLASH_HZ, Math.min(MAX_FLASH_HZ, hz));
    return Math.round(clamped * 10);
  }

  /** Assemble the 3-byte LED command packet from already-encoded bytes. */
  export function buildLedPacket(
    mode: LedMode,
    brightnessByte: number,
    flashRateByte: number,
  ): Uint8Array {
    return new Uint8Array([
      mode,
      brightnessByte & MAX_BYTE,
      flashRateByte & MAX_BYTE,
    ]);
  }
}
