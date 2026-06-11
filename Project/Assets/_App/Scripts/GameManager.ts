/**
 * GameManager -- Level data, game state, step progression, and voice cues
 * for Zapatory Lab / AR Circuit Lab.
 *
 * Pure data + state -- no UI, no input handling.
 * Other scripts subscribe to events and react (UI, TTS, Zappy, BLE, etc.).
 *
 * Voice Cue System (from Sasha's 3-Layer Embedded Contextual Teaching):
 *   CUE      = action + why (primary TTS instruction)
 *   AMBIENT  = during movement, background context
 *   CONFIRM  = after success
 *   RECOVERY = redirect on error
 */
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";

// --- Types ---

export enum GameScreen {
  MainMenu = "MainMenu",
  ModeSelect = "ModeSelect",
  InLevel = "InLevel",
  Completion = "Completion",
  Settings = "Settings",
}

export enum GameMode {
  /** Step-by-step guided tutorial with AR overlay. */
  Learn = "LEARN",
  /** Debug a pre-built circuit -- find what's wrong. */
  FixIt = "FIX IT",
  /** Timed challenge -- build from scratch. */
  Build = "BUILD",
}

export enum GamePhase {
  /** Conceptual intro -- what the component is, why it matters. */
  Orientation = "Orientation",
  /** Hands-on wiring with AR overlay guidance. */
  Placement = "Placement",
  /** Power-on and functional verification. */
  Test = "Test",
}

export interface VoiceCues {
  /** Primary instruction -- action + why. Always played via TTS. */
  cue: string;
  /** Background context during movement (audio only, optional). */
  ambient?: string;
  /** Success confirmation after correct placement. */
  confirm?: string;
  /** Error recovery redirect (played on wrong placement). */
  recovery?: string;
}

export interface StepData {
  instruction: string;
  hint: string;
  phase: GamePhase;
  /** Which component this step uses (LED, RESISTOR, RED WIRE, etc.) */
  component: string;
  /** Grid placement description (e.g. "col 10, row E") */
  placement: string;
  /** 3-layer voice cues from Sasha's voice script */
  voice: VoiceCues;
}

export interface LevelData {
  name: string;
  description: string;
  difficulty: string;
  steps: StepData[];
  /** Components used in this level (for the component tray) */
  components: string[];
}

export interface ScreenChangeData {
  screen: GameScreen;
  previous: GameScreen;
}

export interface StepAdvanceData {
  index: number;
  step: StepData;
  totalSteps: number;
}

export interface StepSubmitData {
  index: number;
  step: StepData;
  passed: boolean;
  skipped: boolean;
}

export interface LevelCompleteData {
  levelIndex: number;
  elapsedSeconds: number;
  stepsSkipped: number;
  totalSteps: number;
  mode: GameMode;
}

// --- Component ---

@component
export class GameManager extends BaseScriptComponent {
  @input
  @hint("Enable debug logging")
  enableLogging: boolean = true;

  // --- Events ---

  private readonly onScreenChangedEvent = new Event<ScreenChangeData>();
  readonly onScreenChanged: PublicApi<ScreenChangeData> =
    this.onScreenChangedEvent.publicApi();

  private readonly onStepAdvancedEvent = new Event<StepAdvanceData>();
  /** Fires when the player moves to a new step within a level. */
  readonly onStepAdvanced: PublicApi<StepAdvanceData> =
    this.onStepAdvancedEvent.publicApi();

  private readonly onStepSubmittedEvent = new Event<StepSubmitData>();
  /** Fires when a step is submitted (passed or failed) or skipped. */
  readonly onStepSubmitted: PublicApi<StepSubmitData> =
    this.onStepSubmittedEvent.publicApi();

  private readonly onLevelCompletedEvent = new Event<LevelCompleteData>();
  readonly onLevelCompleted: PublicApi<LevelCompleteData> =
    this.onLevelCompletedEvent.publicApi();

  private readonly onValidationRequestedEvent = new Event<number>();
  /** Fires when validation is requested for the current step (step index). */
  readonly onValidationRequested: PublicApi<number> =
    this.onValidationRequestedEvent.publicApi();

  private readonly onModeChangedEvent = new Event<GameMode>();
  /** Fires when the game mode changes. */
  readonly onModeChanged: PublicApi<GameMode> =
    this.onModeChangedEvent.publicApi();

  // --- Private State ---

  private screen: GameScreen = GameScreen.MainMenu;
  private mode: GameMode = GameMode.Learn;
  private currentLevelIndex: number = -1;
  private currentStepIndex: number = 0;
  private levelStartTime: number = 0;
  private stepsSkipped: number = 0;
  private stepResults: boolean[] = []; // true = passed, false = skipped

  // --- Level Definitions (matches Sasha's Figma) ---

  private readonly levels: LevelData[] = [
    {
      name: "LED CIRCUIT",
      description: "Build a simple LED circuit on a breadboard",
      difficulty: "Beginner",
      components: ["LED", "RESISTOR", "RED WIRE", "BLK WIRE"],
      steps: [
        {
          instruction: "Orient your breadboard",
          hint: "Red rail = power (+), blue rail = ground (-)",
          phase: GamePhase.Orientation,
          component: "",
          placement: "",
          voice: {
            cue: "This is a breadboard. Every hole in a row is connected underneath -- so you can build circuits without any soldering.",
          },
        },
        {
          instruction: "Grab the LED",
          hint: "Two legs of different lengths",
          phase: GamePhase.Orientation,
          component: "LED",
          placement: "",
          voice: {
            cue: "Grab the LED. The two legs are different lengths -- that difference tells the circuit which direction to push current.",
            ambient: "LEDs are polarized -- they only let electricity through in one direction. The legs are how you know which way to hold it.",
            confirm: "Long leg positive, short leg negative -- that's a universal rule on every LED you'll ever use.",
            recovery: "That's the resistor -- the LED is the one with two legs of different lengths. Try the next one.",
          },
        },
        {
          instruction: "Place the LED on the breadboard",
          hint: "Long leg = anode (positive), row E",
          phase: GamePhase.Placement,
          component: "LED",
          placement: "Long leg col 10, short leg col 11, row E",
          voice: {
            cue: "Long leg in row 10, short leg in row 12. Each row connects every hole in it -- position is everything.",
            ambient: "The LED needs to straddle two separate rows so each leg has its own independent connection.",
            confirm: "Those two legs are in completely separate rows -- we can connect them to different parts of the circuit independently.",
            recovery: "Flip it -- long leg row 10. Spread the legs -- they need separate rows.",
          },
        },
        {
          instruction: "Connect a 220 ohm resistor",
          hint: "Limits current so LED doesn't burn out",
          phase: GamePhase.Placement,
          component: "RESISTOR",
          placement: "Col 7 to col 10, row C",
          voice: {
            cue: "Grab the resistor. Without it, too much current hits the LED at once -- this component protects it.",
            ambient: "See those colored bands? Each one is a number -- they encode the resistance value. It slows current down.",
            confirm: "The resistor doesn't care which way you plug it in. Unlike the LED, it works in both directions.",
            recovery: "That's a wire -- grab the small cylinder with the colored stripes on it.",
          },
        },
        {
          instruction: "Wire the positive rail to the resistor",
          hint: "Red wire from power rail to col 7",
          phase: GamePhase.Placement,
          component: "RED WIRE",
          placement: "Red rail to col 7, row A",
          voice: {
            cue: "Red wire, top rail to row 10. The red rail is your power source -- positive current starts here.",
            ambient: "Those long rails are power rails. Red is always positive, blue or black is always ground -- standard convention everywhere.",
            confirm: "Power connected. Current needs a complete loop to move -- it needs somewhere to return. One more step.",
            recovery: "Use the red rail at top. Connect to row 10 -- that's where the resistor is waiting.",
          },
        },
        {
          instruction: "Wire the LED cathode to ground",
          hint: "Black wire from short leg to ground rail",
          phase: GamePhase.Placement,
          component: "BLK WIRE",
          placement: "Col 11, row A to ground rail",
          voice: {
            cue: "Black wire from column 11 to the ground rail. This completes the circuit loop.",
            confirm: "Ground connected -- the circuit now has a complete path for current to flow.",
          },
        },
        {
          instruction: "Connect power -- LED should light up!",
          hint: "Moment of truth!",
          phase: GamePhase.Test,
          component: "",
          placement: "",
          voice: {
            cue: "You just built a working circuit from scratch. Every electronic device in the world is built on this same principle.",
          },
        },
      ],
    },
    {
      name: "BUTTON + BUZZER",
      description: "Wire up a buzzer with a push-button switch",
      difficulty: "Intermediate",
      components: ["BUTTON", "BUZZER", "RED WIRE", "BLK WIRE"],
      steps: [
        {
          instruction: "Place the buzzer on the breadboard",
          hint: "Note the + marking on the buzzer",
          phase: GamePhase.Placement,
          component: "BUZZER",
          placement: "Col 20 (+), col 21 (-), row C",
          voice: {
            cue: "Place the buzzer. The plus sign tells you which side gets power -- polarity matters here.",
            ambient: "Buzzers are polarized just like LEDs. Wrong direction and nothing happens.",
            confirm: "Buzzer placed -- now we need a way to control when it sounds.",
          },
        },
        {
          instruction: "Place the push button switch",
          hint: "Straddle the center gap, cols 15-17",
          phase: GamePhase.Placement,
          component: "BUTTON",
          placement: "Cols 15-17, rows C and E",
          voice: {
            cue: "Button bridges the center gap. When you press it, the two sides connect and current flows through.",
            confirm: "Button seated -- it bridges the gap between the two halves of the board.",
          },
        },
        {
          instruction: "Wire button to buzzer",
          hint: "Connect button output to buzzer positive",
          phase: GamePhase.Placement,
          component: "RED WIRE",
          placement: "Col 17 to col 20, row D",
          voice: {
            cue: "Wire from the button output to the buzzer. This connects the switch to the sound maker.",
            confirm: "Signal path connected -- press the button and current reaches the buzzer.",
          },
        },
        {
          instruction: "Connect power and ground wires",
          hint: "Red to col 15, black to col 21",
          phase: GamePhase.Placement,
          component: "BLK WIRE",
          placement: "Red col 15 to power, black col 21 to ground",
          voice: {
            cue: "Red wire to power rail at column 15. Black wire from column 21 to ground. Complete the loop.",
            confirm: "Power and ground connected -- the circuit is complete.",
          },
        },
        {
          instruction: "Press the button -- BUZZ!",
          hint: "If no sound, check buzzer polarity",
          phase: GamePhase.Test,
          component: "",
          placement: "",
          voice: {
            cue: "Press the button. If you hear a buzz, you just built an interactive circuit with user input!",
          },
        },
      ],
    },
    {
      name: "MOTION SENSOR",
      description: "Build a motion-activated LED with PIR sensor and 555 timer",
      difficulty: "Advanced",
      components: ["PIR SENSOR", "555 TIMER", "LED", "RESISTOR", "CAPACITOR", "RED WIRE", "BLK WIRE"],
      steps: [
        {
          instruction: "Place the PIR sensor on the breadboard",
          hint: "3 pins: VCC, OUT, GND",
          phase: GamePhase.Placement,
          component: "PIR SENSOR",
          placement: "VCC, OUT, GND pins in separate rows",
          voice: {
            cue: "Power up your PIR sensor. VCC, OUT, GND -- get those pins grounded and ready for some sense-sational action!",
            ambient: "PIR stands for Passive Infrared. It detects heat from moving objects -- like your hand.",
          },
        },
        {
          instruction: "Place the 555 timer IC",
          hint: "Notch faces left, pin 1 bottom-left",
          phase: GamePhase.Placement,
          component: "555 TIMER",
          placement: "Straddle center gap, notch left",
          voice: {
            cue: "The 555 timer is one of the most popular chips ever made. Notch goes left, pin 1 is bottom-left.",
            ambient: "This chip can create pulses, delays, and oscillations. We're using it as a one-shot timer.",
          },
        },
        {
          instruction: "Connect VCC and GND on the 555",
          hint: "Pin 8 to power, Pin 1 to ground",
          phase: GamePhase.Placement,
          component: "RED WIRE",
          placement: "Pin 8 to power rail, Pin 1 to ground rail",
          voice: {
            cue: "Power the 555. Pin 8 gets VCC, pin 1 gets ground. Every IC needs power to think.",
          },
        },
        {
          instruction: "Wire PIR output to 555 trigger",
          hint: "PIR OUT to 555 pin 2",
          phase: GamePhase.Placement,
          component: "RED WIRE",
          placement: "PIR OUT pin to 555 pin 2",
          voice: {
            cue: "Connect the PIR output to the 555 trigger. When motion is detected, the timer starts.",
          },
        },
        {
          instruction: "Add the timing resistor and capacitor",
          hint: "Resistor between pins 6-7 and VCC, capacitor pin 6 to GND",
          phase: GamePhase.Placement,
          component: "RESISTOR",
          placement: "Resistor: pins 6-7 to VCC. Capacitor: pin 6 to GND",
          voice: {
            cue: "Add the timing components. The resistor and capacitor together determine how long the LED stays on after motion.",
            ambient: "RC timing -- the resistor controls charge rate, the capacitor stores energy. Together they set the delay.",
          },
        },
        {
          instruction: "Connect LED to 555 output",
          hint: "Pin 3 to resistor to LED to GND",
          phase: GamePhase.Placement,
          component: "LED",
          placement: "555 pin 3 to 220 ohm resistor to LED to GND",
          voice: {
            cue: "LED connects to the 555 output through a resistor. When the timer fires, the LED lights up.",
          },
        },
        {
          instruction: "Power on -- wave your hand!",
          hint: "Motion triggers the LED",
          phase: GamePhase.Test,
          component: "",
          placement: "",
          voice: {
            cue: "Wave your hand near the PIR sensor. You just built a motion-activated light -- the same tech in hallway lights and security systems.",
          },
        },
      ],
    },
  ];

  // --- Lifecycle ---

  onAwake(): void {
    this.log(
      "GameManager ready -- " + this.levels.length + " levels loaded",
    );
  }

  // --- Public API: State Queries ---

  getScreen(): GameScreen {
    return this.screen;
  }

  getMode(): GameMode {
    return this.mode;
  }

  getLevelCount(): number {
    return this.levels.length;
  }

  getLevelData(idx: number): LevelData {
    return this.levels[idx];
  }

  getAllLevels(): LevelData[] {
    return this.levels;
  }

  getCurrentLevel(): LevelData | null {
    return this.currentLevelIndex >= 0
      ? this.levels[this.currentLevelIndex]
      : null;
  }

  getCurrentStepIndex(): number {
    return this.currentStepIndex;
  }

  getCurrentStep(): StepData | null {
    const lvl = this.getCurrentLevel();
    return lvl ? lvl.steps[this.currentStepIndex] : null;
  }

  getTotalSteps(): number {
    const lvl = this.getCurrentLevel();
    return lvl ? lvl.steps.length : 0;
  }

  getStepsSkipped(): number {
    return this.stepsSkipped;
  }

  getElapsedTime(): number {
    return this.levelStartTime > 0 ? getTime() - this.levelStartTime : 0;
  }

  getElapsedTimeFormatted(): string {
    const elapsed = this.getElapsedTime();
    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60);
    return (
      minutes.toString().padStart(2, "0") +
      ":" +
      seconds.toString().padStart(2, "0")
    );
  }

  /** Get the current step's voice cue text for TTS. */
  getCurrentVoiceCue(): string | null {
    const step = this.getCurrentStep();
    return step ? step.voice.cue : null;
  }

  /** Get recovery voice cue for when user makes a mistake. */
  getCurrentRecoveryCue(): string | null {
    const step = this.getCurrentStep();
    return step && step.voice.recovery ? step.voice.recovery : null;
  }

  /** Get confirmation voice cue for when step is correct. */
  getCurrentConfirmCue(): string | null {
    const step = this.getCurrentStep();
    return step && step.voice.confirm ? step.voice.confirm : null;
  }

  // --- Public API: Actions ---

  setMode(mode: GameMode): void {
    this.mode = mode;
    this.log("Mode set to: " + mode);
    this.onModeChangedEvent.invoke(mode);
  }

  goToScreen(target: GameScreen): void {
    const prev = this.screen;
    this.screen = target;
    this.log("Screen: " + prev + " -> " + target);
    this.onScreenChangedEvent.invoke({ screen: target, previous: prev });
  }

  startLevel(levelIndex: number): void {
    this.currentLevelIndex = levelIndex;
    this.currentStepIndex = 0;
    this.levelStartTime = getTime();
    this.stepsSkipped = 0;
    this.stepResults = [];
    this.goToScreen(GameScreen.InLevel);
    this.emitStep();
    this.log(
      "Level " + levelIndex + " started: " + this.levels[levelIndex].name +
      " (" + this.levels[levelIndex].difficulty + ") mode=" + this.mode,
    );
  }

  /** Submit current step as passed. Advances to next step or completes level. */
  submitStep(): void {
    const step = this.getCurrentStep();
    if (!step) return;

    this.stepResults.push(true);
    this.log("Step " + (this.currentStepIndex + 1) + " PASSED: " + step.instruction);

    this.onStepSubmittedEvent.invoke({
      index: this.currentStepIndex,
      step: step,
      passed: true,
      skipped: false,
    });

    this.moveToNextStep();
  }

  /** Skip current step. Tracks for scoring. */
  skipStep(): void {
    const step = this.getCurrentStep();
    if (!step) return;

    this.stepsSkipped++;
    this.stepResults.push(false);
    this.log("Step " + (this.currentStepIndex + 1) + " SKIPPED: " + step.instruction);

    this.onStepSubmittedEvent.invoke({
      index: this.currentStepIndex,
      step: step,
      passed: false,
      skipped: true,
    });

    this.moveToNextStep();
  }

  /** Advance to the next step. Returns true if there are more steps. */
  advanceStep(): boolean {
    return this.moveToNextStep();
  }

  /** Go back one step. Returns true if successful. */
  goBackStep(): boolean {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.emitStep();
      return true;
    }
    return false;
  }

  /** Request ML/BLE validation for the current step. */
  requestValidation(): void {
    this.log("Validation requested for step " + this.currentStepIndex);
    this.onValidationRequestedEvent.invoke(this.currentStepIndex);
  }

  /** Return to the main menu, resetting level state. */
  returnToMenu(): void {
    this.currentLevelIndex = -1;
    this.currentStepIndex = 0;
    this.levelStartTime = 0;
    this.stepsSkipped = 0;
    this.stepResults = [];
    this.goToScreen(GameScreen.MainMenu);
  }

  // --- Private ---

  private moveToNextStep(): boolean {
    const lvl = this.getCurrentLevel();
    if (!lvl) return false;

    this.currentStepIndex++;
    if (this.currentStepIndex >= lvl.steps.length) {
      // Level complete
      const elapsed = this.getElapsedTime();
      this.log(
        "Level " + this.currentLevelIndex + " COMPLETE in " +
        Math.floor(elapsed) + "s -- skipped " + this.stepsSkipped +
        " of " + lvl.steps.length + " steps",
      );
      this.onLevelCompletedEvent.invoke({
        levelIndex: this.currentLevelIndex,
        elapsedSeconds: elapsed,
        stepsSkipped: this.stepsSkipped,
        totalSteps: lvl.steps.length,
        mode: this.mode,
      });
      this.goToScreen(GameScreen.Completion);
      return false;
    }

    this.emitStep();
    return true;
  }

  private emitStep(): void {
    const step = this.getCurrentStep();
    if (step) {
      this.log(
        "Step " + (this.currentStepIndex + 1) + "/" + this.getTotalSteps() +
        " [" + step.phase + "]: " + step.instruction,
      );
      if (step.component) {
        this.log("  Component: " + step.component + " | Placement: " + step.placement);
      }
      this.onStepAdvancedEvent.invoke({
        index: this.currentStepIndex,
        step,
        totalSteps: this.getTotalSteps(),
      });
    }
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[GameManager] " + message);
    }
  }
}
