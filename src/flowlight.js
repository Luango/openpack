// flowlight.js — a WebGL "流光" (flowing light) along the tear seam.
//
// The old glow was a flat constant-width polygon, so the light read as a dead
// ribbon. This renders a luminous streak whose WIDTH FLOWS AND BREATHES along its
// length over time, with bright pulses travelling down the seam — the GPU does the
// soft cross-section glow falloff + the animation. The centreline is the tear path;
// the width is modulated by travelling sines (so it bulges and pinches, and the
// bulges move), and an overall breath swells the whole thing.
//
// Caller contract (createFlowLight returns null when WebGL is unavailable, so the
// host can fall back to its SVG glow):
//   const fl = createFlowLight(canvasEl);
//   fl.setViewBox(w, h);                 // the tear path's coordinate box
//   fl.resize();                         // size backing store to the canvas's CSS box
//   fl.setPath(points, openW);           // points in viewBox coords; openW drives intensity
//   fl.stop();                           // clear + halt the loop (on split / reset)

const VERT = `
attribute vec2 aPos;     // viewBox coords
attribute float aU;      // 0..1 along the seam
attribute float aV;      // -1..1 across the ribbon
attribute float aTaper;  // per-vertex intensity (end taper * open amount)
uniform vec2 uVB;        // viewBox size
varying float vU; varying float vV; varying float vTaper;
void main() {
  vU = aU; vV = aV; vTaper = aTaper;
  vec2 clip = vec2(aPos.x / uVB.x * 2.0 - 1.0, 1.0 - aPos.y / uVB.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying float vU; varying float vV; varying float vTaper;
uniform float uTime;
void main() {
  // cross-section, two layers: a BROAD luminous body that bleeds out of the seam,
  // plus a thin SEARING filament riding down its centre (the white-hot core).
  float edge = max(0.0, 1.0 - abs(vV));
  float body = pow(edge, 1.6);  // wider soft halo (was pow(..,2.2) → tight & dim)
  float hot  = pow(edge, 6.0);  // the white-hot filament inside it
  // travelling pulses down the seam — the "流" (flow): bright packets sliding along
  float streak = 0.5 + 0.5 * sin(vU * 30.0 - uTime * 7.5);
  streak *= 0.6 + 0.4 * sin(vU * 11.0 - uTime * 3.3); // a second, slower train for life
  // sharp glints RACING down the rip — discrete bright packets; the exciting punch
  float glint = pow(0.5 + 0.5 * sin(vU * 18.85 - uTime * 10.0), 6.0);
  // a global breath so the whole streak pulses even when you hold still
  float breathe = 0.85 + 0.2 * sin(uTime * 2.6);
  float i = body * (1.0 + 1.2 * streak) * breathe * vTaper; // brighter base + bigger gain
  i += body * glint * 1.6 * vTaper;  // racing glints
  i += hot * 1.1 * vTaper;           // ever-present white-hot filament
  vec3 gold  = vec3(1.0, 0.80, 0.38);
  vec3 white = vec3(1.0, 1.0, 0.96);
  vec3 col = mix(gold, white, pow(edge, 1.4));  // goes white-hot well before the centre
  col += hot * vec3(0.5, 0.5, 0.55);            // overdrive the filament past white → blooms on screen-blend
  gl_FragColor = vec4(col * i, i); // additive (blendFunc SRC_ALPHA, ONE) → on-screen ≈ col*i²
}`;

const W0 = 38; // base half-width of the glow halo, in viewBox units (soft falloff trims it)
const GAP = 10; // matches pack.js GAP_TEAR — openW is normalised against this

export function createFlowLight(canvas) {
  let gl;
  try {
    gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true, antialias: true })
      || canvas.getContext("experimental-webgl", { premultipliedAlpha: false, alpha: true, antialias: true });
  } catch {
    return null;
  }
  if (!gl) return null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("flowlight: shader compile failed —", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("flowlight: link failed —", gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);

  const aPos = gl.getAttribLocation(prog, "aPos");
  const aU = gl.getAttribLocation(prog, "aU");
  const aV = gl.getAttribLocation(prog, "aV");
  const aTaper = gl.getAttribLocation(prog, "aTaper");
  const uVB = gl.getUniformLocation(prog, "uVB");
  const uTime = gl.getUniformLocation(prog, "uTime");

  const buf = gl.createBuffer();
  const STRIDE = 5 * 4; // x,y,u,v,taper
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, STRIDE, 0);
  gl.enableVertexAttribArray(aU);
  gl.vertexAttribPointer(aU, 1, gl.FLOAT, false, STRIDE, 8);
  gl.enableVertexAttribArray(aV);
  gl.vertexAttribPointer(aV, 1, gl.FLOAT, false, STRIDE, 12);
  gl.enableVertexAttribArray(aTaper);
  gl.vertexAttribPointer(aTaper, 1, gl.FLOAT, false, STRIDE, 16);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive — light accumulates
  gl.clearColor(0, 0, 0, 0);

  const COARSE = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  let vb = { w: 300, h: 500 };
  let path = [];
  let openW = 0;
  let raf = null;
  let t0 = null;
  let lost = false;

  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); lost = true; stop(); });

  function setViewBox(w, h) { if (w && h) vb = { w, h }; }

  function resize() {
    // Render the backing store at the REAL device pixel ratio. The glow is a single
    // soft-falloff ribbon — cheap even at 2–3×. The old `COARSE ? 1` forced the canvas
    // to 1× on phones (DPR 2–3), so the CSS `width:100%` stretch upsampled the gradient
    // → the visible "马赛克"/blocky halo. Cap at 2.5 so a 3× phone stays bounded.
    const dpr = Math.min(COARSE ? 2.5 : 2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  // Build the flowing-width ribbon mesh (a triangle strip) for time `t` seconds.
  function buildMesh(t) {
    const n = path.length;
    if (n < 2) return null;
    const cum = [0];
    let total = 0;
    for (let i = 1; i < n; i++) {
      total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      cum.push(total);
    }
    if (total < 1) return null;
    const open = Math.max(0, Math.min(1, openW / GAP));
    const verts = new Float32Array(n * 2 * 5);
    let o = 0;
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(n - 1, i + 1)];
      let nx = -(b.y - a.y);
      let ny = b.x - a.x;
      const L = Math.hypot(nx, ny) || 1;
      nx /= L; ny /= L;
      const s = cum[i] / total; // 0..1 along the seam
      // flowing width: two travelling sines → bulges + pinches that MOVE over time
      let flow = 0.5 + 0.34 * Math.sin(s * 9.0 - t * 3.0) + 0.18 * Math.sin(s * 17.0 + t * 2.0 + 1.7);
      flow = Math.max(0.3, Math.min(1.0, flow)); // higher floor → no thin/dead stretches
      // taper to a point at the finger tip (last ~30%), like a real crack pinching shut
      const tip = s < 0.7 ? 1 : Math.max(0, 1 - (s - 0.7) / 0.3);
      const hw = W0 * flow * tip * (0.65 + 0.35 * open);     // wider halo, even early in the rip
      const taper = (0.5 + 0.5 * open) * tip;                // already bright at first contact
      const px = path[i].x;
      const py = path[i].y;
      verts[o++] = px + nx * hw; verts[o++] = py + ny * hw; verts[o++] = s; verts[o++] = -1; verts[o++] = taper;
      verts[o++] = px - nx * hw; verts[o++] = py - ny * hw; verts[o++] = s; verts[o++] = 1; verts[o++] = taper;
    }
    return verts;
  }

  function frame(ts) {
    if (lost) { raf = null; return; }
    if (t0 == null) t0 = ts;
    const t = (ts - t0) / 1000;
    gl.clear(gl.COLOR_BUFFER_BIT);
    const mesh = buildMesh(t);
    if (mesh) {
      gl.uniform2f(uVB, vb.w, vb.h);
      gl.uniform1f(uTime, t);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, mesh.length / 5);
    }
    raf = requestAnimationFrame(frame);
  }

  function setPath(pts, w) {
    path = pts || [];
    openW = w || 0;
    if (!lost && path.length >= 2 && raf == null) raf = requestAnimationFrame(frame);
  }

  function stop() {
    path = [];
    openW = 0;
    if (raf != null) { cancelAnimationFrame(raf); raf = null; }
    t0 = null;
    try { gl.clear(gl.COLOR_BUFFER_BIT); } catch { /* context gone */ }
  }

  return { setViewBox, resize, setPath, stop };
}
