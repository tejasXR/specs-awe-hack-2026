/**
 * Zappy-Board — BLE firmware for the AWE Hack 2026 breadboard ESP32 (WROOM-32).
 *
 * GATT profile (mirror of BreadboardBleData.ts on the lens side):
 *   Device name:     Zappy-Board
 *   Service:         0d83c1f0-2026-4a57-a1d0-86e25ce40001
 *   LED char:        0d83c1f0-2026-4a57-a1d0-86e25ce40002  (WRITE)
 *                      3-byte command packet:
 *                        [0] mode       0 = solid, 1 = flash
 *                        [1] brightness 0..127  (PWM duty when lit)
 *                        [2] flashRate  0..127  (units of 0.1 Hz → 0..12.7 Hz)
 *                      Backward-compatible: a 1-byte write is treated as a
 *                      solid-mode brightness (legacy setLed path).
 *   Status char:     0d83c1f0-2026-4a57-a1d0-86e25ce40003  (NOTIFY)
 *                      2 bytes — [heartbeat 0..127, current LED level 0..127]
 *
 * Flash timing runs locally on the board: the lens writes a target rate once
 * (latest-wins) and the ESP32 toggles the output, so BLE traffic stays low.
 *
 * All payload bytes stay <= 127: Spectacles' BLE write path currently mangles
 * bytes above 0x7F (see BLE Playground HueEventEmitter), so the whole protocol
 * lives in the 7-bit-safe range.
 *
 * Advertising restarts automatically on disconnect.
 * Serial logging at 115200 baud.
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ---- Configuration ---------------------------------------------------------

static const char* DEVICE_NAME = "Zappy-Board";

static const char* SERVICE_UUID    = "0d83c1f0-2026-4a57-a1d0-86e25ce40001";
static const char* LED_CHAR_UUID   = "0d83c1f0-2026-4a57-a1d0-86e25ce40002";
static const char* STATUS_CHAR_UUID = "0d83c1f0-2026-4a57-a1d0-86e25ce40003";

// GPIO32 is the breadboard LED for the AWE Hack 2026 setup.
// Add the onboard LED (GPIO2) here too if you want a visual mirror: {2, 32}.
static const int LED_PINS[] = {32};
static const int LED_PIN_COUNT = sizeof(LED_PINS) / sizeof(LED_PINS[0]);

// ---- State ------------------------------------------------------------------

BLEServer* server = nullptr;
BLECharacteristic* statusChar = nullptr;
volatile bool deviceConnected = false;
uint8_t ledLevel = 0;       // 0..127, current instantaneous output (for status notify)
uint8_t heartbeat = 0;      // 0..127, wraps
unsigned long lastNotifyMs = 0;

// Command state (set from BLE writes; flash timing applied in loop()).
uint8_t targetBrightness = 0;   // 0..127, duty while lit
bool    flashMode = false;
uint8_t flashRateDeciHz = 0;    // 0..127, units of 0.1 Hz (e.g. 25 = 2.5 Hz)
bool    flashLitPhase = true;   // current half-cycle when flashing
unsigned long lastFlashToggleMs = 0;

// ---- Helpers ----------------------------------------------------------------

// Low-level PWM write to every configured LED pin.
void writePwm(uint8_t level) {
  ledLevel = level > 127 ? 127 : level;
  for (int i = 0; i < LED_PIN_COUNT; i++) {
    // Map 0..127 -> 0..254 PWM duty
    analogWrite(LED_PINS[i], ledLevel * 2);
  }
}

// Resolve the command state into an actual output level and drive the pins.
void applyOutput() {
  uint8_t out = targetBrightness;
  if (flashMode && flashRateDeciHz > 0) {
    out = flashLitPhase ? targetBrightness : 0;
  }
  writePwm(out);
}

void notifyStatus() {
  if (!deviceConnected || statusChar == nullptr) return;
  uint8_t payload[2] = {heartbeat, ledLevel};
  statusChar->setValue(payload, sizeof(payload));
  statusChar->notify();
}

// ---- BLE callbacks ----------------------------------------------------------

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    deviceConnected = true;
    Serial.println("[BLE] Central connected");
  }
  void onDisconnect(BLEServer*) override {
    deviceConnected = false;
    Serial.println("[BLE] Central disconnected — advertising again");
    BLEDevice::startAdvertising();
  }
};

class LedWriteCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String value = c->getValue();
    size_t n = value.length();
    if (n < 1) return;

    if (n >= 3) {
      // 3-byte command packet: [mode, brightness, flashRate]
      flashMode = (uint8_t)value[0] == 1;
      targetBrightness = (uint8_t)value[1];
      flashRateDeciHz = (uint8_t)value[2];
    } else {
      // Legacy 1-byte write: solid brightness.
      flashMode = false;
      targetBrightness = (uint8_t)value[0];
    }
    if (targetBrightness > 127) targetBrightness = 127;
    if (flashRateDeciHz > 127) flashRateDeciHz = 127;

    // Start each flash burst on the lit phase so a pinch lights up immediately.
    flashLitPhase = true;
    lastFlashToggleMs = millis();

    Serial.printf("[CMD] flash=%d brightness=%u rate=%u(0.1Hz)\n",
                  flashMode, targetBrightness, flashRateDeciHz);

    applyOutput();
    notifyStatus();  // echo the new state immediately
  }
};

// ---- Arduino lifecycle --------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("=== Zappy-Board BLE firmware ===");

  for (int i = 0; i < LED_PIN_COUNT; i++) {
    pinMode(LED_PINS[i], OUTPUT);
  }
  applyOutput();  // starts off (targetBrightness = 0)

  BLEDevice::init(DEVICE_NAME);
  server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);

  BLECharacteristic* ledChar = service->createCharacteristic(
      LED_CHAR_UUID, BLECharacteristic::PROPERTY_WRITE);
  ledChar->setCallbacks(new LedWriteCallbacks());

  statusChar = service->createCharacteristic(
      STATUS_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  statusChar->addDescriptor(new BLE2902());  // CCCD so centrals can subscribe

  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.printf("[BLE] Advertising as '%s'\n", DEVICE_NAME);
  Serial.printf("[BLE] Service: %s\n", SERVICE_UUID);
  Serial.printf("[BLE] Address: %s\n", BLEDevice::getAddress().toString().c_str());
}

void loop() {
  unsigned long now = millis();

  // Local flash timing: toggle the lit/dark half-cycle at the requested rate.
  if (flashMode && flashRateDeciHz > 0) {
    float hz = flashRateDeciHz / 10.0f;
    unsigned long halfPeriodMs = (unsigned long)(500.0f / hz);  // half a full cycle
    if (now - lastFlashToggleMs >= halfPeriodMs) {
      lastFlashToggleMs = now;
      flashLitPhase = !flashLitPhase;
      applyOutput();
    }
  }

  // 1 Hz heartbeat notify so the lens side always has a live signal to test.
  if (now - lastNotifyMs >= 1000) {
    lastNotifyMs = now;
    heartbeat = (heartbeat + 1) & 0x7F;
    notifyStatus();
  }

  delay(5);
}
