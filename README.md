# 🗣️ Shout Runner — Voice-Controlled Endless Runner

Shout Runner is an interactive, arcade-style endless runner where the player character is controlled entirely through real-time voice volume and pitch detected by your microphone.

---

## 🛠️ Tech Stack

- **Game Engine & Rendering:** HTML5 Canvas API (60 FPS game loop, particle systems, sprite physics)
- **Audio Processing:** Native Web Audio API (`AudioContext`, `AnalyserNode`, RMS time-domain signal processing)
- **Frontend & UI:** Semantic HTML5, Responsive CSS3
- **Logic & State:** Vanilla ES6+ JavaScript, Browser `localStorage`
- **Deployment:** GitHub Pages

---

## ✨ Features

- 🎤 **Real-Time Voice Physics Engine:**
  - Uses continuous Root Mean Square (RMS) audio sampling to quantify sound amplitude in real time.
  - **Graduated Movement:**
    - **Silence:** Character idles.
    - **Whisper / Normal Speech:** Character walks forward.
    - **Yell / Shout:** Character launches into a high jump to dodge obstacles and pit hazards.

- 🎚️ **Live Volume Gauge & Sensitivity Calibration:**
  - Dynamic on-screen volume bar transitions from green (quiet) to amber to vibrant red (shout peak).
  - Built-in **Mic Gain / Sensitivity Slider** allows tuning for different microphones (laptop built-in, headset, quiet vs noisy rooms) and persists preferences in `localStorage`.

- ⌨️ **Accessibility Keyboard Fallback:**
  - Includes full keyboard support (`Spacebar` or `Up Arrow`) simulating shout impulses so the game is fully playable even in library environments or when microphone access is restricted.

- 🔒 **100% Client-Side Privacy:**
  - All microphone audio streams are analyzed strictly in volatile memory using local browser audio nodes.
  - Zero audio is ever recorded, stored, or transmitted over the network.

---

## 🚀 Live Demo

Play Shout Runner live in your browser:  
👉 **[https://akhil-tech258.github.io/Shout-to-shot/](https://akhil-tech258.github.io/Shout-to-shot/)**
