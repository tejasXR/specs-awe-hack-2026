# ARrested Development – Team Meeting Notes

> **Team Members:** Danny Tapia, Tejas Shroff (TJ), Sasha Menscikova
> **Project:** AWE Hackathon 2026 – Snap Spectacles AR Electronics Learning Experience

---

## Meeting 1 — May 21, 2026

### Summary

The team's first ideation meeting. Tejas facilitated a structured brainstorm using FigJam around three key questions: (1) What problem are we solving? (2) What do we want judges to do? (3) What ideas do we have? The team aligned on building an **AR-guided electronics/breadboard learning experience** using Snap Spectacles. Danny brought deep electronics knowledge (555 timers, integrated circuits, motors), Sasha contributed strong UX/design thinking (gamification, minimal text, overlay-first approach), and Tejas drove product scoping and interaction design. They discussed the judge pitch format (2-5 min pitch, judges may stay 10+ min if hooked), presentation strategy, and the importance of making the experience feel magical and result-driven.

### Key Decisions

- **Concept confirmed:** AR-guided breadboard/electronics learning — physical electronics + Snap Spectacles overlay
- **Problem statement:** People want to build cool physical electronics products but have no idea how to approach learning or building
- **Current learning resources are flat/2D** — AR is a perfect fit for spatial, hands-on guidance
- **Three difficulty levels:** Simple (LED), Medium (Buzzer), Hard (Motion sensor timer)
- **Gamification elements:** Timer/speed challenge, leaderboard, celebration animations, step completion tracking
- **UX principles established by Sasha:**
  - No walls of text — use short subtitles + voice overlay
  - Highlight pins directly on the breadboard overlay
  - Show step progress (e.g., "3 of 7 steps complete")
  - Give users a tangible result at the end ("I built something!")
- **Game modes discussed:**
  1. **Learn mode** — Step-by-step guided tutorial with overlay
  2. **Fix mode** — Find what's missing/broken on a pre-built circuit
  3. **Build mode** — Timed challenge to assemble from scratch
- **555 timer IC** discussed as an advanced component that could unlock more complex projects
- **Sasha will handle the presentation deck** (won't be at AWE physically for judging day but will be there June 15)
- **Danny sketched an initial UI wireframe** — breadboard center, name + timer top, pause button, components list on the left
- **AWE hackathon kickoff** is May 28; ~3 weeks of build time before traveling

### Action Items

- [ ] Tejas: Scope the product and define weekly task assignments
- [ ] Sasha: Start Figma designs / user journey flows
- [ ] Danny: Research circuit templates for the three difficulty levels
- [ ] All: Get breadboard kits ($9-15 starter kits)
- [ ] All: Meet again around May 27th to scope and divide work

---

## Meeting 2 — June 1, 2026

### Summary

The team's second sync focused on **transitioning from ideation to implementation**. Tejas presented a ShapeXR spatial prototype showing a physical-first approach — placing real pins and wires on a real breadboard with AR overlays, plus a wrist-activated AI assistant ("Zappy"). The team enthusiastically moved toward a **physical-first approach** (augmenting a real breadboard rather than purely virtual). Sessions centered on tracking/ML capabilities, using Snap's on-device ML to recognize and overlay the physical breadboard, integrating Gemini AI for an intelligent assistant, and planning a gamified unboxing-to-building flow. Danny organized the GitHub repo, created dev branches, and committed to building game logic, menus, and the AI assistant integration. Tejas took on ML/tracking R&D. Sasha drove references (chess ML example, Arduino+Spectacles Bluetooth integration) and UX refinement.

### Key Decisions

- **Physical-first approach confirmed** — real breadboard + AR overlay (not purely virtual)
- **"Zappy" AI assistant concept:**
  - Activated via wrist gesture (pull up wrist → Zappy appears)
  - Pinch to expand options / shortcut menus
  - Pre-made shortcut responses for common questions (saves AI tokens)
  - Full AI (Gemini Flash 3) for complex/custom questions
  - Character-driven (like First Contact on Quest) — not just a generic chatbot
- **Breadboard tracking via ML:** Use Snap's on-device SnapML (YOLO-based) to track the breadboard
  - Reference: Chess ML example on GitHub (tracks chess pieces, has overlay, recalibration via left palm pinch, integrated Gemini API)
  - Goal: Swap chess tracking for breadboard tracking
- **"Scan box" affordance:** Hold breadboard in a designated area for Zappy to check your work (better camera angle for ML)
- **Unboxing flow discussed:**
  - Track the kit box itself → open → overlay shows where to place each component on the table
  - ML recognizes when components are placed correctly → audio checkpoint "Step 1 complete!"
  - Gamification: checkpoints, sounds, celebration
- **Three levels / modes refined:**
  1. **Tutorial (Level 1):** Unbox kit, set up station, build first circuit — feels like a game, not a tutorial (inspired by First Contact on Quest)
  2. **Guided Build (Level 2):** Semi-assembled kit, start from midpoint — judges start here
  3. **Timed Challenge (Level 3):** Speed mode with leaderboard
- **Product name brainstorm:**
  - "Zappy Labs" and "Zap Labs" both taken (Australian electronics company doing similar things)
  - Direction: short, memorable name + "Labs" suffix
  - Deferred to next meeting — need to finalize by Wednesday
- **GitHub organized:** Danny restructured into Project/, context/ (docs, samples, packages), and agentic-tools/ (skill guides)
- **Dev branches created:** `Danny-Dev`, `Tejas-Dev`, `Sasha-Dev` + `main`
- **ESP32 / Arduino integration discussed** — could connect what you build on the breadboard back to Spectacles via Bluetooth (two-way interaction)
- **Spectacles UI constraints:** No dark/black colors (they become transparent), avoid duplicating Snap's default UI kit, use electric/vibrant colors (like Zappy's yellow)
- **Next meeting:** Wednesday June 4, 6:00 PM EST / 3:00 PM PST

### Action Items

- [ ] Danny: Organize GitHub repo structure, build start menu / level selection UI, prototype Zappy AI assistant (Gemini API integration), research ESP32 breadboard connectivity
- [ ] Tejas: Get breadboard kit (arriving in Boston), test SnapML tracking accuracy on breadboard, report ML findings Wednesday
- [ ] Sasha: Update Figma with table layout zones, design onboarding flow, finalize Spectacles-compatible UI (no dark colors), share chess ML GitHub example + Arduino Spectacles docs
- [ ] All: Brainstorm product names (short + "Labs" suffix direction)
- [ ] All: Meet Wednesday June 4 @ 6PM EST

---

## Reference Links & Resources

| Resource | Description |
|----------|-------------|
| Chess ML GitHub Example | Object tracking + overlay + Gemini API integration — reference for breadboard tracking |
| Arduino + Spectacles | Bluetooth BLE connection between Arduino/ESP32 and Spectacles |
| 555 Timer IC | Versatile integrated circuit for beginner→intermediate electronics projects |
| ShapeXR Prototype | Tejas's spatial prototype of the physical-first breadboard experience |
| First Contact (Quest) | Inspiration for tutorial-that-feels-like-a-game approach |
| AEX Netflix (meme) | Timer/music inspiration for gamification |
