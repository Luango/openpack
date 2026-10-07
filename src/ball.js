// ball.js — the classic match ball (a truncated-icosahedron "Telstar" seen face-on
// down a pentagon axis), as path data in a 100×100 box: the centre pentagon, the
// five rim pentagons and the seams between the white hexagons. One geometry for
// every ball in the app — the floating backdrop balls (index.html, as an SVG data
// URI), the start-gate ball, and the balls rising through the 3D carousel.

export const BALL_CENTER = "M50.00 36.50 L62.84 45.83 L57.94 60.92 L42.06 60.92 L37.16 45.83 Z";
export const BALL_PANELS =
  "M50.00 25.50 L38.11 16.86 L42.65 2.89 L57.35 2.89 L61.89 16.86 Z " +
  "M73.30 42.43 L77.84 28.45 L92.54 28.45 L97.08 42.43 L85.19 51.07 Z " +
  "M64.40 69.82 L79.10 69.82 L83.64 83.80 L71.75 92.43 L59.86 83.80 Z " +
  "M35.60 69.82 L40.14 83.80 L28.25 92.43 L16.36 83.80 L20.90 69.82 Z " +
  "M26.70 42.43 L14.81 51.07 L2.92 42.43 L7.46 28.45 L22.16 28.45 Z";
export const BALL_SEAMS =
  "M50.00 36.50 L50.00 25.50 M62.84 45.83 L73.30 42.43 M57.94 60.92 L64.40 69.82 " +
  "M42.06 60.92 L35.60 69.82 M37.16 45.83 L26.70 42.43 M61.89 16.86 L77.84 28.45 " +
  "M85.19 51.07 L79.10 69.82 M59.86 83.80 L40.14 83.80 M20.90 69.82 L14.81 51.07 " +
  "M22.16 28.45 L38.11 16.86 M42.65 2.89 L42.30 0.60 M57.35 2.89 L57.70 0.60 " +
  "M92.54 28.45 L94.60 27.41 M97.08 42.43 L99.37 42.06 M83.64 83.80 L85.27 85.44 " +
  "M71.75 92.43 L72.81 94.50 M28.25 92.43 L27.19 94.50 M16.36 83.80 L14.73 85.44 " +
  "M2.92 42.43 L0.63 42.06 M7.46 28.45 L5.40 27.41";

// Draw the ball into a 2D context, filling the 100×100 box (transform it first).
export function drawBall(ctx, { body = "#e8eaef", panel = "#1b1c22", seam = "#8a8f9c", shade = false } = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(50, 50, 46, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, 100, 100);
  ctx.strokeStyle = seam;
  ctx.lineWidth = 1.6;
  ctx.stroke(new Path2D(BALL_SEAMS));
  ctx.fillStyle = panel;
  ctx.fill(new Path2D(BALL_PANELS));
  ctx.fill(new Path2D(BALL_CENTER));
  if (shade) {
    const g = ctx.createRadialGradient(36, 30, 0, 50, 50, 50);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.62, "rgba(0,0,0,0.05)");
    g.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 100, 100);
  }
  ctx.restore();
  ctx.strokeStyle = panel;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(50, 50, 45, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}
