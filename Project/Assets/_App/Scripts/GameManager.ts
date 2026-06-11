/**
 * GameManager — Level data, game state, and step progression for Zapatory Lab.
 *
 * Pure data + state — no UI, no input handling.
 * Other scripts subscribe to events and react (UI, Zappy, BLE validation, etc.).
 *
 * Adapted from Danny-Dev branch to use Tejas's Event/PublicApi pattern.
 */
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";

// ─── Types ──────────────────────────────────────────────────────

export enum GameScreen {
  MainMenu = "MainMenu",
  LevelSelect = "LevelSelect",
  InLevel = "InLevel",
  Completion = "Completion",
  Settings = "Settings",
  Tools = "Tools",
}

export enum GamePhase {
  /** Conceptual intro — what the component is, why it matters. */
  Tutorial = "Tutorial",
  /** Hands-on wiring with AR overlay guidance. */
  GuidedSetup = "GuidedSetup",
  /** Power-on and functional verification. */
  FunctionalTest = "FunctionalTest",
}

export interface StepData {
  instruction: string;
  hint: string;
  phase: GamePhase;
}

export interface LevelData {
  name: string;
  description: string;
  steps: StepData[];
}

export interface ScreenChangeData {
  screen: GameScreen;
  previous: GameScreen;
}

export interface StepAdvanceData {
  index: number;
  step: StepData;
}

export interface LevelCompleteData {
  levelIndex: number;
  elapsedSeconds: number;
}

// ─── Component ──────────────────────────────────────────────────

@component
export class GameManager extends BaseScriptComponent {
  @input
  @hint("Enable debug logging")
  enableLogging: boolean = true;

  // ─── Events ───────────────────────────────────────────────────

  private readonly onScreenChangedEvent = new Event<ScreenChangeData>();
  /** Fires when the game screen changes (menu → level, level → completion, etc.). */
  readonly onScreenChanged: PublicApi<ScreenChangeData> =
    this.onScreenChangedEvent.publicApi();

  private readonly onStepAdvancedEvent = new Event<StepAdvanceData>();
  /** Fires when the player moves to a new step within a level. */
  readonly onStepAdvanced: PublicApi<StepAdvanceData> =
    this.onStepAdvancedEvent.publicApi();

  private readonly onLevelCompletedEvent = new Event<LevelCompleteData>();
  /** Fires when all steps of a level are finished. */
  readonly onLevelCompleted: PublicApi<LevelCompleteData> =
    this.onLevelCompletedEvent.publicApi();

  private readonly onValidationRequestedEvent = new Event<number>();
  /** Fires when validation is requested for the current step (step index). */
  readonly onValidationRequested: PublicApi<number> =
    this.onValidationRequestedEvent.publicApi();

  // ─── Private State ────────────────────────────────────────────

  private screen: GameScreen = GameScreen.MainMenu;
  private currentLevelIndex: number = -1;
  private currentStepIndex: number = 0;
  private levelStartTime: number = 0;

  // ─── Level Definitions ────────────────────────────────────────

  private readonly levels: LevelData[] = [
    {
      name: "LED CIRCUIT",
      description: "Build a simple LED circuit on a breadboard",
      steps: [
        {
          instruction: "Place the LED on the breadboard",
          hint: "Long leg = anode (positive)",
          phase: GamePhase.Tutorial,
        },
        {
          instruction: "Connect a 220Ω resistor",
          hint: "Limits current so LED doesn't burn out",
          phase: GamePhase.Tutorial,
        },
        {
          instruction: "Wire the positive rail to the resistor",
          hint: "Red wire to red rail",
          phase: GamePhase.GuidedSetup,
        },
        {
          instruction: "Wire the LED cathode to ground",
          hint: "Short leg to blue/black rail",
          phase: GamePhase.GuidedSetup,
        },
        {
          instruction: "Connect power — LED should light up!",
          hint: "Moment of truth!",
          phase: GamePhase.FunctionalTest,
        },
      ],
    },
    {
      name: "BUZZER CIRCUIT",
      description: "Wire up a buzzer with a push-button switch",
      steps: [
        {
          instruction: "Place the buzzer on the breadboard",
          hint: "Note the + marking",
          phase: GamePhase.Tutorial,
        },
        {
          instruction: "Place the push button switch",
          hint: "Straddle the center gap",
          phase: GamePhase.Tutorial,
        },
        {
          instruction: "Connect buzzer positive to power rail",
          hint: "Red wire from + pin",
          phase: GamePhase.GuidedSetup,
        },
        {
          instruction: "Wire buzzer negative to the switch",
          hint: "Completing the circuit path",
          phase: GamePhase.GuidedSetup,
        },
        {
          instruction: "Wire switch output to ground",
          hint: "Closes the loop",
          phase: GamePhase.GuidedSetup,
        },
        {
          instruction: "Connect the power source",
          hint: "Battery pack or USB",
          phase: GamePhase.GuidedSetup,
        },
        {
          instruction: "Press the button — buzzer should sound!",
          hint: "If no sound, check polarity",
          phase: GamePhase.FunctionalTest,
        },
      ],
    },
    {
      name: "MOTION SENSOR",
      description:
        "Build a motion-activated LED with PIR sensor and 555 timer",
      steps: [
        {
          instruction: "Place the PIR sensor on the breadboard",
          hint: "3 pins: VCC, OUT, GND",
          phase: GamePhase.Tutorial,
        },
        {
          instruction: "Place the 555 timer IC",
          hint: "Notch faces left, pin 1 bottom-left",
          phase: GamePhase.Tutorial,
        },
        {
          instruction: "Connect VCC pin to power",
          hint: "Pin 8 on the 555",
          phase: GamePhase.GuidedSetup,
        },
        {
          instruction: "Connect GND pin to ground",
          hint: "Pin 1 on the 555",
          phase: GamePhase.GuidedSetup,
        },
        {
          instruction: "Wire PIR output to 555 trigger",
          hint: "PIR OUT → 555 pin 2",
          phase: GamePhase.GuidedSetup,
        },
        {
          instruction: "Add the timing resistor",
          hint: "Between pins 6-7 and VCC",
          phase: GamePhase.GuidedSetup,
        },
        {
          instruction: "Add the timing capacitor",
          hint: "Between pin 6 and ground",
          phase: GamePhase.GuidedSetup,
        },
        {
          instruction: "Connect LED to 555 output",
          hint: "Pin 3 → resistor → LED → GND",
          phase: GamePhase.GuidedSetup,
        },
        {
          instruction: "Power on — motion triggers the LED!",
          hint: "Wave your hand near the PIR",
          phase: GamePhase.FunctionalTest,
        },
      ],
    },
  ];

  // ─── Lifecycle ────────────────────────────────────────────────

  onAwake(): void {
    this.log(
      "GameManager ready — " + this.levels.length + " levels loaded",
    );
  }

  // ─── Public API — State Queries ───────────────────────────────

  getScreen(): GameScreen {
    return this.screen;
  }

  getLevelCount(): number {
    return this.levels.length;
  }

  getLevelData(idx: number): LevelData {
    return this.levels[idx];
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

  // ─── Public API — Actions ─────────────────────────────────────

  goToScreen(target: GameScreen): void {
    const prev = this.screen;
    this.screen = target;
    this.log("Screen: " + prev + " → " + target);
    this.onScreenChangedEvent.invoke({ screen: target, previous: prev });
  }

  startLevel(levelIndex: number): void {
    this.currentLevelIndex = levelIndex;
    this.currentStepIndex = 0;
    this.levelStartTime = getTime();
    this.goToScreen(GameScreen.InLevel);
    this.emitStep();
    this.log(
      "Level " +
        levelIndex +
        " started: " +
        this.levels[levelIndex].name,
    );
  }

  /** Advance to the next step. Returns true if there are more steps, false if level complete. */
  advanceStep(): boolean {
    const lvl = this.getCurrentLevel();
    if (!lvl) return false;

    this.currentStepIndex++;
    if (this.currentStepIndex >= lvl.steps.length) {
      // Level complete
      const elapsed = this.getElapsedTime();
      this.log(
        "Level " +
          this.currentLevelIndex +
          " COMPLETE in " +
          Math.floor(elapsed) +
          "s",
      );
      this.onLevelCompletedEvent.invoke({
        levelIndex: this.currentLevelIndex,
        elapsedSeconds: elapsed,
      });
      this.goToScreen(GameScreen.Completion);
      return false;
    }

    this.emitStep();
    return true;
  }

  /** Go back one step. Returns true if successful, false if already at step 0. */
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
    this.onValidationRequestedEvent.invoke(this.currentStepIndex);
  }

  /** Return to the main menu, resetting level state. */
  returnToMenu(): void {
    this.currentLevelIndex = -1;
    this.currentStepIndex = 0;
    this.levelStartTime = 0;
    this.goToScreen(GameScreen.MainMenu);
  }

  // ─── Private ──────────────────────────────────────────────────

  private emitStep(): void {
    const step = this.getCurrentStep();
    if (step) {
      this.log(
        "Step " + (this.currentStepIndex + 1) + ": " + step.instruction,
      );
      this.onStepAdvancedEvent.invoke({
        index: this.currentStepIndex,
        step,
      });
    }
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[GameManager] " + message);
    }
  }
}
