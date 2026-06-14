/**
 * UIManager -- Dynamically creates and manages all floating AR panels
 * for the Zapatory Lab / AR Circuit Lab experience.
 *
 * Creates panels programmatically at runtime -- no manual scene setup needed.
 * Just add this script to any SceneObject in the scene.
 *
 * Layout (user's POV through Spectacles):
 *   START MENU: Centered dark panel with mode selection
 *   IN-LEVEL:   LEFT = voice cue panel
 *               CENTER = step instructions + component info
 *               RIGHT = Zappy (managed externally)
 *   COMPLETION: Centered celebration panel with score
 */
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import {
  GameManager,
  GameScreen,
  GameMode,
  StepAdvanceData,
  StepSubmitData,
  LevelCompleteData,
  ScreenChangeData,
} from "./GameManager";

@component
export class UIManager extends BaseScriptComponent {
  @input
  @hint("Enable debug logging")
  enableLogging: boolean = true;

  @input
  @hint("Camera object for positioning panels in front of user")
  @allowUndefined
  cameraObject!: SceneObject;

  @input
  @hint("The Zappy SceneObject -- will be shown/hidden based on game state")
  @allowUndefined
  zappyObject!: SceneObject;

  @input
  @hint("Distance from camera for floating panels (cm)")
  panelDistance: number = 80;

  // --- Panel SceneObjects (created at runtime) ---
  private startMenuRoot: SceneObject;
  private startMenuTitle: Text;
  private startMenuSubtitle: Text;
  private startMenuModes: Text;

  private inLevelRoot: SceneObject;
  private voiceCuePanel: SceneObject;
  private voiceCueLabel: Text;
  private voiceCueText: Text;

  private stepPanel: SceneObject;
  private stepLevelName: Text;
  private stepCounter: Text;
  private stepInstruction: Text;
  private stepHint: Text;
  private stepComponent: Text;
  private stepPlacement: Text;

  private componentTrayPanel: SceneObject;
  private componentTrayTitle: Text;
  private componentTrayItems: Text;

  private timerText: Text;

  private completionRoot: SceneObject;
  private completionTitle: Text;
  private completionStats: Text;
  private completionMessage: Text;

  // --- State ---
  private gameManager: GameManager;
  private currentScreen: GameScreen = GameScreen.MainMenu;

  onAwake(): void {
    this.log("UIManager awakening...");
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    // Find GameManager
    const scene = global.scene;
    const gmObj = this.findObjectByName(scene, "GameManager");
    if (gmObj) {
      this.gameManager = gmObj.getComponent(GameManager.getTypeName());
    }
    if (!this.gameManager) {
      // Try Orchestrator object
      const orchObj = this.findObjectByName(scene, "Orchestrator");
      if (orchObj) {
        this.gameManager = orchObj.getComponent(GameManager.getTypeName());
      }
    }

    if (!this.gameManager) {
      this.log("GameManager NOT FOUND -- UIManager disabled");
      return;
    }
    this.log("GameManager found");

    // Build all panels
    this.buildStartMenu();
    this.buildInLevelPanels();
    this.buildCompletionPanel();

    // Subscribe to GameManager events
    this.gameManager.onScreenChanged.add((data) =>
      this.handleScreenChange(data),
    );
    this.gameManager.onStepAdvanced.add((data) => this.handleStepAdvance(data));
    this.gameManager.onStepSubmitted.add((data) => this.handleStepSubmit(data));
    this.gameManager.onLevelCompleted.add((data) =>
      this.handleLevelComplete(data),
    );

    // Start with menu visible
    this.showScreen(GameScreen.MainMenu);

    // Hide Zappy initially (appears when level starts)
    if (!isNull(this.zappyObject)) {
      this.zappyObject.enabled = false;
      this.log("Zappy hidden (will appear on level start)");
    }

    // Update timer each frame
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());

    this.log("UIManager ready -- all panels built");
  }

  // --- Panel Builders ---

  private buildStartMenu(): void {
    const parent = this.getSceneObject();
    this.startMenuRoot = parent
      .createComponent("Component.ScriptComponent")
      .getSceneObject();
    // Actually, let's create a child SceneObject properly
    this.startMenuRoot = global.scene.createSceneObject("StartMenu");
    this.startMenuRoot.setParent(parent);

    // Title: "AR CIRCUIT LAB"
    const titleObj = global.scene.createSceneObject("MenuTitle");
    titleObj.setParent(this.startMenuRoot);
    this.startMenuTitle = titleObj.createComponent("Component.Text") as Text;
    this.startMenuTitle.text = "AR CIRCUIT LAB";
    this.startMenuTitle.size = 48;
    this.startMenuTitle.horizontalAlignment = HorizontalAlignment.Center;
    this.startMenuTitle.verticalAlignment = VerticalAlignment.Center;
    titleObj.getTransform().setLocalPosition(new vec3(0, 15, 0));

    // Subtitle: "What do you want to build?"
    const subObj = global.scene.createSceneObject("MenuSubtitle");
    subObj.setParent(this.startMenuRoot);
    this.startMenuSubtitle = subObj.createComponent("Component.Text") as Text;
    this.startMenuSubtitle.text = "What do you\nwant to build?";
    this.startMenuSubtitle.size = 28;
    this.startMenuSubtitle.horizontalAlignment = HorizontalAlignment.Center;
    subObj.getTransform().setLocalPosition(new vec3(0, 6, 0));

    // Mode list (visual only -- actual buttons are the existing option buttons)
    const modesObj = global.scene.createSceneObject("MenuModes");
    modesObj.setParent(this.startMenuRoot);
    this.startMenuModes = modesObj.createComponent("Component.Text") as Text;
    this.startMenuModes.text =
      ">> LEARN\n   LED Circuit - Beginner\n\n" +
      ">> FIX IT\n   Debug the board - Intermediate\n\n" +
      ">> BUILD\n   Timed challenge - Advanced";
    this.startMenuModes.size = 20;
    this.startMenuModes.horizontalAlignment = HorizontalAlignment.Left;
    modesObj.getTransform().setLocalPosition(new vec3(-12, -8, 0));

    this.log("Start menu panel built");
  }

  private buildInLevelPanels(): void {
    const parent = this.getSceneObject();

    // --- In-Level Root ---
    this.inLevelRoot = global.scene.createSceneObject("InLevelHUD");
    this.inLevelRoot.setParent(parent);

    // --- LEFT: Voice Cue Panel ---
    this.voiceCuePanel = global.scene.createSceneObject("VoiceCuePanel");
    this.voiceCuePanel.setParent(this.inLevelRoot);
    this.voiceCuePanel.getTransform().setLocalPosition(new vec3(-40, 0, 0));

    const vcLabelObj = global.scene.createSceneObject("VCLabel");
    vcLabelObj.setParent(this.voiceCuePanel);
    this.voiceCueLabel = vcLabelObj.createComponent("Component.Text") as Text;
    this.voiceCueLabel.text = "VOICE CUE";
    this.voiceCueLabel.size = 14;
    this.voiceCueLabel.horizontalAlignment = HorizontalAlignment.Center;
    vcLabelObj.getTransform().setLocalPosition(new vec3(0, 10, 0));

    const vcTextObj = global.scene.createSceneObject("VCText");
    vcTextObj.setParent(this.voiceCuePanel);
    this.voiceCueText = vcTextObj.createComponent("Component.Text") as Text;
    this.voiceCueText.text = "";
    this.voiceCueText.size = 18;
    this.voiceCueText.horizontalAlignment = HorizontalAlignment.Center;
    vcTextObj.getTransform().setLocalPosition(new vec3(0, 0, 0));

    // --- CENTER: Step Panel ---
    this.stepPanel = global.scene.createSceneObject("StepPanel");
    this.stepPanel.setParent(this.inLevelRoot);
    this.stepPanel.getTransform().setLocalPosition(new vec3(0, 0, 0));

    // Level name
    const lvlObj = global.scene.createSceneObject("LevelName");
    lvlObj.setParent(this.stepPanel);
    this.stepLevelName = lvlObj.createComponent("Component.Text") as Text;
    this.stepLevelName.text = "";
    this.stepLevelName.size = 14;
    this.stepLevelName.horizontalAlignment = HorizontalAlignment.Center;
    lvlObj.getTransform().setLocalPosition(new vec3(0, 18, 0));

    // Step counter
    const ctrObj = global.scene.createSceneObject("StepCounter");
    ctrObj.setParent(this.stepPanel);
    this.stepCounter = ctrObj.createComponent("Component.Text") as Text;
    this.stepCounter.text = "";
    this.stepCounter.size = 16;
    this.stepCounter.horizontalAlignment = HorizontalAlignment.Center;
    ctrObj.getTransform().setLocalPosition(new vec3(0, 13, 0));

    // Step instruction (main text)
    const instrObj = global.scene.createSceneObject("StepInstruction");
    instrObj.setParent(this.stepPanel);
    this.stepInstruction = instrObj.createComponent("Component.Text") as Text;
    this.stepInstruction.text = "";
    this.stepInstruction.size = 24;
    this.stepInstruction.horizontalAlignment = HorizontalAlignment.Center;
    instrObj.getTransform().setLocalPosition(new vec3(0, 5, 0));

    // Hint
    const hintObj = global.scene.createSceneObject("StepHint");
    hintObj.setParent(this.stepPanel);
    this.stepHint = hintObj.createComponent("Component.Text") as Text;
    this.stepHint.text = "";
    this.stepHint.size = 16;
    this.stepHint.horizontalAlignment = HorizontalAlignment.Center;
    hintObj.getTransform().setLocalPosition(new vec3(0, -2, 0));

    // Component name
    const compObj = global.scene.createSceneObject("StepComponent");
    compObj.setParent(this.stepPanel);
    this.stepComponent = compObj.createComponent("Component.Text") as Text;
    this.stepComponent.text = "";
    this.stepComponent.size = 20;
    this.stepComponent.horizontalAlignment = HorizontalAlignment.Center;
    compObj.getTransform().setLocalPosition(new vec3(0, -8, 0));

    // Placement info
    const placeObj = global.scene.createSceneObject("StepPlacement");
    placeObj.setParent(this.stepPanel);
    this.stepPlacement = placeObj.createComponent("Component.Text") as Text;
    this.stepPlacement.text = "";
    this.stepPlacement.size = 16;
    this.stepPlacement.horizontalAlignment = HorizontalAlignment.Center;
    placeObj.getTransform().setLocalPosition(new vec3(0, -14, 0));

    // --- COMPONENT TRAY (above breadboard area) ---
    this.componentTrayPanel = global.scene.createSceneObject("ComponentTray");
    this.componentTrayPanel.setParent(this.inLevelRoot);
    this.componentTrayPanel.getTransform().setLocalPosition(new vec3(0, 22, 0));

    const ctTitleObj = global.scene.createSceneObject("CTTitle");
    ctTitleObj.setParent(this.componentTrayPanel);
    this.componentTrayTitle = ctTitleObj.createComponent(
      "Component.Text",
    ) as Text;
    this.componentTrayTitle.text = "COMPONENT TRAY";
    this.componentTrayTitle.size = 12;
    this.componentTrayTitle.horizontalAlignment = HorizontalAlignment.Center;
    ctTitleObj.getTransform().setLocalPosition(new vec3(0, 4, 0));

    const ctItemsObj = global.scene.createSceneObject("CTItems");
    ctItemsObj.setParent(this.componentTrayPanel);
    this.componentTrayItems = ctItemsObj.createComponent(
      "Component.Text",
    ) as Text;
    this.componentTrayItems.text = "";
    this.componentTrayItems.size = 16;
    this.componentTrayItems.horizontalAlignment = HorizontalAlignment.Center;
    ctItemsObj.getTransform().setLocalPosition(new vec3(0, 0, 0));

    // --- Timer ---
    const timerObj = global.scene.createSceneObject("Timer");
    timerObj.setParent(this.inLevelRoot);
    this.timerText = timerObj.createComponent("Component.Text") as Text;
    this.timerText.text = "00:00";
    this.timerText.size = 18;
    this.timerText.horizontalAlignment = HorizontalAlignment.Right;
    timerObj.getTransform().setLocalPosition(new vec3(35, 18, 0));

    this.log(
      "In-level panels built (voice cue + step + component tray + timer)",
    );
  }

  private buildCompletionPanel(): void {
    const parent = this.getSceneObject();
    this.completionRoot = global.scene.createSceneObject("CompletionPanel");
    this.completionRoot.setParent(parent);

    const titleObj = global.scene.createSceneObject("CompTitle");
    titleObj.setParent(this.completionRoot);
    this.completionTitle = titleObj.createComponent("Component.Text") as Text;
    this.completionTitle.text = "CIRCUIT COMPLETE!";
    this.completionTitle.size = 36;
    this.completionTitle.horizontalAlignment = HorizontalAlignment.Center;
    titleObj.getTransform().setLocalPosition(new vec3(0, 10, 0));

    const statsObj = global.scene.createSceneObject("CompStats");
    statsObj.setParent(this.completionRoot);
    this.completionStats = statsObj.createComponent("Component.Text") as Text;
    this.completionStats.text = "";
    this.completionStats.size = 20;
    this.completionStats.horizontalAlignment = HorizontalAlignment.Center;
    statsObj.getTransform().setLocalPosition(new vec3(0, 0, 0));

    const msgObj = global.scene.createSceneObject("CompMessage");
    msgObj.setParent(this.completionRoot);
    this.completionMessage = msgObj.createComponent("Component.Text") as Text;
    this.completionMessage.text = "";
    this.completionMessage.size = 18;
    this.completionMessage.horizontalAlignment = HorizontalAlignment.Center;
    msgObj.getTransform().setLocalPosition(new vec3(0, -8, 0));

    this.log("Completion panel built");
  }

  // --- Screen Management ---

  private showScreen(screen: GameScreen): void {
    this.currentScreen = screen;

    // Hide all
    if (this.startMenuRoot) this.startMenuRoot.enabled = false;
    if (this.inLevelRoot) this.inLevelRoot.enabled = false;
    if (this.completionRoot) this.completionRoot.enabled = false;

    // Show target
    switch (screen) {
      case GameScreen.MainMenu:
      case GameScreen.ModeSelect:
        if (this.startMenuRoot) this.startMenuRoot.enabled = true;
        // Hide Zappy on menu
        if (!isNull(this.zappyObject)) this.zappyObject.enabled = false;
        this.log("Showing: Start Menu");
        break;

      case GameScreen.InLevel:
        if (this.inLevelRoot) this.inLevelRoot.enabled = true;
        // Show Zappy during level
        if (!isNull(this.zappyObject)) this.zappyObject.enabled = true;
        this.log("Showing: In-Level HUD");
        break;

      case GameScreen.Completion:
        if (this.completionRoot) this.completionRoot.enabled = true;
        // Show Zappy for celebration
        if (!isNull(this.zappyObject)) this.zappyObject.enabled = true;
        this.log("Showing: Completion");
        break;
    }

    this.positionPanels();
  }

  private positionPanels(): void {
    // Position active panel in front of camera
    let camPos = new vec3(0, 0, 0);
    let camFwd = new vec3(0, 0, -1);

    if (!isNull(this.cameraObject)) {
      const camTransform = this.cameraObject.getTransform();
      camPos = camTransform.getWorldPosition();
      camFwd = camTransform.forward;
    }

    const panelPos = camPos.add(camFwd.uniformScale(-this.panelDistance));

    // Position the active root at that location
    if (
      this.currentScreen === GameScreen.MainMenu ||
      this.currentScreen === GameScreen.ModeSelect
    ) {
      if (this.startMenuRoot) {
        this.startMenuRoot.getTransform().setWorldPosition(panelPos);
      }
    } else if (this.currentScreen === GameScreen.InLevel) {
      if (this.inLevelRoot) {
        this.inLevelRoot.getTransform().setWorldPosition(panelPos);
      }
    } else if (this.currentScreen === GameScreen.Completion) {
      if (this.completionRoot) {
        this.completionRoot.getTransform().setWorldPosition(panelPos);
      }
    }
  }

  // --- Event Handlers ---

  private handleScreenChange(data: ScreenChangeData): void {
    this.log("Screen change: " + data.previous + " -> " + data.screen);
    this.showScreen(data.screen);
  }

  private handleStepAdvance(data: StepAdvanceData): void {
    this.log("Step advance: " + (data.index + 1) + "/" + data.totalSteps);

    // Update step panel
    const level = this.gameManager.getCurrentLevel();
    if (level) {
      this.stepLevelName.text = level.name + " - " + level.difficulty;

      // Update component tray -- highlight current component
      const trayParts: string[] = [];
      for (const comp of level.components) {
        if (comp === data.step.component) {
          trayParts.push("[" + comp + "]"); // highlight current
        } else {
          trayParts.push(comp);
        }
      }
      this.componentTrayItems.text = trayParts.join("  |  ");
    }

    this.stepCounter.text =
      "Step " + (data.index + 1) + " of " + data.totalSteps;
    this.stepInstruction.text = data.step.instruction;
    this.stepHint.text = data.step.hint;

    if (data.step.component) {
      this.stepComponent.text = "Component: " + data.step.component;
    } else {
      this.stepComponent.text = "";
    }

    if (data.step.placement) {
      this.stepPlacement.text = data.step.placement;
    } else {
      this.stepPlacement.text = "";
    }

    // Update voice cue panel
    if (data.step.voice && data.step.voice.cue) {
      this.voiceCueText.text = data.step.voice.cue;
      this.voiceCueLabel.text = "VOICE CUE";
    }

    this.log("HUD updated: " + data.step.instruction);
  }

  private handleStepSubmit(data: StepSubmitData): void {
    if (data.skipped) {
      this.voiceCueLabel.text = "SKIPPED";
      this.voiceCueText.text = "Step skipped -- you can review it later.";
      this.log("Step " + (data.index + 1) + " skipped");
    } else if (data.passed) {
      // Show confirmation cue
      const confirmCue = data.step.voice.confirm;
      if (confirmCue) {
        this.voiceCueLabel.text = "CONFIRMED";
        this.voiceCueText.text = confirmCue;
      } else {
        this.voiceCueLabel.text = "CORRECT";
        this.voiceCueText.text = "Step completed!";
      }
      this.log("Step " + (data.index + 1) + " passed");
    }
  }

  private handleLevelComplete(data: LevelCompleteData): void {
    const level = this.gameManager.getLevelData(data.levelIndex);
    const minutes = Math.floor(data.elapsedSeconds / 60);
    const seconds = Math.floor(data.elapsedSeconds % 60);
    const timeStr =
      minutes.toString().padStart(2, "0") +
      ":" +
      seconds.toString().padStart(2, "0");

    this.completionTitle.text = level.name + "\nCOMPLETE!";
    this.completionStats.text =
      "Time: " +
      timeStr +
      "\n" +
      "Steps: " +
      (data.totalSteps - data.stepsSkipped) +
      "/" +
      data.totalSteps +
      " completed\n" +
      "Skipped: " +
      data.stepsSkipped;

    if (data.stepsSkipped === 0) {
      this.completionMessage.text = "Perfect run! Every step completed!";
    } else {
      this.completionMessage.text =
        "Great work! Try again for a perfect score.";
    }

    this.log("Completion panel updated: " + level.name + " in " + timeStr);
  }

  private onUpdate(): void {
    if (this.currentScreen === GameScreen.InLevel && this.gameManager) {
      this.timerText.text = this.gameManager.getElapsedTimeFormatted();
    }
  }

  // --- Helpers ---

  private findObjectByName(
    scene: ScriptScene,
    name: string,
  ): SceneObject | null {
    const rootCount = scene.getRootObjectsCount();
    for (let i = 0; i < rootCount; i++) {
      const found = this.searchTree(scene.getRootObject(i), name);
      if (found) return found;
    }
    return null;
  }

  private searchTree(obj: SceneObject, name: string): SceneObject | null {
    if (obj.name === name) return obj;
    const count = obj.getChildrenCount();
    for (let i = 0; i < count; i++) {
      const found = this.searchTree(obj.getChild(i), name);
      if (found) return found;
    }
    return null;
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[UIManager] " + message);
    }
  }
}
