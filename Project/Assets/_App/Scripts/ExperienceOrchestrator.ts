/**
 * ExperienceOrchestrator — AUTO-DISCOVERY VERSION
 *
 * Finds all dependencies by searching the scene hierarchy by object name.
 * NO INSPECTOR WIRING NEEDED. Just add this script to any SceneObject.
 */
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";

// We import these ONLY for type info — we find them by scene traversal
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
  StepAdvanceData,
  LevelCompleteData,
  ScreenChangeData,
} from "./GameManager";
import {
  BreadboardBleController,
  BreadboardConnectionState,
  BreadboardStatus,
} from "./BreadboardBleController";

// ─── Component ──────────────────────────────────────────────────

@component
export class ExperienceOrchestrator extends BaseScriptComponent {
  @input greetOnStart: boolean = true;
  @input enableLogging: boolean = true;

  // ─── Resolved at runtime ──────────────────────────────────────

  private gameManager: GameManager;
  private zappyAI: ZappyAI;
  private character: AiCharacter;
  private optionsController: AiCharacterOptionsController | null = null;
  private levelOptions: AiCharacterOption[] = [];
  private bleController: BreadboardBleController | null = null;
  private unsubs: unsubscribe[] = [];

  // ─── Lifecycle ────────────────────────────────────────────────

  onAwake(): void {
    print("[Orchestrator] onAwake — auto-discovery mode");
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy());
  }

  private onStart(): void {
    print("[Orchestrator] --- AUTO-DISCOVERY STARTING ---");

    // Find components on known objects by name
    const scene = global.scene;

    // -- GameManager -- on same object or "GameManager" --
    // Try same object first
    let gmObj = this.getSceneObject();
    this.gameManager = gmObj.getComponent(GameManager.getTypeName());
    if (!this.gameManager) {
      gmObj = this.findObjectByName(scene, "GameManager");
      if (gmObj) {
        this.gameManager = gmObj.getComponent(GameManager.getTypeName());
      }
    }
    // Also search the Orchestrator object itself
    if (!this.gameManager) {
      const orchObj = this.findObjectByName(scene, "Orchestrator");
      if (orchObj) {
        this.gameManager = orchObj.getComponent(GameManager.getTypeName());
      }
    }
    if (this.gameManager) {
      print("[Orchestrator] GameManager found");
    } else {
      print("[Orchestrator] GameManager NOT FOUND -- add GameManager.ts to any object");
      return;
    }

    // -- ZappyAI -- on "Zappy" object --
    const zappyObj = this.findObjectByName(scene, "Zappy");
    if (zappyObj) {
      print("[Orchestrator] Found 'Zappy' object");
      this.zappyAI = zappyObj.getComponent(ZappyAI.getTypeName());
      this.character = zappyObj.getComponent(AiCharacter.getTypeName());
    } else {
      print("[Orchestrator] No SceneObject named 'Zappy' found!");
      return;
    }

    if (this.zappyAI) {
      print("[Orchestrator] ZappyAI found on Zappy");
    } else {
      print("[Orchestrator] ZappyAI NOT FOUND -- add ZappyAI.ts to 'Zappy'");
      return;
    }

    if (this.character) {
      print("[Orchestrator] AiCharacter found on Zappy");
    } else {
      print("[Orchestrator] AiCharacter NOT FOUND on 'Zappy'");
      return;
    }

    // -- Options -- child of Zappy named "Options" --
    const optionsObj = this.findChildByName(zappyObj, "Options");
    if (optionsObj) {
      this.optionsController = optionsObj.getComponent(AiCharacterOptionsController.getTypeName());
      if (this.optionsController) {
        print("[Orchestrator] AiCharacterOptionsController found on Options");
      }
    }

    // -- Level Option buttons -- children of Options --
    const optionNames = ["Check Work Option", "General Help Option", "Information Option"];
    if (optionsObj) {
      for (const name of optionNames) {
        const child = this.findChildByName(optionsObj, name);
        if (child) {
          const opt = child.getComponent(AiCharacterOption.getTypeName());
          if (opt) {
            this.levelOptions.push(opt);
            print("[Orchestrator] AiCharacterOption found on '" + name + "'");
          } else {
            print("[Orchestrator] No AiCharacterOption on '" + name + "'");
          }
        }
      }
    }

    // -- BLE Controller --
    const bleObj = this.findObjectByName(scene, "BLE Controller");
    if (bleObj) {
      this.bleController = bleObj.getComponent(BreadboardBleController.getTypeName());
      if (this.bleController) {
        print("[Orchestrator] BreadboardBleController found");
      }
    }

    // ── Now wire all events ─────────────────────────────────
    this.wireEvents();

    print("[Orchestrator] ━━━ ALL SYSTEMS GO ━━━");
  }

  // ─── Scene Traversal Helpers ──────────────────────────────────

  /** Find a SceneObject anywhere in the scene by name (breadth-first). */
  private findObjectByName(scene: ScriptScene, name: string): SceneObject | null {
    const rootCount = scene.getRootObjectsCount();
    for (let i = 0; i < rootCount; i++) {
      const root = scene.getRootObject(i);
      const found = this.searchTree(root, name);
      if (found) return found;
    }
    print("[Orchestrator] ⚠ Object '" + name + "' not found in scene");
    return null;
  }

  /** Recursively search a subtree for an object by name. */
  private searchTree(obj: SceneObject, name: string): SceneObject | null {
    if (obj.name === name) return obj;
    const childCount = obj.getChildrenCount();
    for (let i = 0; i < childCount; i++) {
      const found = this.searchTree(obj.getChild(i), name);
      if (found) return found;
    }
    return null;
  }

  /** Find a direct child by name. */
  private findChildByName(parent: SceneObject, name: string): SceneObject | null {
    const childCount = parent.getChildrenCount();
    for (let i = 0; i < childCount; i++) {
      const child = parent.getChild(i);
      if (child.name === name) return child;
    }
    // Also search one level deeper
    for (let i = 0; i < childCount; i++) {
      const child = parent.getChild(i);
      const grandChildCount = child.getChildrenCount();
      for (let j = 0; j < grandChildCount; j++) {
        const grandChild = child.getChild(j);
        if (grandChild.name === name) return grandChild;
      }
    }
    return null;
  }

  /** Get a typed script component from a SceneObject by script name. */
  private getTypedComponent(obj: SceneObject, scriptName: string): ScriptComponent | null {
    const comps = obj.getComponents("Component.ScriptComponent");
    for (let i = 0; i < comps.length; i++) {
      const comp = comps[i];
      // Try getTypeName first
      const typeName = comp.getTypeName();
      if (typeName === scriptName) {
        return comp;
      }
    }
    // If getTypeName didn't match, try the script's name property
    for (let i = 0; i < comps.length; i++) {
      const comp = comps[i] as any;
      if (comp.name === scriptName) {
        return comp;
      }
    }
    return null;
  }

  // ─── Event Wiring ─────────────────────────────────────────────

  private wireEvents(): void {
    // GameManager events
    this.unsubs.push(
      this.gameManager.onStepAdvanced.add((data) => this.onStepAdvanced(data)),
    );
    this.unsubs.push(
      this.gameManager.onLevelCompleted.add((data) => this.onLevelCompleted(data)),
    );
    this.unsubs.push(
      this.gameManager.onScreenChanged.add((data) => this.onScreenChanged(data)),
    );
    print("[Orchestrator] ✅ GameManager events wired");

    // ZappyAI events
    this.unsubs.push(
      this.zappyAI.onResponse.add((resp) => this.onZappyResponse(resp)),
    );
    this.unsubs.push(
      this.zappyAI.onEmotionChanged.add((data) => {
        print("[Orchestrator] Zappy emotion: " + data.emotion);
      }),
    );
    print("[Orchestrator] ✅ ZappyAI events wired");

    // Level option buttons
    for (let i = 0; i < this.levelOptions.length; i++) {
      const levelIndex = i;
      this.unsubs.push(
        this.levelOptions[i].onOptionSelected.add(() => this.onLevelSelected(levelIndex)),
      );
    }
    if (this.levelOptions.length > 0) {
      print("[Orchestrator] ✅ " + this.levelOptions.length + " option buttons wired");
    }

    // BLE events
    if (this.bleController) {
      this.unsubs.push(
        this.bleController.onStateChanged.add((state) => this.onBleStateChanged(state)),
      );
      this.unsubs.push(
        this.bleController.onStatus.add((status) => this.onBleStatus(status)),
      );
      print("[Orchestrator] ✅ BLE wired");
    }

    // Greet on start
    if (this.greetOnStart) {
      const delay = this.createEvent("DelayedCallbackEvent");
      delay.bind(() => {
        this.removeEvent(delay);
        print("[Orchestrator] Greeting...");
        this.zappyAI.greet();
      });
      delay.reset(1.0);
    }

    // Timer
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  private onDestroy(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
  }

  // ─── Event Handlers ───────────────────────────────────────────

  private onLevelSelected(levelIndex: number): void {
    print("[Orchestrator] 🎮 LEVEL SELECTED: " + levelIndex);
    if (levelIndex >= this.gameManager.getLevelCount()) return;
    const level = this.gameManager.getLevelData(levelIndex);
    this.gameManager.startLevel(levelIndex);
    this.zappyAI.activate(
      "The user chose '" + level.name + "': " + level.description + ". Introduce and encourage!",
    );
  }

  private onStepAdvanced(data: StepAdvanceData): void {
    print("[Orchestrator] Step " + (data.index + 1) + ": " + data.step.instruction);
    this.zappyAI.askAboutStep(data.step.instruction + " (Hint: " + data.step.hint + ")");
    const charPos = this.character.getTransform().getWorldPosition();
    this.character.help(charPos);
  }

  private onLevelCompleted(data: LevelCompleteData): void {
    const level = this.gameManager.getLevelData(data.levelIndex);
    print("[Orchestrator] 🎉 COMPLETE: " + level.name);
    this.zappyAI.celebrateStep(this.gameManager.getTotalSteps(), this.gameManager.getTotalSteps());
    this.character.idle();
  }

  private onScreenChanged(data: ScreenChangeData): void {
    print("[Orchestrator] Screen: " + data.previous + " → " + data.screen);
    if (data.screen === GameScreen.MainMenu) this.character.idle();
  }

  private onZappyResponse(resp: ZappyResponse): void {
    print("[Orchestrator] 💬 Zappy: " + resp.speech);
  }

  private onBleStateChanged(state: BreadboardConnectionState): void {
    print("[Orchestrator] BLE: " + state.kind);
    if (state.kind === "connected") {
      this.zappyAI.activate("Bluetooth connected! Board is ready.");
    }
  }

  private onBleStatus(status: BreadboardStatus): void {
    const step = this.gameManager.getCurrentStep();
    if (step && step.phase === "FunctionalTest" && status.ledLevel > 0) {
      this.zappyAI.activate("LED is on! Circuit works!");
    }
  }

  private onUpdate(): void {
    // Timer updates would go here
  }
}
