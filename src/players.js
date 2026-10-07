// players.js — the OpenPack FC squad: invented clubs, invented players.
//
// Every name, club and crest here is fictional (nations use their real flags).
// A player is a short row — name, nation, club, position, overall — and the
// rest is ROLLED deterministically from their id: face stats from a positional
// archetype, and a portrait look (skin, hair, facial hair, features). So the
// same player always renders the same card, and adding a player is one line.
//
// cardsFor() turns the squad into the collectible pool: each player's base card
// (Bronze < 65 ≤ Silver < 75 ≤ Gold, some golds Rare) plus the promo editions
// listed in PROMOS, each a boosted version of that player.

import { rng, shade } from "./paint.js";
import { SKIN, HAIR, EYES, HAIR_STYLES, BEARDS } from "./portrait.js";
import { TIERS, PROMO_TIER } from "./rarity.js";

export const SET_ID = "opfc26";
export const SET_NAME = "OpenPack FC · Ultimate XI";

// ---- clubs ---------------------------------------------------------------------
// colors: [primary, secondary, trim] · crest: shape/field/emblem · kit: shirt
export const CLUBS = {
  NVL: { name: "Northvale FC", short: "NVL", colors: ["#6cb4ee", "#ffffff", "#0b2a4a"], crest: { shape: "round", field: "plain", emblem: "star" }, kit: { pattern: "plain", collar: "crew" } },
  RCM: { name: "Real Castamar", short: "RCM", colors: ["#f7f6f2", "#d4af37", "#4b2a7a"], crest: { shape: "notched", field: "plain", emblem: "crown", band: true }, kit: { pattern: "plain", collar: "v" } },
  ASO: { name: "Atlético Solera", short: "ASO", colors: ["#d0202e", "#ffffff", "#14254a"], crest: { shape: "spanish", field: "stripes", emblem: "sun" }, kit: { pattern: "stripes", collar: "crew" } },
  KBU: { name: "Kestrel Bay United", short: "KBU", colors: ["#13294b", "#f28c28", "#ffffff"], crest: { shape: "modern", field: "plain", emblem: "wing" }, kit: { pattern: "plain", collar: "v" } },
  POA: { name: "Porto Aurelia", short: "POA", colors: ["#1d4ed8", "#ffffff", "#f2c94c"], crest: { shape: "heater", field: "stripes", emblem: "anchor" }, kit: { pattern: "halves", collar: "crew" } },
  SLU: { name: "Sporting Lumen", short: "SLU", colors: ["#128a4a", "#ffffff", "#f2c94c"], crest: { shape: "round", field: "hoops", emblem: "leaf" }, kit: { pattern: "hoops", collar: "crew" } },
  IVC: { name: "Inter Valcrest", short: "IVC", colors: ["#121417", "#12a39a", "#d8dde2"], crest: { shape: "hex", field: "stripes", emblem: "bolt" }, kit: { pattern: "stripes", collar: "v" } },
  EMC: { name: "Eastmere City", short: "EMC", colors: ["#7a1f3d", "#8ec5ec", "#ffffff"], crest: { shape: "heater", field: "plain", emblem: "tower", band: true }, kit: { pattern: "plain", collar: "polo" } },
  DKV: { name: "Dynamo Kovar", short: "DKV", colors: ["#1f3fbf", "#ffffff", "#e9eef7"], crest: { shape: "diamond", field: "plain", emblem: "star" }, kit: { pattern: "plain", collar: "crew" } },
  OLR: { name: "Olympique Rivage", short: "OLR", colors: ["#ffffff", "#0d2a66", "#4fb3ff"], crest: { shape: "modern", field: "sash", emblem: "wave" }, kit: { pattern: "sash", collar: "v" } },
  MBC: { name: "Montebrio Calcio", short: "MBC", colors: ["#c1121f", "#141414", "#f2c94c"], crest: { shape: "notched", field: "halves", emblem: "key" }, kit: { pattern: "halves", collar: "crew" } },
  BWR: { name: "Brightwater Rovers", short: "BWR", colors: ["#f4a300", "#151515", "#ffffff"], crest: { shape: "round", field: "plain", emblem: "trident" }, kit: { pattern: "plain", collar: "v" } },
  USL: { name: "Union Saint-Lys", short: "USL", colors: ["#ffd400", "#1d3c9e", "#ffffff"], crest: { shape: "heater", field: "chevron", emblem: "stars3" }, kit: { pattern: "chevron", collar: "crew" } },
  GSC: { name: "Galaxia SC", short: "GSC", colors: ["#5b2a86", "#f2c94c", "#ffffff"], crest: { shape: "hex", field: "plain", emblem: "sun" }, kit: { pattern: "plain", collar: "v" } },
  ZRN: { name: "FK Zarya Nord", short: "ZRN", colors: ["#f8f8f8", "#d2232a", "#1a1a1a"], crest: { shape: "spanish", field: "cross", emblem: "mountain" }, kit: { pattern: "pinstripe", collar: "crew" } },
  SVH: { name: "SV Hafenstadt", short: "SVH", colors: ["#0f6b3a", "#ffffff", "#ffffff"], crest: { shape: "round", field: "quarters", emblem: "ball" }, kit: { pattern: "pinstripe", collar: "polo" } },
  // the hall of fame every Legend card carries
  LGD: { name: "OpenPack Legends", short: "LGD", colors: ["#f3ead2", "#b8862b", "#c99a3a"], crest: { shape: "notched", field: "plain", emblem: "crown", band: true }, kit: { pattern: "plain", collar: "polo" } },
};
for (const [id, c] of Object.entries(CLUBS)) c.id = id;

// ---- the squad --------------------------------------------------------------------
// [id, full name, card name, nation, club, position, overall, age]
const SQUAD = [
  // golds
  ["p01", "Matéo Lavigne", "Lavigne", "FRA", "RCM", "ST", 88, 27],
  ["p02", "Caio Tavares", "Tavares", "BRA", "ASO", "LW", 87, 25],
  ["p03", "Lorenzo Ferrante", "Ferrante", "ITA", "MBC", "CB", 86, 29],
  ["p04", "Iker Montalbán", "Montalbán", "ESP", "RCM", "CM", 87, 28],
  ["p05", "Lukas Brenner", "Brenner", "GER", "SVH", "GK", 86, 30],
  ["p06", "Chidi Okonkwo", "Okonkwo", "NGA", "KBU", "ST", 85, 26],
  ["p07", "Bautista Ferreyra", "Ferreyra", "ARG", "POA", "CAM", 86, 24],
  ["p08", "Haruto Sakamoto", "Sakamoto", "JPN", "GSC", "RW", 84, 23],
  ["p09", "Daan Verbeek", "Verbeek", "NED", "OLR", "CB", 85, 27],
  ["p10", "Tiago Valente", "Valente", "POR", "POA", "RB", 84, 26],
  ["p11", "Harry Ashworth", "Ashworth", "ENG", "NVL", "CDM", 84, 29],
  ["p12", "Kauê", "Kauê", "BRA", "IVC", "CAM", 85, 22],
  ["p13", "Yassine Bennani", "Bennani", "MAR", "ASO", "LB", 83, 25],
  ["p14", "Kwame Asante", "Asante", "GHA", "EMC", "ST", 83, 28],
  ["p15", "Oskar Lindqvist", "Lindqvist", "SWE", "DKV", "CM", 82, 27],
  ["p16", "Arthur Vandamme", "Vandamme", "BEL", "OLR", "CAM", 83, 30],
  ["p17", "Diego Aranda", "Aranda", "MEX", "BWR", "CF", 82, 26],
  ["p18", "Luka Vrdoljak", "Vrdoljak", "CRO", "ZRN", "CM", 82, 31],
  ["p19", "Facundo Barrios", "Barrios", "URU", "MBC", "CB", 82, 28],
  ["p20", "Sindre Haugland", "Haugland", "NOR", "SVH", "ST", 84, 22],
  ["p21", "Seo Jun-ho", "Seo", "KOR", "KBU", "LW", 81, 24],
  ["p22", "Emre Yıldırım", "Yıldırım", "TUR", "GSC", "CAM", 81, 23],
  ["p23", "Yao Kouassi", "Kouassi", "CIV", "USL", "CDM", 81, 27],
  ["p24", "Mads Kjærgaard", "Kjærgaard", "DEN", "SLU", "GK", 82, 31],
  ["p25", "Tyler Brooks", "Brooks", "USA", "NVL", "RM", 80, 24],
  ["p26", "Unai Echeverri", "Echeverri", "ESP", "ASO", "RW", 80, 21],
  ["p27", "Jonas Heidrich", "Heidrich", "GER", "DKV", "CB", 80, 26],
  ["p28", "Gianluca Orsini", "Orsini", "ITA", "MBC", "LW", 79, 25],
  ["p29", "Joël Mbarga", "Mbarga", "CMR", "EMC", "CB", 79, 29],
  ["p30", "Rúben Carvalhal", "Carvalhal", "POR", "SLU", "CM", 79, 24],
  ["p31", "Tomás Echagüe", "Echagüe", "ARG", "BWR", "ST", 78, 20],
  ["p32", "Kacper Wróblewski", "Wróblewski", "POL", "ZRN", "GK", 78, 28],
  ["p33", "Cheikh Ndour", "Ndour", "SEN", "IVC", "CDM", 78, 26],
  ["p34", "Noah Brügger", "Brügger", "SUI", "USL", "RB", 77, 25],
  ["p35", "Andrés Mosquera Lugo", "Lugo", "COL", "KBU", "RW", 77, 19],
  // silvers
  ["p36", "Yanis Delorme", "Delorme", "FRA", "OLR", "LB", 74, 22],
  ["p37", "Pablo Arrieta", "Arrieta", "ESP", "USL", "CM", 73, 26],
  ["p38", "Lucas Fontoura", "Fontoura", "BRA", "GSC", "ST", 74, 19],
  ["p39", "Matteo Salvi", "Salvi", "ITA", "SLU", "CB", 72, 27],
  ["p40", "Felix Ostermann", "Ostermann", "GER", "SVH", "CDM", 73, 24],
  ["p41", "Sem de Graaf", "De Graaf", "NED", "DKV", "RW", 72, 20],
  ["p42", "Callum Pryce", "Pryce", "ENG", "EMC", "GK", 73, 27],
  ["p43", "Fraser McKinnon", "McKinnon", "SCO", "NVL", "CM", 71, 25],
  ["p44", "Cian Mulvaney", "Mulvaney", "IRL", "BWR", "CB", 71, 28],
  ["p45", "Emeka Adebayo", "Adebayo", "NGA", "ZRN", "LW", 72, 21],
  ["p46", "Kofi Mensah", "Mensah", "GHA", "KBU", "CM", 70, 23],
  ["p47", "Ilias Amrani", "Amrani", "MAR", "OLR", "RM", 71, 22],
  ["p48", "Amine Belkacem", "Belkacem", "ALG", "ASO", "CAM", 72, 26],
  ["p49", "Omar Fathy", "Fathy", "EGY", "IVC", "ST", 73, 27],
  ["p50", "Ren Takeda", "Takeda", "JPN", "POA", "LM", 70, 24],
  ["p51", "Han Ji-woo", "Han", "KOR", "GSC", "CB", 69, 26],
  ["p52", "Mason Whitfield", "Whitfield", "USA", "SLU", "RB", 70, 23],
  ["p53", "Liam Gagnon", "Gagnon", "CAN", "NVL", "ST", 71, 20],
  ["p54", "Emiliano Ríos", "Ríos", "MEX", "MBC", "LB", 69, 25],
  ["p55", "Benjamín Araya", "Araya", "CHI", "BWR", "CDM", 68, 29],
  ["p56", "Renato Cárdenas", "Cárdenas", "PER", "USL", "GK", 68, 30],
  ["p57", "Kerem Aydın", "Aydın", "TUR", "ZRN", "RW", 70, 21],
  ["p58", "Nikos Papadakis", "Papadakis", "GRE", "EMC", "CB", 69, 31],
  ["p59", "Tomáš Novotný", "Novotný", "CZE", "DKV", "CM", 68, 27],
  ["p60", "Bence Farkas", "Farkas", "HUN", "SVH", "CAM", 70, 23],
  ["p61", "Andriy Melnyk", "Melnyk", "UKR", "IVC", "LB", 69, 26],
  ["p62", "Kemar Whyte", "Whyte", "JAM", "KBU", "ST", 68, 24],
  ["p63", "Aleksi Virtanen", "Virtanen", "FIN", "RCM", "GK", 67, 33],
  ["p64", "Eirik Vatne", "Vatne", "NOR", "OLR", "CB", 67, 22],
  ["p65", "Serge Bamba", "Bamba", "CIV", "GSC", "RW", 66, 25],
  // bronzes
  ["p66", "Théo Vasseur", "Vasseur", "FRA", "ZRN", "CM", 64, 19],
  ["p67", "Hugo Saldaña", "Saldaña", "ESP", "BWR", "RB", 63, 24],
  ["p68", "Davi Seixas", "Seixas", "BRA", "USL", "LW", 64, 18],
  ["p69", "Davide Ruggeri", "Ruggeri", "ITA", "EMC", "GK", 62, 32],
  ["p70", "Niklas Vogt", "Vogt", "GER", "NVL", "CB", 61, 26],
  ["p71", "Bram Koster", "Koster", "NED", "SVH", "ST", 63, 21],
  ["p72", "Reece Holloway", "Holloway", "ENG", "KBU", "LB", 60, 23],
  ["p73", "Euan Rattray", "Rattray", "SCO", "SLU", "CDM", 59, 30],
  ["p74", "Tobi Afolabi", "Afolabi", "NGA", "DKV", "RM", 62, 20],
  ["p75", "Viktor Engström", "Engström", "SWE", "MBC", "CB", 60, 27],
  ["p76", "Rasmus Holt", "Holt", "DEN", "OLR", "CM", 61, 22],
  ["p77", "Jakub Lisowski", "Lisowski", "POL", "RCM", "ST", 62, 19],
  ["p78", "Tobias Grabner", "Grabner", "AUT", "ASO", "GK", 58, 29],
  ["p79", "Ivan Šarić", "Šarić", "CRO", "IVC", "RW", 59, 24],
  ["p80", "Santino Larrea", "Larrea", "ARG", "GSC", "CB", 57, 18],
  ["p81", "Agustín Techera", "Techera", "URU", "ZRN", "LM", 58, 25],
  ["p82", "Duarte Pires", "Pires", "POR", "EMC", "CAM", 60, 20],
  ["p83", "Moussa Ndiongue", "Ndiongue", "SEN", "BWR", "ST", 57, 22],
  ["p84", "Jayden Mensah-Clarke", "Mensah-Clarke", "ENG", "USL", "LW", 56, 18],
  ["p85", "Enzo Fabre", "Fabre", "FRA", "POA", "CDM", 55, 27],
  // legends — retired greats of the OpenPack hall of fame
  ["l01", "Didier Valbonne", "Valbonne", "FRA", "LGD", "ST", 94, 38],
  ["l02", "Rui Monteverde", "Monteverde", "POR", "LGD", "CAM", 93, 40],
  ["l03", "Jürgen Falkenrath", "Falkenrath", "GER", "LGD", "GK", 92, 44],
  ["l04", "Ezequiel Barragán", "Barragán", "ARG", "LGD", "CF", 95, 41],
  ["l05", "Paolo Castelvecchi", "Castelvecchi", "ITA", "LGD", "CB", 92, 46],
  ["l06", "Kwabena Ofori", "Ofori", "GHA", "LGD", "CDM", 90, 42],
  ["l07", "Henrik Strandberg", "Strandberg", "SWE", "LGD", "LW", 89, 43],
  ["l08", "Leonel Amarante", "Amarante", "BRA", "LGD", "RW", 96, 39],
];

// promo editions: player id → [edition, overall boost]
const PROMOS = [
  // Team of the Week (in-form)
  ["p14", "totw", 2], ["p17", "totw", 3], ["p21", "totw", 3], ["p23", "totw", 2], ["p27", "totw", 3], ["p30", "totw", 3],
  ["p33", "totw", 3], ["p37", "totw", 4], ["p45", "totw", 4], ["p49", "totw", 3], ["p15", "totw", 2], ["p42", "totw", 4],
  // Player of the Match
  ["p06", "potm", 3], ["p13", "potm", 3], ["p16", "potm", 3], ["p19", "potm", 4], ["p25", "potm", 4], ["p28", "potm", 4],
  ["p48", "potm", 5], ["p36", "potm", 5], ["p11", "potm", 3], ["p34", "potm", 5],
  // Future Stars — the youngest breakouts get the biggest jumps
  ["p12", "future", 5], ["p26", "future", 7], ["p31", "future", 8], ["p35", "future", 9], ["p38", "future", 9],
  ["p41", "future", 9], ["p53", "future", 9], ["p68", "future", 16], ["p84", "future", 18],
  // Team of the Season
  ["p02", "tots", 5], ["p07", "tots", 5], ["p09", "tots", 5], ["p10", "tots", 6], ["p20", "tots", 6],
  ["p22", "tots", 7], ["p24", "tots", 6], ["p18", "tots", 6], ["p08", "tots", 6],
  // Team of the Year — a full XI
  ["p05", "toty", 7], ["p10", "toty", 8], ["p03", "toty", 7], ["p09", "toty", 7], ["p13", "toty", 8],
  ["p04", "toty", 7], ["p11", "toty", 8], ["p07", "toty", 8], ["p02", "toty", 7], ["p01", "toty", 7], ["p06", "toty", 8],
];

// ---- rolling stats ------------------------------------------------------------------
// offsets from overall: PAC SHO PAS DRI DEF PHY (keepers: DIV HAN KIC REF SPD POS)
const ARCH = {
  ST: [4, 6, -6, 2, -45, 2], CF: [2, 5, 1, 5, -46, -4],
  LW: [8, 1, -2, 6, -48, -12], RW: [8, 1, -2, 6, -48, -12],
  LM: [6, -4, 2, 4, -30, -8], RM: [6, -4, 2, 4, -30, -8],
  CAM: [1, 1, 5, 6, -40, -12], CM: [-4, -6, 4, 2, -6, -2], CDM: [-10, -14, -2, -6, 3, 4],
  LB: [5, -24, -6, -4, 1, -3], RB: [5, -24, -6, -4, 1, -3],
  CB: [-10, -38, -18, -20, 4, 5], GK: [2, 1, -10, 3, -18, -4],
};

// soft-capped near the top so boosted promos land in the high 90s without a wall of 99s
const clampStat = (v) => Math.max(18, Math.min(99, Math.round(v > 93 ? 93 + (v - 93) * 0.45 : v)));

function rollStats(row, boost = 0, salt = "") {
  const [id, , , , , pos, ovr] = row;
  const r = rng(id + "stats" + salt);
  return ARCH[pos].map((off) => clampStat(ovr + off + r.range(-3, 3) + boost * r.range(0.8, 1.35)));
}

// ---- rolling a look -------------------------------------------------------------------

function weighted(r, table) {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let x = r() * total;
  for (const [v, w] of table) if ((x -= w) < 0) return v;
  return table[0][0];
}

function rollLook(row) {
  const [id, , , , , , , age] = row;
  const r = rng(id + "look");
  const veteran = age >= 33;
  const hair = veteran && r.chance(0.55)
    ? HAIR.grey
    : weighted(r, [[HAIR.black, 30], [HAIR.darkbrown, 24], [HAIR.brown, 17], [HAIR.lightbrown, 8], [HAIR.dirtyblond, 7], [HAIR.blond, 6], [HAIR.platinum, 3], [HAIR.auburn, 3]]);
  let hairStyle = r.pick(HAIR_STYLES);
  if (veteran && r.chance(0.4)) hairStyle = r.pick(["bald", "buzz", "slick", "crop", "sidepart"]);
  let beard = weighted(r, BEARDS);
  if (age <= 20 && (beard === "full" || beard === "short")) beard = "stubble";
  return {
    seed: r.int(1, 1e6),
    skin: r.pick(SKIN),
    hair,
    hairStyle,
    beard,
    eyes: weighted(r, [[EYES[0], 45], [EYES[1], 25], [EYES[2], 12], [EYES[3], 6], [EYES[4], 8], [EYES[5], 4]]),
    jaw: r(), face: r(), nose: r(), lips: r(), smile: r.range(0, 0.7),
    browThick: r(), browArch: r(), cranium: r(), neck: r(),
    headband: hairStyle === "long" && r.chance(0.35) ? r.pick(["#ffffff", "#111111", "#e23b3b", "#2f6fe0"]) : null,
  };
}

// ---- cards -------------------------------------------------------------------------------

function baseEdition(ovr, id) {
  if (ovr < 65) return "bronze";
  if (ovr < 75) return "silver";
  // roughly a third of golds are Rare — fixed per player
  return rng(id + "rare")() < 0.38 ? "raregold" : "gold";
}

const TIER_OF = Object.fromEntries(TIERS.map((t) => [t.key, t.id]));

function makeCard(row, edition, boost, n) {
  const [id, full, display, nation, clubId, pos, ovr] = row;
  const tier = TIER_OF[edition];
  const club = CLUBS[clubId];
  const look = rollLook(row);
  const [primary, secondary, trim] = club.colors;
  return {
    id: `${id}-${edition}`,
    playerId: id,
    number: String(n),
    name: full,
    display,
    rarity: TIERS[tier].label,
    tier,
    edition,
    markLabel: tier >= PROMO_TIER ? TIERS[tier].short : null,
    ovr: Math.min(99, ovr + boost),
    pos,
    nation,
    club,
    stats: rollStats(row, boost, edition),
    look,
    kit: {
      primary,
      secondary,
      trim: club.kit.collar === "v" || club.kit.pattern === "plain" ? secondary : trim,
      pattern: club.kit.pattern,
      collar: club.kit.collar,
      club,
    },
    seed: n * 7919,
    set: SET_NAME,
    setId: SET_ID,
    image: null,
    imageSmall: null,
  };
}

function buildPool() {
  const byId = new Map(SQUAD.map((row) => [row[0], row]));
  const cards = [];
  let n = 1;
  for (const row of SQUAD) {
    const ed = row[0].startsWith("l") ? "legend" : baseEdition(row[6], row[0]);
    cards.push(makeCard(row, ed, 0, n++));
  }
  for (const [pid, ed, boost] of PROMOS) cards.push(makeCard(byId.get(pid), ed, boost, n++));
  return cards;
}

export const POOL = buildPool();

// a darker sibling of a club colour — handy for UI accents keyed to a club
export const clubShade = (club, amt = -0.3) => shade(club.colors[0], amt);
