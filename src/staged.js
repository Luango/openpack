// staged.js — the FIRST pack of a session is scripted.
//
// Every pack after the first is rolled from the pool (booster.js). The first one a
// player opens is a set piece: a Real Madrid hand that builds to Jude Bellingham's
// Team of the Year card — and that card plays a FILM. Once its print has stamped
// on (position, nation, club, stats, rating — NOT the name) the camera rushes into
// the empty frame and dips to black, the clip plays full screen (at 1.35×) and dips
// back to black, the black lifts on the card, and only then do the name and the
// player's portrait appear (reveal.js, cinema()). Card ids are `<player>-<edition>` as players.js
// builds them; the order here is the reveal order (rarest LAST, as a rolled pack).
//
// `?stage=0` opens a rolled pack first instead (for testing the ordinary flow).

export const FIRST_PACK = [
  "p92-bronze", // Endrick
  "p60-silver", // Brahim Díaz
  "p68-silver", // Bernardo Silva
  "p17-gold",   // Federico Valverde
  "p08-toty",   // Jude Bellingham — Team of the Year, the film
];

// card id → the film that plays out of its frame before the player appears.
// `seconds` is the clip's length (a fallback for an `ended` event that never comes).
export const CINEMATIC = {
  "p08-toty": { video: "assets/video/bellingham-toty.mp4", seconds: 10.08 },
};

export const stagingEnabled = () => new URLSearchParams(location.search).get("stage") !== "0";
