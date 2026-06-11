/**
 * ExperienceOrchestrator — AUTO-DISCOVERY + BUILT-IN UI PANELS
 *
 * Creates all floating AR panels at runtime. No manual UI wiring needed.
 * Just add this script to any SceneObject in the scene.
 *
 * Layout:
 *   START MENU:  Centered panel with mode selection (LEARN/FIX IT/BUILD)
 *   IN-LEVEL:    LEFT = voice cue text, CENTER = step instructions, RIGHT = Zappy
 *   COMPLETION:  Centered celebration + score
 */
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";

import { AiCharacter } from "./Zappy/AiCharacter";
import { AiCharacterOption } from "./Zappy/AiCharacterOption";
import { AiCharacterOptionsController } from "./Zappy/AiCharacterOptionsController";
import {
  ZappyAI,
  ZappyResponse,
} from "./Zappy/ZappyAI";
import {
  GameManager,
  GameScreen,
  GameMode,
  StepAdvanceData,
  StepSubmitData,
  LevelCompleteData,
  ScreenChangeData,
} from "./GameManager";
import {
  BreadboardBleController,
  BreadboardConnectionState,
  BreadboardStatus,
} from "./BreadboardBleController";

// --- Component ---

@component
export class ExperienceOrchestrator extends BaseScriptComponent {
  @input greetOnStart: boolean = false;
  @input enableLogging: boolean = true;

  @input
  @hint("Distance from camera for floating panels (cm)")
  panelDistance: number = 80;

  // ─── UI Panel Inputs (wire these in Lens Studio Inspector!) ───

  @ui.separator
  @ui.label('<b>Start Menu Panel</b>')

  @input @hint("Start menu root SceneObject — shown on launch") @allowUndefined
  startMenuPanel!: SceneObject;

  @ui.separator
  @ui.label('<b>In-Level HUD</b>')

  @input @hint("In-level HUD root SceneObject") @allowUndefined
  inLevelPanel!: SceneObject;

  @input @hint("Voice cue text (LEFT panel)") @allowUndefined
  voiceCueText!: Text;

  @input @hint("Voice cue label (e.g. 'VOICE CUE')") @allowUndefined
  voiceCueLabelTextInput!: Text;

  @input @hint("Step instruction (main text, CENTER panel)") @allowUndefined
  stepInstructionInput!: Text;

  @input @hint("Step counter (e.g. 'Step 2 of 7')") @allowUndefined
  stepCounterInput!: Text;

  @input @hint("Level name text") @allowUndefined
  levelNameInput!: Text;

  @input @hint("Step hint text") @allowUndefined
  stepHintInput!: Text;

  @input @hint("Current component name") @allowUndefined
  stepComponentInput!: Text;

  @input @hint("Placement instruction") @allowUndefined
  stepPlacementInput!: Text;

  @input @hint("Component tray text") @allowUndefined
  componentTrayInput!: Text;

  @input @hint("Timer text") @allowUndefined
  timerInput!: Text;

  @ui.separator
  @ui.label('<b>Completion Panel</b>')

  @input @hint("Completion root SceneObject") @allowUndefined
  completionPanel!: SceneObject;

  @input @hint("Completion title text") @allowUndefined
  completionTitleInput!: Text;

  @input @hint("Completion stats text") @allowUndefined
  completionStatsInput!: Text;

  @input @hint("Completion message text") @allowUndefined
  completionMessageInput!: Text;

  // --- Resolved at runtime ---

  private gameManager: GameManager;
  private zappyAI: ZappyAI;
  private character: AiCharacter;
  private optionsController: AiCharacterOptionsController | null = null;
  private levelOptions: AiCharacterOption[] = [];
  private bleController: BreadboardBleController | null = null;
  private unsubs: unsubscribe[] = [];
  private isInLevel: boolean = false;

  // --- Camera ---
  private cameraTransform: Transform;

  // --- Programmatic fallback panels (used when @inputs aren't wired) ---
  private startMenuRoot: SceneObject;
  private inLevelRoot: SceneObject;
  private completionRoot: SceneObject;
  private menuTitleText: Text;
  private menuSubtitleText: Text;
  private menuModesText: Text;
  private voiceCueLabelText: Text;
  private voiceCueBodyText: Text;
  private stepLevelNameText: Text;
  private stepCounterText: Text;
  private stepInstructionText: Text;
  private stepHintText: Text;
  private stepComponentText: Text;
  private stepPlacementText: Text;
  private componentTrayText: Text;
  private timerDisplayText: Text;
  private completionTitleText: Text;
  private completionStatsText: Text;
  private completionMessageText: Text;

  // Zappy refs
  private zappyObj: SceneObject;
  private optionsObj: SceneObject;

  /** Whether real @input panels are wired (vs programmatic fallback). */
  private usingRealPanels: boolean = false;

  // --- Lifecycle ---

  onAwake(): void {
    print("[Orchestrator] onAwake -- auto-discovery + UI builder");
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    print("[Orchestrator] --- AUTO-DISCOVERY STARTING ---");

    // Camera
    this.cameraTransform = WorldCameraFinderProvider.getInstance().getTransform();
    print("[Orchestrator] Camera transform acquired");

    const scene = global.scene;

    // -- GameManager --
    let gmObj: SceneObject = this.getSceneObject();
    this.gameManager = gmObj.getComponent(GameManager.getTypeName());
    if (!this.gameManager) {
      gmObj = this.findObjectByName(scene, "GameManager");
      if (gmObj) this.gameManager = gmObj.getComponent(GameManager.getTypeName());
    }
    if (!this.gameManager) {
      const orchObj = this.findObjectByName(scene, "Orchestrator");
      if (orchObj) this.gameManager = orchObj.getComponent(GameManager.getTypeName());
    }
    if (!this.gameManager) {
      print("[Orchestrator] GameManager NOT FOUND -- ABORTING");
      return;
    }
    print("[Orchestrator] GameManager found");

    // -- ZappyAI --
    this.zappyObj = this.findObjectByName(scene, "Zappy");
    if (this.zappyObj) {
      print("[Orchestrator] Found 'Zappy' object");
      this.zappyAI = this.zappyObj.getComponent(ZappyAI.getTypeName());
      this.character = this.zappyObj.getComponent(AiCharacter.getTypeName());
    } else {
      print("[Orchestrator] No 'Zappy' object -- ABORTING");
      return;
    }
    if (!this.zappyAI || !this.character) {
      print("[Orchestrator] ZappyAI or AiCharacter missing -- ABORTING");
      return;
    }
    print("[Orchestrator] ZappyAI + AiCharacter found");

    // -- Options controller + option buttons --
    this.optionsObj = this.findChildByName(this.zappyObj, "Options");
    if (this.optionsObj) {
      this.optionsController = this.optionsObj.getComponent(AiCharacterOptionsController.getTypeName());
      if (this.optionsController) print("[Orchestrator] OptionsController found");
    }

    const optionNames = ["Check Work Option", "General Help Option", "Information Option"];
    if (this.optionsObj) {
      for (const name of optionNames) {
        const child = this.findChildByName(this.optionsObj, name);
        if (child) {
          const opt = child.getComponent(AiCharacterOption.getTypeName());
          if (opt) {
            this.levelOptions.push(opt);
            print("[Orchestrator] Option found: '" + name + "'");
          }
        }
      }
    }

    // -- BLE Controller --
    const bleObj = this.findObjectByName(scene, "BLE Controller");
    if (bleObj) {
      this.bleController = bleObj.getComponent(BreadboardBleController.getTypeName());
      if (this.bleController) print("[Orchestrator] BLE found");
    }

    // --- DISABLE OLD UI ---
    this.disableOldUI();

    // --- BUILD UI PANELS ---
    this.buildAllPanels();

    // --- WIRE EVENTS ---
    this.wireEvents();

    // --- INITIAL STATE ---
    this.showScreen(GameScreen.MainMenu);

    print("[Orchestrator] === ALL SYSTEMS GO ===");
  }

  /** Turn off Tejas's old ExperienceInitialization overlays and debug text. */
  private disableOldUI(): void {
    const scene = global.scene;

    // Disable ExperienceInitialization object (has "Hand is not tracked!" debug text)
    const initObj = this.findObjectByName(scene, "Experience Initialization");
    if (initObj) {
      initObj.enabled = false;
      print("[Orchestrator] Disabled 'Experience Initialization'");
    }

    // Also try alternate names and common parent objects
    const names = [
      "ExperienceInitialization", "Experience Initialization",
      "Scene Setup", "SceneSetup", "Debug Text",
      "Initialization", "Init", "Setup",
      "Forward Positioner", "ObjectForwardPositioner",
    ];
    for (const name of names) {
      const obj = this.findObjectByName(scene, name);
      if (obj) {
        obj.enabled = false;
        print("[Orchestrator] Disabled '" + name + "'");
      }
    }

    // Disable any Text components that say old prompts
    this.disableTextContaining(scene, "Touch your breadboard");
    this.disableTextContaining(scene, "Hand is not tracked");
    this.disableTextContaining(scene, "Pointing down");
  }

  /** Find and hide any Text components containing a specific string. */
  private disableTextContaining(scene: ScriptScene, search: string): void {
    const rootCount = scene.getRootObjectsCount();
    for (let i = 0; i < rootCount; i++) {
      this.searchAndDisableText(scene.getRootObject(i), search);
    }
  }

  private searchAndDisableText(obj: SceneObject, search: string): void {
    const textComp = obj.getComponent("Component.Text") as Text;
    if (textComp && textComp.text && textComp.text.indexOf(search) >= 0) {
      obj.enabled = false;
      print("[Orchestrator] Disabled text: '" + textComp.text.substring(0, 40) + "...'");
    }
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.searchAndDisableText(obj.getChild(i), search);
    }
  }

  // --- Panel Setup ---

  private buildAllPanels(): void {
    // Check if real panels are wired
    this.usingRealPanels = !isNull(this.startMenuPanel) && !isNull(this.inLevelPanel);

    if (this.usingRealPanels) {
      print("[Orchestrator] Using REAL UI panels from Inspector");
      this.setupRealPanels();
    } else {
      print("[Orchestrator] No panels wired -- using programmatic fallback");
      this.buildFallbackPanels();
    }
  }

  /** Wire up the real @input panels from Lens Studio Inspector. */
  private setupRealPanels(): void {
    this.startMenuRoot = this.startMenuPanel;
    this.inLevelRoot = this.inLevelPanel;
    this.completionRoot = isNull(this.completionPanel) ? null : this.completionPanel;

    // Map @input text components to internal refs
    this.voiceCueLabelText = isNull(this.voiceCueLabelTextInput) ? null : this.voiceCueLabelTextInput;
    this.voiceCueBodyText = isNull(this.voiceCueText) ? null : this.voiceCueText;
    this.stepInstructionText = isNull(this.stepInstructionInput) ? null : this.stepInstructionInput;
    this.stepCounterText = isNull(this.stepCounterInput) ? null : this.stepCounterInput;
    this.stepLevelNameText = isNull(this.levelNameInput) ? null : this.levelNameInput;
    this.stepHintText = isNull(this.stepHintInput) ? null : this.stepHintInput;
    this.stepComponentText = isNull(this.stepComponentInput) ? null : this.stepComponentInput;
    this.stepPlacementText = isNull(this.stepPlacementInput) ? null : this.stepPlacementInput;
    this.componentTrayText = isNull(this.componentTrayInput) ? null : this.componentTrayInput;
    this.timerDisplayText = isNull(this.timerInput) ? null : this.timerInput;
    this.completionTitleText = isNull(this.completionTitleInput) ? null : this.completionTitleInput;
    this.completionStatsText = isNull(this.completionStatsInput) ? null : this.completionStatsInput;
    this.completionMessageText = isNull(this.completionMessageInput) ? null : this.completionMessageInput;

    print("[Orchestrator] Real panels mapped");
  }

  /** Fallback: create panels programmatically when no Inspector panels are wired. */
  private buildFallbackPanels(): void {
    const parent = this.getSceneObject();

    // START MENU
    this.startMenuRoot = global.scene.createSceneObject("StartMenu_Root");
    this.startMenuRoot.setParent(parent);

    this.makePanel(this.startMenuRoot, "MenuBG", new vec3(0, 2, 0.5), 24, 20, new vec4(0.06, 0.08, 0.16, 0.95));
    this.menuTitleText = this.makeText(this.startMenuRoot, "Menu_Title", new vec3(0, 20, 0), 42, new vec4(0.0, 0.9, 0.8, 1));
    this.menuTitleText.text = "AR CIRCUIT LAB";
    this.menuSubtitleText = this.makeText(this.startMenuRoot, "Menu_Subtitle", new vec3(0, 12, 0), 24, new vec4(1, 1, 1, 1));
    this.menuSubtitleText.text = "What do you\nwant to build?";
    this.menuModesText = this.makeText(this.startMenuRoot, "Menu_Modes", new vec3(0, -4, 0), 18, new vec4(0.9, 0.9, 0.9, 1));
    this.menuModesText.text =
      "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n" +
      "  \u25CF  LEARN\n     LED Circuit - Beginner\n" +
      "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n" +
      "  \u25CF  FIX IT\n     Debug the board - Intermediate\n" +
      "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n" +
      "  \u25CF  BUILD\n     Timed challenge - Advanced\n" +
      "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n\n" +
      "Pinch an option to start!";

    // IN-LEVEL
    this.inLevelRoot = global.scene.createSceneObject("InLevel_Root");
    this.inLevelRoot.setParent(parent);

    this.makePanel(this.inLevelRoot, "VC_BG", new vec3(-35, 5, 0.5), 18, 12, new vec4(0.06, 0.08, 0.16, 0.9));
    this.voiceCueLabelText = this.makeText(this.inLevelRoot, "VC_Label", new vec3(-35, 12, 0), 12, new vec4(0.0, 0.9, 0.8, 1));
    this.voiceCueLabelText.text = "VOICE CUE";
    this.voiceCueBodyText = this.makeText(this.inLevelRoot, "VC_Body", new vec3(-35, 2, 0), 14, new vec4(0.9, 0.9, 0.9, 1));
    this.voiceCueBodyText.text = "";

    this.makePanel(this.inLevelRoot, "Step_BG", new vec3(0, 5, 0.5), 22, 18, new vec4(0.06, 0.08, 0.16, 0.9));
    this.stepLevelNameText = this.makeText(this.inLevelRoot, "Step_Level", new vec3(0, 22, 0), 12, new vec4(0.9, 0.7, 0.1, 1));
    this.stepCounterText = this.makeText(this.inLevelRoot, "Step_Counter", new vec3(0, 17, 0), 12, new vec4(0.6, 0.6, 0.6, 1));
    this.stepInstructionText = this.makeText(this.inLevelRoot, "Step_Instr", new vec3(0, 8, 0), 22, new vec4(1, 1, 1, 1));
    this.stepHintText = this.makeText(this.inLevelRoot, "Step_Hint", new vec3(0, 0, 0), 14, new vec4(0.7, 0.7, 0.7, 1));
    this.stepComponentText = this.makeText(this.inLevelRoot, "Step_Comp", new vec3(0, -7, 0), 16, new vec4(0.3, 0.9, 0.4, 1));
    this.stepPlacementText = this.makeText(this.inLevelRoot, "Step_Place", new vec3(0, -14, 0), 12, new vec4(0.0, 0.9, 0.8, 1));

    this.makePanel(this.inLevelRoot, "CT_BG", new vec3(0, 28, 0.5), 22, 3, new vec4(0.08, 0.1, 0.2, 0.85));
    this.componentTrayText = this.makeText(this.inLevelRoot, "CompTray", new vec3(0, 28, 0), 10, new vec4(0.9, 0.7, 0.1, 1));
    this.componentTrayText.text = "COMPONENT TRAY";
    this.timerDisplayText = this.makeText(this.inLevelRoot, "Timer", new vec3(30, 22, 0), 16, new vec4(1, 1, 1, 1));
    this.timerDisplayText.text = "00:00";

    // COMPLETION
    this.completionRoot = global.scene.createSceneObject("Completion_Root");
    this.completionRoot.setParent(parent);
    this.makePanel(this.completionRoot, "Comp_BG", new vec3(0, 0, 0.5), 22, 14, new vec4(0.06, 0.08, 0.16, 0.95));
    this.completionTitleText = this.makeText(this.completionRoot, "Comp_Title", new vec3(0, 12, 0), 32, new vec4(0.3, 0.9, 0.4, 1));
    this.completionTitleText.text = "CIRCUIT COMPLETE!";
    this.completionStatsText = this.makeText(this.completionRoot, "Comp_Stats", new vec3(0, 0, 0), 18, new vec4(1, 1, 1, 1));
    this.completionMessageText = this.makeText(this.completionRoot, "Comp_Msg", new vec3(0, -10, 0), 16, new vec4(0.9, 0.7, 0.1, 1));

    print("[Orchestrator] Fallback panels built");
  }

  /** Helper: create a styled Text. */
  private makeText(parent: SceneObject, name: string, localPos: vec3, size: number, color?: vec4): Text {
    const obj = global.scene.createSceneObject(name);
    obj.setParent(parent);
    const text = obj.createComponent("Component.Text") as Text;
    text.size = size;
    text.horizontalAlignment = HorizontalAlignment.Center;
    text.verticalAlignment = VerticalAlignment.Center;
    text.textFill.color = color || new vec4(1, 1, 1, 1);
    text.outlineSettings.enabled = true;
    text.outlineSettings.size = 0.2;
    text.outlineSettings.fill.color = new vec4(0.02, 0.03, 0.06, 1.0);
    text.dropshadowSettings.enabled = true;
    text.dropshadowSettings.fill.color = new vec4(0.0, 0.0, 0.0, 0.7);
    obj.getTransform().setLocalPosition(localPos);
    return text;
  }

  /** Helper: create a dark background panel using filled blocks. */
  private makePanel(parent: SceneObject, name: string, localPos: vec3, cols: number, rows: number, bgColor: vec4): void {
    const obj = global.scene.createSceneObject(name);
    obj.setParent(parent);
    const text = obj.createComponent("Component.Text") as Text;
    const row = "\u2588".repeat(cols);
    const lines: string[] = [];
    for (let i = 0; i < rows; i++) lines.push(row);
    text.text = lines.join("\n");
    text.size = 24;
    text.horizontalAlignment = HorizontalAlignment.Center;
    text.verticalAlignment = VerticalAlignment.Center;
    text.textFill.color = bgColor;
    text.outlineSettings.enabled = false;
    text.dropshadowSettings.enabled = false;
    obj.getTransform().setLocalPosition(localPos);
  }

  // --- Text Setters (null-safe for unwired inputs) ---

  private setTextSafe(text: Text, value: string): void {
    if (text) text.text = value;
  }

  // --- Screen Management ---

  private showScreen(screen: GameScreen): void {
    // Hide all panels
    if (this.startMenuRoot) this.startMenuRoot.enabled = false;
    if (this.inLevelRoot) this.inLevelRoot.enabled = false;
    if (this.completionRoot) this.completionRoot.enabled = false;

    switch (screen) {
      case GameScreen.MainMenu:
      case GameScreen.ModeSelect:
        if (this.startMenuRoot) this.startMenuRoot.enabled = true;
        // Hide Zappy + options on menu
        if (this.zappyObj) this.zappyObj.enabled = false;
        print("[Orchestrator] UI: Start Menu shown, Zappy hidden");
        break;

      case GameScreen.InLevel:
        if (this.inLevelRoot) this.inLevelRoot.enabled = true;
        // Show Zappy + options during level
        if (this.zappyObj) this.zappyObj.enabled = true;
        print("[Orchestrator] UI: In-Level HUD shown, Zappy visible");
        break;

      case GameScreen.Completion:
        if (this.completionRoot) this.completionRoot.enabled = true;
        // Show Zappy for celebration
        if (this.zappyObj) this.zappyObj.enabled = true;
        print("[Orchestrator] UI: Completion shown, Zappy visible");
        break;
    }

    // Position panel in front of camera
    this.positionActivePanel(screen);
  }

  private positionActivePanel(screen: GameScreen): void {
    const camPos = this.cameraTransform.getWorldPosition();
    const camFwd = this.cameraTransform.right.cross(vec3.up()).normalize();
    const panelPos = camPos.add(camFwd.uniformScale(-this.panelDistance));

    let root: SceneObject = null;
    if (screen === GameScreen.MainMenu || screen === GameScreen.ModeSelect) {
      root = this.startMenuRoot;
    } else if (screen === GameScreen.InLevel) {
      root = this.inLevelRoot;
    } else if (screen === GameScreen.Completion) {
      root = this.completionRoot;
    }

    if (root) {
      root.getTransform().setWorldPosition(panelPos);

      // Face the camera (billboard)
      const toCamera = camPos.sub(panelPos);
      toCamera.y = 0;
      if (toCamera.length > 0.01) {
        root.getTransform().setWorldRotation(
          quat.lookAt(toCamera.normalize(), vec3.up()),
        );
      }
      print("[Orchestrator] Panel positioned at " + panelPos.x.toFixed(1) + ", " + panelPos.y.toFixed(1) + ", " + panelPos.z.toFixed(1));
    }
  }

  // --- Scene Traversal Helpers ---

  private findObjectByName(scene: ScriptScene, name: string): SceneObject | null {
    const rootCount = scene.getRootObjectsCount();
    for (let i = 0; i < rootCount; i++) {
      const found = this.searchTree(scene.getRootObject(i), name);
      if (found) return found;
    }
    return null;
  }

  private searchTree(obj: SceneObject, name: string): SceneObject | null {
    if (obj.name === name) return obj;
    const childCount = obj.getChildrenCount();
    for (let i = 0; i < childCount; i++) {
      const found = this.searchTree(obj.getChild(i), name);
      if (found) return found;
    }
    return null;
  }

  private findChildByName(parent: SceneObject, name: string): SceneObject | null {
    const childCount = parent.getChildrenCount();
    for (let i = 0; i < childCount; i++) {
      if (parent.getChild(i).name === name) return parent.getChild(i);
    }
    for (let i = 0; i < childCount; i++) {
      const child = parent.getChild(i);
      for (let j = 0; j < child.getChildrenCount(); j++) {
        if (child.getChild(j).name === name) return child.getChild(j);
      }
    }
    return null;
  }

  // --- Event Wiring ---

  private wireEvents(): void {
    // GameManager events
    this.unsubs.push(
      this.gameManager.onStepAdvanced.add((data) => this.onStepAdvanced(data)),
    );
    this.unsubs.push(
      this.gameManager.onStepSubmitted.add((data) => this.onStepSubmitted(data)),
    );
    this.unsubs.push(
      this.gameManager.onLevelCompleted.add((data) => this.onLevelCompleted(data)),
    );
    this.unsubs.push(
      this.gameManager.onScreenChanged.add((data) => this.onScreenChanged(data)),
    );
    this.unsubs.push(
      this.gameManager.onModeChanged.add((mode) => {
        print("[Orchestrator] Mode changed: " + mode);
      }),
    );
    print("[Orchestrator] GameManager events wired");

    // ZappyAI events
    this.unsubs.push(
      this.zappyAI.onResponse.add((resp) => this.onZappyResponse(resp)),
    );
    this.unsubs.push(
      this.zappyAI.onEmotionChanged.add((data) => {
        print("[Orchestrator] Zappy emotion: " + data.emotion);
      }),
    );
    print("[Orchestrator] ZappyAI events wired");

    // Option buttons -- dual purpose (menu vs in-level)
    const modes = [GameMode.Learn, GameMode.FixIt, GameMode.Build];
    for (let i = 0; i < this.levelOptions.length; i++) {
      const idx = i;
      this.unsubs.push(
        this.levelOptions[i].onOptionSelected.add(() => {
          if (this.isInLevel) {
            // During level: 0=Submit, 1=Skip, 2=Ask Zappy
            if (idx === 0) {
              print("[Orchestrator] SUBMIT step pressed");
              this.gameManager.submitStep();
            } else if (idx === 1) {
              print("[Orchestrator] SKIP step pressed");
              this.gameManager.skipStep();
            } else if (idx === 2) {
              print("[Orchestrator] ASK ZAPPY pressed");
              const step = this.gameManager.getCurrentStep();
              if (step) {
                this.zappyAI.activate("The user needs help with: " + step.instruction + ". Hint: " + step.hint);
              }
            }
          } else {
            // Menu: select mode and start Level 0
            if (idx < modes.length) {
              this.gameManager.setMode(modes[idx]);
            }
            this.onLevelSelected(0);
          }
        }),
      );
    }
    if (this.levelOptions.length > 0) {
      print("[Orchestrator] " + this.levelOptions.length + " option buttons wired");
    }

    // BLE events
    if (this.bleController) {
      this.unsubs.push(
        this.bleController.onStateChanged.add((state) => this.onBleStateChanged(state)),
      );
      this.unsubs.push(
        this.bleController.onStatus.add((status) => this.onBleStatus(status)),
      );
      print("[Orchestrator] BLE wired");
    }

    // Greet on start (after short delay)
    if (this.greetOnStart) {
      const delay = this.createEvent("DelayedCallbackEvent");
      delay.bind(() => {
        this.removeEvent(delay);
        print("[Orchestrator] Greeting...");
        this.zappyAI.greet();
      });
      delay.reset(1.0);
    }

    // Update loop
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  private onDestroy(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
  }

  // --- Event Handlers ---

  private onLevelSelected(levelIndex: number): void {
    print("[Orchestrator] LEVEL SELECTED: " + levelIndex);
    if (levelIndex >= this.gameManager.getLevelCount()) return;
    const level = this.gameManager.getLevelData(levelIndex);
    this.gameManager.startLevel(levelIndex);
    this.isInLevel = true;
    this.zappyAI.activate(
      "The user chose '" + level.name + "': " + level.description + ". Introduce the level briefly!",
    );
  }

  private onStepAdvanced(data: StepAdvanceData): void {
    print("[Orchestrator] Step " + (data.index + 1) + "/" + data.totalSteps + ": " + data.step.instruction);

    // Update CENTER step panel
    const level = this.gameManager.getCurrentLevel();
    if (level) {
      this.setTextSafe(this.stepLevelNameText, level.name + " - " + level.difficulty);

      // Component tray: highlight current component
      const parts: string[] = [];
      for (const comp of level.components) {
        if (comp === data.step.component) {
          parts.push("[ " + comp + " ]");
        } else {
          parts.push(comp);
        }
      }
      this.setTextSafe(this.componentTrayText, parts.join("  |  "));
    }

    this.setTextSafe(this.stepCounterText, "Step " + (data.index + 1) + " of " + data.totalSteps);
    this.setTextSafe(this.stepInstructionText, data.step.instruction);
    this.setTextSafe(this.stepHintText, data.step.hint);
    this.setTextSafe(this.stepComponentText, data.step.component ? "Component: " + data.step.component : "");
    this.setTextSafe(this.stepPlacementText, data.step.placement || "");

    // Update LEFT voice cue panel
    if (data.step.voice && data.step.voice.cue) {
      this.setTextSafe(this.voiceCueLabelText, "VOICE CUE");
      this.setTextSafe(this.voiceCueBodyText, data.step.voice.cue);
      print("[Orchestrator] Voice cue: " + data.step.voice.cue.substring(0, 60) + "...");

      // Send to Zappy for TTS
      this.zappyAI.activate(
        "Guide the user through this step. Say EXACTLY this: " + data.step.voice.cue,
      );
    } else {
      this.zappyAI.askAboutStep(data.step.instruction + " (Hint: " + data.step.hint + ")");
    }

    const charPos = this.character.getTransform().getWorldPosition();
    this.character.help(charPos);
  }

  private onStepSubmitted(data: StepSubmitData): void {
    if (data.skipped) {
      print("[Orchestrator] Step " + (data.index + 1) + " SKIPPED");
      this.setTextSafe(this.voiceCueLabelText, "SKIPPED");
      this.setTextSafe(this.voiceCueBodyText, "Step skipped -- you can review later.");
      this.zappyAI.activate("The user skipped a step. Briefly acknowledge and encourage.");
    } else if (data.passed) {
      print("[Orchestrator] Step " + (data.index + 1) + " PASSED");
      const confirmCue = data.step.voice.confirm;
      if (confirmCue) {
        this.setTextSafe(this.voiceCueLabelText, "CONFIRMED");
        this.setTextSafe(this.voiceCueBodyText, confirmCue);
        this.zappyAI.activate("The user completed the step correctly. Say EXACTLY this: " + confirmCue);
      } else {
        this.setTextSafe(this.voiceCueLabelText, "CORRECT");
        this.setTextSafe(this.voiceCueBodyText, "Step completed!");
        this.zappyAI.celebrateStep(data.index + 1, this.gameManager.getTotalSteps());
      }
    }
  }

  private onLevelCompleted(data: LevelCompleteData): void {
    const level = this.gameManager.getLevelData(data.levelIndex);
    const mins = Math.floor(data.elapsedSeconds / 60);
    const secs = Math.floor(data.elapsedSeconds % 60);
    const timeStr = mins.toString().padStart(2, "0") + ":" + secs.toString().padStart(2, "0");

    print("[Orchestrator] COMPLETE: " + level.name +
      " in " + timeStr +
      " | skipped " + data.stepsSkipped + "/" + data.totalSteps +
      " | mode=" + data.mode);

    this.isInLevel = false;

    // Update completion panel
    this.setTextSafe(this.completionTitleText, level.name + "\nCOMPLETE!");
    this.setTextSafe(this.completionStatsText,
      "Time: " + timeStr + "\n" +
      "Steps: " + (data.totalSteps - data.stepsSkipped) + "/" + data.totalSteps + " completed\n" +
      "Skipped: " + data.stepsSkipped);
    this.setTextSafe(this.completionMessageText, data.stepsSkipped === 0
      ? "Perfect run! Every step nailed!"
      : "Great work! Try again for a perfect score.");

    this.zappyAI.celebrateStep(data.totalSteps, data.totalSteps);
    this.character.idle();
  }

  private onScreenChanged(data: ScreenChangeData): void {
    print("[Orchestrator] Screen: " + data.previous + " -> " + data.screen);
    if (data.screen === GameScreen.MainMenu) {
      this.character.idle();
      this.isInLevel = false;
    }
    this.showScreen(data.screen);
  }

  private onZappyResponse(resp: ZappyResponse): void {
    print("[Orchestrator] Zappy: " + resp.speech);
  }

  private onBleStateChanged(state: BreadboardConnectionState): void {
    print("[Orchestrator] BLE: " + state.kind);
    if (state.kind === "connected") {
      this.zappyAI.activate("Bluetooth connected! Board is ready.");
    }
  }

  private onBleStatus(status: BreadboardStatus): void {
    const step = this.gameManager.getCurrentStep();
    if (step && step.phase === "Test" && status.ledLevel > 0) {
      this.zappyAI.activate("LED is on! Circuit works!");
    }
  }

  private onUpdate(): void {
    // Update timer during level
    if (this.isInLevel && this.timerDisplayText) {
      this.setTextSafe(this.timerDisplayText, this.gameManager.getElapsedTimeFormatted());
    }
  }
}
