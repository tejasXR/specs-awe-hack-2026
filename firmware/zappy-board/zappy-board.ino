/**
 * Zappy-Board — BLE firmware for the AWE Hack 2026 breadboard ESP32 (WROOM-32).
 *
 * GATT profile (mirror of BreadboardControllerData.ts on the lens side):
 *   Device name:     Zappy-Board
 *   Service:         0d83c1f0-2026-4a57-a1d0-86e25ce40001
 *   LED char:        0d83c1f0-2026-4a57-a1d0-86e25ce40002  (WRITE)
 *                      1 byte — 0 = off, 1..127 = brightness (PWM)
 *   Status char:     0d83c1f0-2026-4a57-a1d0-86e25ce40003  (NOTIFY)
 *                      2 bytes — [heartbeat 0..127, current LED level 0..127]
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

// GPIO2 is the onboard blue LED on most WROOM-32 dev boards.
// Add/replace with the GPIO your breadboard LED is wired to (e.g. {2, 5}).
static const int LED_PINS[] = {2, 5};
static const int LED_PIN_COUNT = sizeof(LED_PINS) / sizeof(LED_PINS[0]);

// ---- State ------------------------------------------------------------------

BLEServer* server = nullptr;
BLECharacteristic* statusChar = nullptr;
volatile bool deviceConnected = false;
uint8_t ledLevel = 0;       // 0..127
uint8_t heartbeat = 0;      // 0..127, wraps
unsigned long lastNotifyMs = 0;

// ---- Helpers ----------------------------------------------------------------

void applyLedLevel(uint8_t level) {
  ledLevel = level > 127 ? 127 : level;
  for (int i = 0; i < LED_PIN_COUNT; i++) {
    // Map 0..127 -> 0..254 PWM duty
    analogWrite(LED_PINS[i], ledLevel * 2);
  }
  Serial.printf("[LED] level=%u\n", ledLevel);
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
    if (value.length() < 1) return;
    applyLedLevel((uint8_t)value[0]);
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
  applyLedLevel(0);

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
  // 1 Hz heartbeat notify so the lens side always has a live signal to test.
  unsigned long now = millis();
  if (now - lastNotifyMs >= 1000) {
    lastNotifyMs = now;
    heartbeat = (heartbeat + 1) & 0x7F;
    notifyStatus();
  }
  delay(10);
}
