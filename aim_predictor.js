/*
 * aim_predictor.js
 * External, opt-in visual prediction/debug module for a 2D Canvas game you own.
 *
 * What it does:
 * - Adds a small panel and transparent canvas overlay.
 * - Can observe a selected canvas visually only if you call setCanvas(canvas).
 * - Includes reusable angle and constant-velocity prediction helpers.
 * - Does NOT automate mouse input, aim, or shooting.
 *
 * To use:
 *   <script src="./aim_predictor.js"></script>
 *   AimPredictor.setCanvas(document.querySelector("canvas"));
 *   AimPredictor.start();
 */

(() => {
  "use strict";

  const state = {
    running: false,
    sourceCanvas: null,
    overlay: null,
    overlayCtx: null,
    panel: null,
    rafId: null,
    horizonMs: 100,
    sample: null,
    previous: null,
    velocity: { x: 0, y: 0 },
    target: null,
    origin: null,
    lastFrameTime: 0,
    showOverlay: true,
    status: "Waiting for canvas",
  };

  function ensureUI() {
    if (state.overlay) return;

    const overlay = document.createElement("canvas");
    overlay.id = "aim-predictor-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      pointerEvents: "none",
      zIndex: "2147483646",
    });
    document.documentElement.appendChild(overlay);
    state.overlay = overlay;
    state.overlayCtx = overlay.getContext("2d");

    const panel = document.createElement("div");
    panel.id = "aim-predictor-panel";
    Object.assign(panel.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: "2147483647",
      width: "245px",
      padding: "12px",
      borderRadius: "10px",
      background: "rgba(15, 18, 25, 0.92)",
      color: "#f3f4f6",
      font: "12px/1.45 system-ui, sans-serif",
      boxShadow: "0 4px 18px rgba(0,0,0,.3)",
      pointerEvents: "auto",
    });
    panel.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:8px">Aim Predictor · Debug</div>
      <div id="ap-status" style="margin-bottom:8px;color:#a7f3d0">Waiting for canvas</div>
      <label for="ap-horizon">Prediction horizon: <span id="ap-horizon-label">100</span> ms</label>
      <input id="ap-horizon" type="range" min="0" max="500" step="25" value="100"
        style="display:block;width:100%;margin:7px 0 10px">
      <div id="ap-values" style="white-space:pre-line">No sample yet</div>
      <div style="margin-top:8px;color:#9ca3af">Visual debug only · no input automation</div>
      <button id="ap-hide" style="margin-top:8px;padding:5px 8px;cursor:pointer">Hide panel</button>
    `;
    document.documentElement.appendChild(panel);
    state.panel = panel;

    panel.querySelector("#ap-horizon").addEventListener("input", (event) => {
      state.horizonMs = Number(event.target.value);
      panel.querySelector("#ap-horizon-label").textContent = String(state.horizonMs);
      draw();
    });
    panel.querySelector("#ap-hide").addEventListener("click", () => {
      panel.style.display = "none";
    });

    resizeOverlay();
    window.addEventListener("resize", resizeOverlay);
  }

  function resizeOverlay() {
    if (!state.overlay) return;
    const dpr = window.devicePixelRatio || 1;
    state.overlay.width = Math.round(window.innerWidth * dpr);
    state.overlay.height = Math.round(window.innerHeight * dpr);
    state.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function updatePanel() {
    if (!state.panel) return;
    const status = state.panel.querySelector("#ap-status");
    const values = state.panel.querySelector("#ap-values");
    status.textContent = state.status;
    if (state.sample && state.target && state.origin) {
      const angle = AimPredictor.angleDegrees(state.origin, state.target);
      values.textContent =
        `Target: (${state.sample.x.toFixed(1)}, ${state.sample.y.toFixed(1)})\n` +
        `Velocity: (${state.velocity.x.toFixed(1)}, ${state.velocity.y.toFixed(1)}) px/s\n` +
        `Predicted: (${state.target.x.toFixed(1)}, ${state.target.y.toFixed(1)})\n` +
        `Angle: ${angle.toFixed(2)}°`;
    } else {
      values.textContent = "No sample yet\nCall setObservation(...) with detected coordinates.";
    }
  }

  function draw() {
    if (!state.overlay || !state.overlayCtx) return;
    const ctx = state.overlayCtx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    if (state.showOverlay && state.sample && state.target) {
      const sourceRect = state.sourceCanvas
        ? state.sourceCanvas.getBoundingClientRect()
        : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

      // Observation coordinates are expected in source-canvas pixel coordinates.
      const sx = sourceRect.width / (state.sourceCanvas?.width || sourceRect.width);
      const sy = sourceRect.height / (state.sourceCanvas?.height || sourceRect.height);
      const tx = sourceRect.left + state.sample.x * sx;
      const ty = sourceRect.top + state.sample.y * sy;
      const px = sourceRect.left + state.target.x * sx;
      const py = sourceRect.top + state.target.y * sy;

      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(34, 197, 94, .95)";
      ctx.beginPath();
      ctx.arc(tx, ty, 7, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(248, 113, 113, .95)";
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(px, py);
      ctx.stroke();

      ctx.strokeStyle = "rgba(248, 113, 113, .95)";
      ctx.beginPath();
      ctx.moveTo(px - 9, py);
      ctx.lineTo(px + 9, py);
      ctx.moveTo(px, py - 9);
      ctx.lineTo(px, py + 9);
      ctx.stroke();
    }
    updatePanel();
  }

  function setObservation({ x, y, originX, originY, timestamp = performance.now() }) {
    const point = { x: Number(x), y: Number(y), timestamp: Number(timestamp) };
    if (![point.x, point.y, point.timestamp].every(Number.isFinite)) return;

    if (state.previous) {
      const dt = (point.timestamp - state.previous.timestamp) / 1000;
      if (dt > 0.001 && dt < 2) {
        const measuredVx = (point.x - state.previous.x) / dt;
        const measuredVy = (point.y - state.previous.y) / dt;
        // Mild smoothing reduces visual jitter.
        state.velocity.x = 0.65 * state.velocity.x + 0.35 * measuredVx;
        state.velocity.y = 0.65 * state.velocity.y + 0.35 * measuredVy;
      }
    }

    state.previous = point;
    state.sample = { x: point.x, y: point.y, timestamp: point.timestamp };
    state.origin = {
      x: Number.isFinite(Number(originX)) ? Number(originX) : point.x,
      y: Number.isFinite(Number(originY)) ? Number(originY) : point.y,
    };

    const seconds = state.horizonMs / 1000;
    state.target = {
      x: point.x + state.velocity.x * seconds,
      y: point.y + state.velocity.y * seconds,
    };
    state.status = "Receiving observations";
    draw();
  }

  function setCanvas(canvas) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError("setCanvas expects an HTMLCanvasElement");
    }
    state.sourceCanvas = canvas;
    state.status = "Canvas selected; waiting for observations";
    ensureUI();
    draw();
  }

  function start() {
    ensureUI();
    state.running = true;
    state.status = state.sourceCanvas
      ? "Running · waiting for observations"
      : "Running · no canvas selected";
    draw();
  }

  function stop() {
    state.running = false;
    state.status = "Stopped";
    if (state.overlayCtx) state.overlayCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    draw();
  }

  function setOrigin(x, y) {
    state.origin = { x: Number(x), y: Number(y) };
    draw();
  }

  function predict(position, velocity, horizonMs) {
    const t = Number(horizonMs) / 1000;
    return { x: position.x + velocity.x * t, y: position.y + velocity.y * t };
  }

  function angleRadians(from, to) {
    return Math.atan2(to.y - from.y, to.x - from.x);
  }

  function angleDegrees(from, to) {
    return angleRadians(from, to) * 180 / Math.PI;
  }

  window.AimPredictor = {
    start,
    stop,
    setCanvas,
    setObservation,
    setOrigin,
    predict,
    angleRadians,
    angleDegrees,
    getState: () => ({
      running: state.running,
      horizonMs: state.horizonMs,
      sample: state.sample ? { ...state.sample } : null,
      velocity: { ...state.velocity },
      predicted: state.target ? { ...state.target } : null,
      origin: state.origin ? { ...state.origin } : null,
      status: state.status,
    }),
  };
})();
