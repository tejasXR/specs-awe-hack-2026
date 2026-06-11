/**
 * ZappyAI — Emotional AI Assistant for Zapatory Lab
 *
 * Uses Gemini via RemoteServiceGateway for AI responses with structured
 * emotion output. Supports two personality modes: Mascot & Tutor.
 *
 * Adapted from Danny-Dev branch to use Tejas's Event/PublicApi pattern.
 *
 * SETUP: Requires RemoteServiceGateway.lspkg installed via Lens Studio
 *        Asset Library + Google Token set in RemoteServiceGatewayCredentials.
 *        Token: (set in RemoteServiceGatewayCredentials asset in Lens Studio)
 */
import { Gemini } from "RemoteServiceGateway.lspkg/HostedExternal/Gemini";
import { GeminiTypes } from "RemoteServiceGateway.lspkg/HostedExternal/GeminiTypes";
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";

// ─── Types ──────────────────────────────────────────────────────

export enum ZappyEmotion {
  Happy = "happy",
  Sad = "sad",
  Thinking = "thinking",
  Excited = "excited",
  Confused = "confused",
  Neutral = "neutral",
}

export enum ZappyPersonality {
  Mascot = "mascot",
  Tutor = "tutor",
}

export interface ZappyResponse {
  emotion: ZappyEmotion;
  intensity: number;
  speech: string;
}

export interface ZappyEmotionData {
  emotion: ZappyEmotion;
  intensity: number;
}

// ─── Component ──────────────────────────────────────────────────

@component
export class ZappyAI extends BaseScriptComponent {
  @input
  @hint("Enable debug logging")
  enableLogging: boolean = true;

  @input
  @hint("Optional text component for speech display")
  @allowUndefined
  speechText!: Text;

  @input
  @hint("TextToSpeechModule asset — add via Resources > + > Text To Speech Module")
  @allowUndefined
  ttsModule!: TextToSpeechModule;

  @input
  @hint("AudioComponent on this object for TTS playback")
  @allowUndefined
  audioComponent!: AudioComponent;

  // ─── Events (Tejas's pattern) ─────────────────────────────────

  private readonly onEmotionChangedEvent = new Event<ZappyEmotionData>();
  /** Fires whenever Zappy's emotion changes (including the "thinking" state). */
  readonly onEmotionChanged: PublicApi<ZappyEmotionData> =
    this.onEmotionChangedEvent.publicApi();

  private readonly onSpeechReadyEvent = new Event<string>();
  /** Fires when Zappy has speech text ready to display or synthesize. */
  readonly onSpeechReady: PublicApi<string> =
    this.onSpeechReadyEvent.publicApi();

  private readonly onResponseEvent = new Event<ZappyResponse>();
  /** Fires with the full structured response (emotion + intensity + speech). */
  readonly onResponse: PublicApi<ZappyResponse> =
    this.onResponseEvent.publicApi();

  // ─── Private State ────────────────────────────────────────────

  private personality: ZappyPersonality = ZappyPersonality.Mascot;
  private isBusy: boolean = false;
  private isSpeaking: boolean = false;
  private history: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  private readonly MASCOT_PROMPT =
    "You are Zappy, a tiny energetic electricity-based AR mascot for Zapatory Lab! " +
    "You help users build breadboard circuits. Speak in short, punchy, enthusiastic " +
    "sentences with electricity puns. Keep responses under 2 sentences. Be fun! " +
    'CRITICAL: Always respond in this EXACT JSON format, nothing else: ' +
    '{"emotion":"happy","intensity":0.8,"speech":"Your response here"} ' +
    "Valid emotions: happy, sad, thinking, excited, confused, neutral. intensity: 0.0 to 1.0";

  private readonly TUTOR_PROMPT =
    "You are Zappy, a patient and knowledgeable AR electronics tutor for Zapatory Lab. " +
    "You guide users step-by-step through building breadboard circuits. Explain WHY each " +
    "connection matters. Be clear, supportive, educational. Under 3 sentences. " +
    'CRITICAL: Always respond in this EXACT JSON format, nothing else: ' +
    '{"emotion":"happy","intensity":0.8,"speech":"Your response here"} ' +
    "Valid emotions: happy, sad, thinking, excited, confused, neutral. intensity: 0.0 to 1.0";

  // ─── Lifecycle ────────────────────────────────────────────────

  onAwake(): void {
    this.log("ZappyAI awakening...");
  }

  // ─── Public API — Actions ─────────────────────────────────────

  /** Send a freeform context message to Gemini. Safe to call frequently — drops if busy. */
  activate(context: string): void {
    if (this.isBusy) {
      this.log("ZappyAI busy — dropping request");
      return;
    }
    this.log("Activating: " + context.substring(0, 60));
    this.callGemini(context);
  }

  /**
   * Send a multimodal request (text + image) to Gemini for visual analysis.
   * Used by CheckWorkController to analyze breadboard photos.
   *
   * @param context  The text prompt describing what to analyze
   * @param base64Image  Base64-encoded image data
   * @param mimeType  Image MIME type (e.g. "image/jpeg", "image/png")
   */
  activateWithImage(
    context: string,
    base64Image: string,
    mimeType: string,
  ): void {
    if (this.isBusy) {
      this.log("ZappyAI busy — dropping vision request");
      return;
    }
    this.log("Activating with image (" + mimeType + "): " + context.substring(0, 60));
    this.callGeminiWithImage(context, base64Image, mimeType);
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
    this.activate(
      "User made an error: " + desc + ". Gently help them fix it.",
    );
  }

  // ─── Public API — Personality ─────────────────────────────────

  setPersonality(mode: ZappyPersonality): void {
    this.personality = mode;
    this.history = [];
    this.log("Personality set to: " + mode);
  }

  getPersonality(): ZappyPersonality {
    return this.personality;
  }

  togglePersonality(): ZappyPersonality {
    this.personality =
      this.personality === ZappyPersonality.Mascot
        ? ZappyPersonality.Tutor
        : ZappyPersonality.Mascot;
    this.history = [];
    this.log("Personality toggled to: " + this.personality);
    return this.personality;
  }

  /** Returns true if a Gemini call is currently in flight. */
  getIsBusy(): boolean {
    return this.isBusy;
  }

  // ─── Private — Gemini Integration ─────────────────────────────

  private callGemini(userMessage: string): void {
    this.isBusy = true;
    this.emitEmotion(ZappyEmotion.Thinking, 0.5);

    const sysPrompt =
      this.personality === ZappyPersonality.Tutor
        ? this.TUTOR_PROMPT
        : this.MASCOT_PROMPT;

    const contents: Array<{
      role: string;
      parts: Array<{ text: string }>;
    }> = [];

    contents.push({ role: "model", parts: [{ text: sysPrompt }] });

    // Include last 8 messages for context window
    const recent = this.history.slice(-8);
    for (let i = 0; i < recent.length; i++) {
      contents.push(recent[i]);
    }
    contents.push({ role: "user", parts: [{ text: userMessage }] });

    const request = {
      model: "gemini-2.5-flash",
      type: "generateContent",
      body: { contents: contents },
    } as GeminiTypes.Models.GenerateContentRequest;

    this.log("Calling Gemini...");

    Gemini.models(request)
      .then((response) => {
        this.log("Gemini responded");
        const rawText = response.candidates[0].content.parts[0].text;
        this.log("Raw: " + rawText);

        this.history.push({
          role: "user",
          parts: [{ text: userMessage }],
        });
        this.history.push({ role: "model", parts: [{ text: rawText }] });

        const parsed = this.parseResponse(rawText);
        if (parsed) {
          this.handleResponse(parsed);
        } else {
          this.log("JSON parse failed, using raw text");
          this.handleResponse({
            emotion: ZappyEmotion.Neutral,
            intensity: 0.5,
            speech: rawText,
          });
        }
        this.isBusy = false;
      })
      .catch((error) => {
        this.log("Gemini error: " + error);
        this.emitEmotion(ZappyEmotion.Sad, 0.7);
        this.isBusy = false;
      });
  }

  /**
   * Send a multimodal (text + image) request to Gemini.
   * gemini-2.5-flash supports vision natively — no model change needed.
   */
  private callGeminiWithImage(
    userMessage: string,
    base64Image: string,
    mimeType: string,
  ): void {
    this.isBusy = true;
    this.emitEmotion(ZappyEmotion.Thinking, 0.5);

    // Build multimodal content: system prompt + user text + image
    const sysPrompt =
      this.personality === ZappyPersonality.Tutor
        ? this.TUTOR_PROMPT
        : this.MASCOT_PROMPT;

    const contents: any[] = [];
    contents.push({ role: "model", parts: [{ text: sysPrompt }] });

    // Include recent history (text-only — don't re-send old images)
    const recent = this.history.slice(-6);
    for (let i = 0; i < recent.length; i++) {
      contents.push(recent[i]);
    }

    // User message with both text and image in the same turn
    contents.push({
      role: "user",
      parts: [
        { text: userMessage },
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Image,
          },
        },
      ],
    });

    const request = {
      model: "gemini-2.5-flash",
      type: "generateContent",
      body: { contents: contents },
    } as GeminiTypes.Models.GenerateContentRequest;

    this.log("Calling Gemini with image (" + Math.round(base64Image.length / 1024) + " KB)...");

    Gemini.models(request)
      .then((response) => {
        this.log("Gemini vision responded");
        const rawText = response.candidates[0].content.parts[0].text;
        this.log("Raw: " + rawText);

        // Store text-only in history (don't bloat with base64)
        this.history.push({
          role: "user",
          parts: [{ text: userMessage + " [attached image]" }],
        });
        this.history.push({ role: "model", parts: [{ text: rawText }] });

        const parsed = this.parseResponse(rawText);
        if (parsed) {
          this.handleResponse(parsed);
        } else {
          this.log("JSON parse failed, using raw text");
          this.handleResponse({
            emotion: ZappyEmotion.Neutral,
            intensity: 0.5,
            speech: rawText,
          });
        }
        this.isBusy = false;
      })
      .catch((error) => {
        this.log("Gemini vision error: " + error);
        this.emitEmotion(ZappyEmotion.Sad, 0.7);
        this.isBusy = false;
      });
  }

  private parseResponse(raw: string): ZappyResponse | null {
    try {
      let jsonStr = raw.trim();

      // Strip markdown code fences if Gemini wraps JSON in ```
      if (jsonStr.indexOf("```") === 0) {
        const start = jsonStr.indexOf("{");
        const end = jsonStr.lastIndexOf("}") + 1;
        if (start >= 0 && end > start) {
          jsonStr = jsonStr.substring(start, end);
        }
      }

      const obj = JSON.parse(jsonStr);
      if (!obj.speech || typeof obj.speech !== "string") return null;

      const validEmotions = [
        "happy",
        "sad",
        "thinking",
        "excited",
        "confused",
        "neutral",
      ];
      let emotion = ZappyEmotion.Neutral;
      if (validEmotions.indexOf(obj.emotion) >= 0) {
        emotion = obj.emotion as ZappyEmotion;
      }

      let intensity = 0.5;
      if (typeof obj.intensity === "number") {
        intensity = Math.max(0, Math.min(1, obj.intensity));
      }

      return { emotion, intensity, speech: obj.speech };
    } catch (e) {
      this.log("JSON parse error: " + e);
      return null;
    }
  }

  private handleResponse(resp: ZappyResponse): void {
    this.log("Emotion: " + resp.emotion + " (" + resp.intensity + ")");
    this.log("Speech: " + resp.speech);

    this.emitEmotion(resp.emotion, resp.intensity);
    this.onSpeechReadyEvent.invoke(resp.speech);
    this.onResponseEvent.invoke(resp);

    if (!isNull(this.speechText)) {
      this.speechText.text = resp.speech;
    }

    // Speak out loud via TTS
    this.speak(resp.speech);

    this.log("Zappy says: " + resp.speech);
  }

  // --- Text-to-Speech ---

  private speak(text: string): void {
    if (isNull(this.ttsModule)) {
      this.log("TTS module not assigned -- skipping speech");
      return;
    }
    if (isNull(this.audioComponent)) {
      this.log("AudioComponent not assigned -- skipping speech");
      return;
    }

    const options = TextToSpeech.Options.create();
    options.voiceName = "Sasha";

    this.isSpeaking = true;
    this.ttsModule.synthesize(
      text,
      options,
      (audioTrack: AudioTrackAsset, wordInfo: TextToSpeech.WordInfo[], phonemeInfo: TextToSpeech.PhonemeInfo[], voiceStyle: any) => {
        this.log("TTS audio ready (" + wordInfo.length + " words)");
        this.audioComponent.audioTrack = audioTrack;
        this.audioComponent.play(1);
        this.isSpeaking = false;
      },
      (error: number, description: string) => {
        this.log("TTS error " + error + ": " + description);
        this.isSpeaking = false;
      },
    );
  }

  private emitEmotion(emotion: ZappyEmotion, intensity: number): void {
    this.onEmotionChangedEvent.invoke({ emotion, intensity });
  }

  private log(message: string): void {
    if (this.enableLogging) {
      print("[ZappyAI] " + message);
    }
  }
}
