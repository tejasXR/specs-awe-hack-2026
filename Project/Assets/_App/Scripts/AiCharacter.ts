import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";

export type AiCharacterState =
  | { kind: "idling" }
  | { kind: "helping"; target: vec3 }
  | { kind: "investigating"; target: vec3 };

@component
export class AiCharacter extends BaseScriptComponent {
  private _state: AiCharacterState = { kind: "idling" };

  private readonly onStateChangedEvent = new Event<AiCharacterState>();
  readonly onStateChanged: PublicApi<AiCharacterState> =
    this.onStateChangedEvent.publicApi();

  /** Current state — read-only for other consumers (mover, animation, VFX). */
  get state(): AiCharacterState {
    return this._state;
  }

  idle(): void {
    this.setState({ kind: "idling" });
  }

  help(target: vec3): void {
    this.setState({ kind: "helping", target });
  }

  investigate(target: vec3): void {
    this.setState({ kind: "investigating", target });
  }

  private setState(next: AiCharacterState): void {
    this._state = next;
    this.onStateChangedEvent.invoke(next);
  }
}
