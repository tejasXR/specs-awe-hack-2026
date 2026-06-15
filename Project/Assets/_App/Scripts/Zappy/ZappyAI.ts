/**
 * ZappyAI — the facade for the Zappy character.
 *
 * The single public surface: external systems (orchestrator, UI, check-work)
 * call intents here, and ZappyAI routes to the niche components — ZappyBrain
 * (Gemini), ZappyEmotionController (mood), ZappyVoice (speech). Movement
 * joins later. Routing and policy only: if a method grows past ~10 lines of
 * coordination, the logic belongs in a component.
 */
import Event, {
  PublicApi,
  unsubscribe,
} from "SpectaclesInteractionKit.lspkg/Utils/Event";
import {
  ZappyBrain,
  ZappyEmotion,
  ZappyEmotionData,
  ZappyResponse,
} from "./ZappyBrain";
import { ZappyEmotionController } from "./ZappyEmotionController";
import { ZappyVoice } from "./ZappyVoice";
import { ZappyMovement } from "./ZappyMovement";
import { ScaleVisibilityAnimator } from "../Utils/ScaleVisibilityAnimator";

// Re-export the domain types so existing `from "./ZappyAI"` imports
// (ExperienceOrchestrator, CheckWorkController) keep compiling.
export { ZappyEmotion } from "./ZappyBrain";
export type { ZappyEmotionData, ZappyResponse } from "./ZappyBrain";

@component
export class ZappyAI extends BaseScriptComponent {
  @ui.separator
  @ui.label("Components")
  @input
  @hint("ZappyBrain — the Gemini client")
  brain!: ZappyBrain;

  @input
  @hint("ZappyEmotionController — holds Zappy's mood")
  emotionController!: ZappyEmotionController;

  @input
  @hint("ZappyVoice — speaks Zappy's lines")
  voice!: ZappyVoice;

  @input
  @hint("ZappyMovement — Zappy's locomotion")
  movement!: ZappyMovement;

  @ui.separator
  @ui.label("Locations")
  @input
  defaultLocation!: SceneObject;

  @input
  checkWorkLocation!: SceneObject;

  @input
  hideOnStart: boolean = false;

  @ui.separator
  @ui.label("Conversation")
  @input
  @widget(new TextAreaWidget())
  @hint(
    "Reply-length cap appended to the system prompt for pinch-to-hold " +
      "conversational turns only — not greet/celebrate/check-work",
  )
  conversationReplyDirective: string =
    "Reply in a single sentence whenever possible. Never use more than two sentences.";

  @input
  enableLogging: boolean = false;

  private _animator!: ScaleVisibilityAnimator;

  private readonly onResponseEvent = new Event<ZappyResponse>();

  readonly onResponse: PublicApi<ZappyResponse> =
    this.onResponseEvent.publicApi();

  private readonly onEmotionChangedEvent = new Event<ZappyEmotionData>();

  readonly onEmotionChanged: PublicApi<ZappyEmotionData> =
    this.onEmotionChangedEvent.publicApi();

  private readonly onRequestFailedEvent = new Event<string>();
  /** Forwarded from the brain — a Gemini request failed (no spoken reply). */
  readonly onRequestFailed: PublicApi<string> =
    this.onRequestFailedEvent.publicApi();

  get onArrived(): PublicApi<void> {
    return this.movement.onArrived;
  }

  get onSpeakingChanged(): PublicApi<boolean> {
    return this.voice.onSpeakingChanged;
  }

  private unsubs: unsubscribe[] = [];

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());

    this._animator = new ScaleVisibilityAnimator(this.getSceneObject(), {
      showDurationMs: 250,
      hideDurationMs: 180,
      shownScale: vec3.one(),
    });
  }

  onStart() {
    this.unsubs.push(
      this.brain.onRequestStarted.add(() =>
        this.setEmotion(ZappyEmotion.Thinking, 0.5),
      ),
    );
    this.unsubs.push(
      this.brain.onRequestFailed.add((error) => {
        this.setEmotion(ZappyEmotion.Sad, 0.7);
        this.onRequestFailedEvent.invoke(error);
      }),
    );
    this.unsubs.push(
      this.brain.onResponse.add((resp) => this.routeResponse(resp)),
    );

    this.unsubs.push(
      this.emotionController.onEmotionStateChanged.add((data) =>
        this.onEmotionChangedEvent.invoke(data),
      ),
    );

    this.createEvent("OnDestroyEvent").bind(() => {
      this.unsubs.forEach((unsub) => unsub());
      this.unsubs = [];
    });

    if (this.hideOnStart) {
      this.hide();
    }
  }

  /** Send a freeform context message to Gemini. Safe to call frequently — drops if busy. */
  activate(context: string): void {
    this.brain.sendRequest(context);
  }

  /**
   * Voice a free-form conversational turn — the pinch-to-hold path. Same as
   * activate(), but applies the conversational reply-length cap so spoken
   * answers stay short (aim one sentence, max two). Scripted intents
   * (greet/celebrate/askAboutStep/handleMistake) keep using activate() uncapped.
   */
  converse(query: string): void {
    this.brain.sendRequest(query, this.conversationReplyDirective);
  }

  /** Send a multimodal request (text + image) to Gemini for visual analysis. */
  activateWithImage(
    context: string,
    base64Image: string,
    mimeType: string,
  ): void {
    this.brain.requestWithImage(context, base64Image, mimeType);
  }

  /**
   * Present a pre-computed response — sets mood, speaks, and notifies
   * observers, with NO Gemini round-trip. For systems that make their own
   * scoped Gemini call (e.g. CheckWorkController) and just want Zappy to react.
   */
  present(resp: ZappyResponse): void {
    this.routeResponse(resp);
  }

  /** Introduce Zappy to the user. */
  greet(): void {
    this.activate("The user just activated you. Introduce yourself briefly!");
  }

  /** Ask Zappy to help with a specific assembly step. */
  askAboutStep(step: string): void {
    this.activate("Help the user with this step: " + step);
  }

  /** Celebrate the user completing a step. */
  celebrateStep(current: number, total: number): void {
    this.activate(
      "User completed step " + current + " of " + total + ". Celebrate!",
    );
  }

  /** Gently guide the user after a mistake. */
  handleMistake(desc: string): void {
    this.activate("User made an error: " + desc + ". Gently help them fix it.");
  }

  /** Set Zappy's mood directly (no Gemini round-trip). */
  setEmotion(emotion: ZappyEmotion, intensity: number): void {
    this.emotionController.setEmotion(emotion, intensity);
  }

  /** Returns true if a Gemini call is currently in flight. */
  getIsBusy(): boolean {
    return this.brain.getIsBusy();
  }

  /**
   * True while Zappy is occupied — thinking (Gemini in flight) or speaking. The
   * lightweight shared guard callers check before starting a new response so
   * chat, check-work, and voice Q&A don't talk over each other.
   */
  isResponding(): boolean {
    return this.brain.getIsBusy() || this.voice.isSpeaking;
  }

  /** Cut off any current speech — e.g. to duck Zappy before listening. */
  stopSpeaking(): void {
    this.voice.stop();
  }

  show(): void {
    this._animator.show();
  }

  hide(): void {
    this._animator.hide(false);
  }

  /** Send Zappy travelling to a world position (e.g. a setup spot). */
  moveTo(position: vec3): void {
    this.movement.moveToPosition(position);
  }

  /** Send Zappy to his default resting location (no-op if unwired). */
  moveZappyToDefaultLocation(): void {
    if (isNull(this.defaultLocation)) {
      this.log("defaultLocation not assigned — cannot move home");
      return;
    }
    this.movement.moveToPosition(
      this.defaultLocation.getTransform().getWorldPosition(),
    );
  }

  /** Send Zappy to his check-work inspection location (no-op if unwired). */
  moveZappyToCheckWorkLocation(): void {
    if (isNull(this.checkWorkLocation)) {
      this.log("checkWorkLocation not assigned — cannot move to check spot");
      return;
    }
    this.movement.moveToPosition(
      this.checkWorkLocation.getTransform().getWorldPosition(),
    );
  }

  /** Voice a fixed line with an optional mood — no Gemini round-trip. */
  say(
    text: string,
    emotion: ZappyEmotion = ZappyEmotion.Neutral,
    intensity: number = 0.6,
  ): void {
    this.emotionController.setEmotion(emotion, intensity);
    this.voice.speak(text);
  }

  private routeResponse(resp: ZappyResponse): void {
    this.log("Zappy says: " + resp.speech);
    // Mood first, then speech — the voice reads the new emotion at speak time.
    this.emotionController.setEmotion(resp.emotion, resp.intensity);
    this.voice.speak(resp.speech);
    this.onResponseEvent.invoke(resp);
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ZappyAI] " + message);
    }
  }
}
