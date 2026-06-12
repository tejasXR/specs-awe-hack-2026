/**
 * ComponentIdentifier — data type for a detected electronic component.
 *
 * Shared by the detector (ComponentDetector) and the overlay renderer
 * (ComponentOverlay). Lives in its own file so both systems import the
 * type without creating a dependency between each other.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface DetectedComponent {
  /** Machine-readable class name (e.g. "resistor", "led_red"). */
  classId: string;
  /** Human-friendly display label (e.g. "220Ω Resistor"). */
  label: string;
  /** Brief educational description for the overlay. */
  description: string;
  /** Confidence score from the detector, 0.0–1.0. */
  confidence: number;
  /**
   * Approximate position in normalized image space (0–1 from top-left).
   * Used to project the overlay into world space relative to the camera.
   */
  imagePosX: number;
  imagePosY: number;
}

/** Well-known electronic component classes for breadboard projects. */
export enum ComponentClass {
  Resistor = "resistor",
  LedRed = "led_red",
  LedGreen = "led_green",
  LedBlue = "led_blue",
  LedYellow = "led_yellow",
  Buzzer = "buzzer",
  Capacitor = "capacitor",
  Button = "button",
  JumperWire = "jumper_wire",
  Potentiometer = "potentiometer",
  Battery = "battery",
  Unknown = "unknown",
}

/** Human-readable info for each known component class. */
export const COMPONENT_INFO: Record<
  string,
  { label: string; description: string }
> = {
  [ComponentClass.Resistor]: {
    label: "Resistor",
    description: "Limits current flow — color bands show the value in ohms.",
  },
  [ComponentClass.LedRed]: {
    label: "Red LED",
    description: "Light-Emitting Diode — long leg is positive (anode).",
  },
  [ComponentClass.LedGreen]: {
    label: "Green LED",
    description: "Light-Emitting Diode — needs a resistor to limit current.",
  },
  [ComponentClass.LedBlue]: {
    label: "Blue LED",
    description:
      "Light-Emitting Diode — higher forward voltage than red/green.",
  },
  [ComponentClass.LedYellow]: {
    label: "Yellow LED",
    description: "Light-Emitting Diode — similar specs to a red LED.",
  },
  [ComponentClass.Buzzer]: {
    label: "Buzzer",
    description: "Piezo buzzer — makes sound when current flows through it.",
  },
  [ComponentClass.Capacitor]: {
    label: "Capacitor",
    description: "Stores and releases electrical charge — watch polarity!",
  },
  [ComponentClass.Button]: {
    label: "Push Button",
    description: "Momentary switch — connects the circuit when pressed.",
  },
  [ComponentClass.JumperWire]: {
    label: "Jumper Wire",
    description: "Connects two points on the breadboard.",
  },
  [ComponentClass.Potentiometer]: {
    label: "Potentiometer",
    description: "Variable resistor — turn the knob to change resistance.",
  },
  [ComponentClass.Battery]: {
    label: "Battery",
    description: "Power source — red wire is positive, black is negative.",
  },
  [ComponentClass.Unknown]: {
    label: "Component",
    description: "Electronic component detected.",
  },
};
