// players.js — the OpenPack FC squad: real players, real clubs, real photos.
//
// A player is a short row — name, nation, club, position, overall — and the
// face stats are ROLLED deterministically from their id off a positional
// archetype, so the same player always renders the same card. Ratings are our
// own, not any game's. Each player's portrait is a freely licensed Wikimedia
// Commons photo, cut out and cropped by tools/players (assets/players/<id>.webp;
// credits in photos.js) — adding a player is one row here + one in
// tools/players/roster.py, then a re-run of that pipeline. Clubs follow each
// player's Wikipedia infobox as of October 2026.
//
// Club badges are NOT the clubs' crests (those are trademarks): every club
// carries a plain monogram badge in its colours (emblems.js drawCrest).
//
// buildPool() turns the squad into the collectible pool: each player's base card
// (Bronze < 65 ≤ Silver < 75 ≤ Gold, the marquee golds Rare) plus the promo
// editions listed in PROMOS, each a boosted version of that player.

import { rng, shade } from "./paint.js";
import { TIERS, PROMO_TIER } from "./rarity.js";

export const SET_ID = "opfc26";
export const SET_NAME = "OpenPack FC · Ultimate XI";

// ---- clubs ---------------------------------------------------------------------
// colors: [primary, secondary, trim] · crest: badge shape + field (monogram on top)
const club = (name, short, colors, shape = "round", field = "plain") =>
  ({ name, short, colors, crest: { shape, field, emblem: "monogram" } });

export const CLUBS = {
  RMA: club("Real Madrid", "RMA", ["#f4f4f4", "#00529f", "#febe10"]),
  MCI: club("Manchester City", "MCI", ["#6cabdd", "#ffffff", "#1c2c5b"]),
  PSG: club("Paris Saint-Germain", "PSG", ["#004170", "#da291c", "#ffffff"]),
  BAR: club("FC Barcelona", "FCB", ["#a50044", "#004d98", "#edbb00"], "heater", "stripes"),
  BAY: club("Bayern Munich", "FCB", ["#dc052d", "#ffffff", "#0066b2"]),
  TRA: club("Trabzonspor", "TS", ["#8c1d40", "#5bb6e8", "#ffffff"], "heater", "stripes"),
  LIV: club("Liverpool", "LFC", ["#c8102e", "#f6eb61", "#00b2a9"], "heater"),
  ARS: club("Arsenal", "AFC", ["#ef0107", "#ffffff", "#9c824a"], "heater"),
  INT: club("Inter Milan", "INT", ["#0068a8", "#111111", "#d4af37"], "round", "stripes"),
  MUN: club("Manchester United", "MUFC", ["#da291c", "#111111", "#fbe122"], "heater"),
  MIA: club("Inter Miami", "MIA", ["#f7b5cd", "#231f20", "#ffffff"]),
  NAS: club("Al-Nassr", "NAS", ["#fcd116", "#1d3d8f", "#ffffff"]),
  LAF: club("Los Angeles FC", "LAFC", ["#111111", "#c39e6d", "#ffffff"], "heater"),
  GAL: club("Galatasaray", "GS", ["#a90432", "#fdb912", "#ffffff"], "round", "halves"),
  MIL: club("AC Milan", "ACM", ["#fb090b", "#111111", "#ffffff"], "spanish", "stripes"),
  BHA: club("Brighton & Hove Albion", "BHA", ["#0057b8", "#ffffff", "#ffcd00"]),
  CHE: club("Chelsea", "CFC", ["#034694", "#ffffff", "#dba111"]),
  CHF: club("Chicago Fire", "CF", ["#c8102e", "#0a174a", "#ffffff"], "modern"),
  NAP: club("Napoli", "NAP", ["#12a0d7", "#ffffff", "#003c82"]),
  ATH: club("Athletic Club", "ATH", ["#ee2523", "#ffffff", "#111111"], "heater", "stripes"),
  JUV: club("Juventus", "JUV", ["#111111", "#ffffff", "#c9a227"], "modern", "stripes"),
  ORL: club("Orlando City", "OCSC", ["#633492", "#fde192", "#ffffff"], "modern"),
  RSO: club("Real Sociedad", "RSO", ["#0067b1", "#ffffff", "#e4b630"], "round", "stripes"),
  TOT: club("Tottenham Hotspur", "THFC", ["#ffffff", "#132257", "#132257"], "modern"),
  ATM: club("Atlético Madrid", "ATM", ["#cb3524", "#ffffff", "#262f61"], "heater", "stripes"),
  FEN: club("Fenerbahçe", "FB", ["#ffed00", "#00205b", "#ffffff"], "round", "stripes"),
  VAN: club("Vancouver Whitecaps", "VAN", ["#00245d", "#9dc2ea", "#ffffff"]),
  LIL: club("Lille", "LOSC", ["#e01e13", "#ffffff", "#20325f"], "modern"),
  ROS: club("Rosario Central", "RC", ["#0d3d8c", "#fde100", "#ffffff"], "spanish", "stripes"),
  NAC: club("Atlético Nacional", "NAL", ["#00a046", "#ffffff", "#111111"], "heater", "stripes"),
  BUR: club("Burnley", "BFC", ["#6c1d45", "#99d6ea", "#ffffff"], "heater"),
  SHB: club("Al-Shabab", "SHB", ["#ffffff", "#1d1d1d", "#1d1d1d"]),
  OLY: club("Olympiacos", "OLY", ["#e2001a", "#ffffff", "#e2001a"], "round", "stripes"),
  BAS: club("FC Basel", "FCB", ["#d6001c", "#1d3a8a", "#ffffff"], "heater", "halves"),
  WOL: club("Wolverhampton Wanderers", "WOL", ["#fdb913", "#231f20", "#ffffff"], "modern"),
  LAG: club("LA Galaxy", "LAG", ["#00245d", "#ffd200", "#ffffff"]),
  MTL: club("CF Montréal", "MTL", ["#0033a1", "#111111", "#ffffff"]),
  COR: club("Corinthians", "SCCP", ["#ffffff", "#111111", "#111111"]),
  PSV: club("PSV Eindhoven", "PSV", ["#ed1c24", "#ffffff", "#111111"], "heater", "stripes"),
  SAD: club("Al-Sadd", "SAD", ["#ffffff", "#111111", "#b8962e"]),
  HJK: club("HJK Helsinki", "HJK", ["#0033a0", "#ffffff", "#ffffff"]),
  BOU: club("Bournemouth", "AFCB", ["#da291c", "#111111", "#ffffff"], "heater", "stripes"),
  ATA: club("Atalanta", "ATA", ["#1e71b8", "#111111", "#ffffff"], "heater", "stripes"),
  ITT: club("Al-Ittihad", "ITT", ["#ffcc00", "#111111", "#ffffff"], "round", "stripes"),
  CRY: club("Crystal Palace", "CPFC", ["#1b458f", "#c4122e", "#ffffff"], "heater", "halves"),
  DOR: club("Borussia Dortmund", "BVB", ["#fde100", "#111111", "#ffffff"]),
  FLU: club("Fluminense", "FLU", ["#870a28", "#006140", "#ffffff"], "heater", "stripes"),
  // the hall of fame every Legend card carries
  LGD: { name: "OpenPack Legends", short: "LGD", colors: ["#f3ead2", "#b8862b", "#c99a3a"], crest: { shape: "notched", field: "plain", emblem: "crown", band: true } },
};
for (const [id, c] of Object.entries(CLUBS)) c.id = id;

// ---- the squad --------------------------------------------------------------------
// [id, full name, card name, nation, club, position, overall, rare?]
const SQUAD = [
  // golds — the marquee names come Rare
  ["p01", "Kylian Mbappé", "Mbappé", "FRA", "RMA", "ST", 91, 1],
  ["p02", "Erling Haaland", "Haaland", "NOR", "MCI", "ST", 91, 1],
  ["p03", "Ousmane Dembélé", "Dembélé", "FRA", "PSG", "RW", 90, 1],
  ["p04", "Lamine Yamal", "Lamine Yamal", "ESP", "BAR", "RW", 90, 1],
  ["p05", "Harry Kane", "Kane", "ENG", "BAY", "ST", 90, 1],
  ["p06", "Mohamed Salah", "Salah", "EGY", "TRA", "RW", 88, 1],
  ["p07", "Vinícius Júnior", "Vini Jr.", "BRA", "RMA", "LW", 89, 1],
  ["p08", "Jude Bellingham", "Bellingham", "ENG", "RMA", "CAM", 89, 1],
  ["p09", "Rodri", "Rodri", "ESP", "BAR", "CDM", 88, 1],
  ["p10", "Pedri", "Pedri", "ESP", "BAR", "CM", 89, 1],
  ["p11", "Virgil van Dijk", "Van Dijk", "NED", "LIV", "CB", 88, 1],
  ["p12", "Thibaut Courtois", "Courtois", "BEL", "RMA", "GK", 89, 1],
  ["p13", "Achraf Hakimi", "Hakimi", "MAR", "PSG", "RB", 88],
  ["p14", "Florian Wirtz", "Wirtz", "GER", "LIV", "CAM", 87],
  ["p15", "Jamal Musiala", "Musiala", "GER", "BAY", "CAM", 87],
  ["p16", "Bukayo Saka", "Saka", "ENG", "ARS", "RW", 88],
  ["p17", "Federico Valverde", "Valverde", "URU", "RMA", "CM", 88],
  ["p18", "Lautaro Martínez", "Lautaro", "ARG", "INT", "ST", 88],
  ["p19", "Raphinha", "Raphinha", "BRA", "BAR", "LW", 89, 1],
  ["p20", "Vitinha", "Vitinha", "POR", "PSG", "CM", 88],
  ["p21", "Gianluigi Donnarumma", "Donnarumma", "ITA", "MCI", "GK", 89],
  ["p22", "Declan Rice", "Rice", "ENG", "ARS", "CM", 87],
  ["p23", "William Saliba", "Saliba", "FRA", "ARS", "CB", 87],
  ["p24", "Bruno Fernandes", "B. Fernandes", "POR", "MUN", "CAM", 86],
  ["p25", "Joshua Kimmich", "Kimmich", "GER", "BAY", "CM", 87],
  ["p26", "Martin Ødegaard", "Ødegaard", "NOR", "ARS", "CAM", 86],
  ["p27", "Lionel Messi", "Messi", "ARG", "MIA", "RW", 87, 1],
  ["p28", "Cristiano Ronaldo", "C. Ronaldo", "POR", "NAS", "ST", 85, 1],
  ["p29", "Son Heung-min", "Son", "KOR", "LAF", "LW", 84],
  ["p30", "Victor Osimhen", "Osimhen", "NGA", "GAL", "ST", 86],
  ["p31", "Alessandro Bastoni", "Bastoni", "ITA", "INT", "CB", 86],
  ["p32", "Alisson Becker", "Alisson", "BRA", "LIV", "GK", 88],
  ["p33", "Luka Modrić", "Modrić", "CRO", "MIL", "CM", 85],
  ["p34", "Christian Pulisic", "Pulisic", "USA", "MIL", "RW", 84],
  ["p35", "Kaoru Mitoma", "Mitoma", "JPN", "BHA", "LW", 82],
  ["p36", "Alexander Isak", "Isak", "SWE", "LIV", "ST", 86],
  ["p37", "Cole Palmer", "Palmer", "ENG", "CHE", "CAM", 86],
  ["p38", "Joško Gvardiol", "Gvardiol", "CRO", "MCI", "CB", 86],
  ["p39", "Michael Olise", "Olise", "FRA", "BAY", "RW", 88],
  ["p40", "Robert Lewandowski", "Lewandowski", "POL", "CHF", "ST", 85],
  ["p41", "Alphonso Davies", "Davies", "CAN", "BAY", "LB", 84],
  ["p42", "Kevin De Bruyne", "De Bruyne", "BEL", "NAP", "CM", 86],
  ["p43", "Pau Cubarsí", "Cubarsí", "ESP", "BAR", "CB", 85],
  ["p44", "Nuno Mendes", "Nuno Mendes", "POR", "PSG", "LB", 87],
  ["p45", "Nico Williams", "Nico Williams", "ESP", "ATH", "LW", 85],
  ["p46", "Arda Güler", "Arda Güler", "TUR", "RMA", "CAM", 84],
  ["p47", "Désiré Doué", "Doué", "FRA", "PSG", "RW", 85],
  ["p48", "Manuel Neuer", "Neuer", "GER", "BAY", "GK", 86],
  ["p49", "Antoine Griezmann", "Griezmann", "FRA", "ORL", "CF", 84],
  ["p50", "Jules Koundé", "Koundé", "FRA", "BAR", "RB", 85],
  ["p51", "Takefusa Kubo", "Kubo", "JPN", "RSO", "RW", 81],
  ["p52", "Sadio Mané", "Mané", "SEN", "NAS", "LW", 82],
  ["p53", "Mohammed Kudus", "Kudus", "GHA", "TOT", "RW", 82],
  ["p54", "Jonathan David", "J. David", "CAN", "ATM", "ST", 83],
  ["p55", "Casemiro", "Casemiro", "BRA", "MIA", "CDM", 82],
  ["p56", "N'Golo Kanté", "Kanté", "FRA", "FEN", "CDM", 82],
  // silvers — the old guard, and the steady pros
  ["p57", "Thomas Müller", "Müller", "GER", "VAN", "CAM", 74],
  ["p58", "Olivier Giroud", "Giroud", "FRA", "LIL", "ST", 73],
  ["p59", "Ángel Di María", "Di María", "ARG", "ROS", "RW", 74],
  ["p60", "James Rodríguez", "James", "COL", "NAC", "CAM", 73],
  ["p61", "Hugo Lloris", "Lloris", "FRA", "LAF", "GK", 72],
  ["p62", "Kyle Walker", "Walker", "ENG", "BUR", "RB", 72],
  ["p63", "Thomas Partey", "Partey", "GHA", "SHB", "CDM", 73],
  ["p64", "Leon Bailey", "Bailey", "JAM", "OLY", "RW", 73],
  ["p65", "Xherdan Shaqiri", "Shaqiri", "SUI", "BAS", "CAM", 72],
  ["p66", "Raúl Jiménez", "Raúl Jiménez", "MEX", "WOL", "ST", 71],
  ["p67", "Marco Reus", "Reus", "GER", "LAG", "CAM", 71],
  ["p68", "Alexis Sánchez", "Alexis", "CHI", "MTL", "ST", 70],
  ["p69", "Memphis Depay", "Memphis", "NED", "COR", "ST", 73],
  ["p70", "Ivan Perišić", "Perišić", "CRO", "PSV", "LM", 72],
  ["p71", "Jordan Henderson", "Henderson", "ENG", "CHE", "CM", 71],
  ["p72", "Hirving Lozano", "Lozano", "MEX", "LAG", "LW", 70],
  ["p73", "Thiago Silva", "Thiago Silva", "BRA", "FLU", "CB", 70],
  ["p74", "Jamie Vardy", "Vardy", "ENG", "BUR", "ST", 69],
  ["p75", "Marcelo Brozović", "Brozović", "CRO", "SAD", "CDM", 71],
  ["p76", "Teemu Pukki", "Pukki", "FIN", "HJK", "ST", 66],
  ["p77", "Weston McKennie", "McKennie", "USA", "JUV", "CM", 74],
  ["p78", "Tyler Adams", "T. Adams", "USA", "BOU", "CDM", 74],
  ["p79", "Franck Kessié", "Kessié", "CIV", "ATA", "CM", 74],
  ["p80", "Youssef En-Nesyri", "En-Nesyri", "MAR", "ITT", "ST", 73],
  ["p81", "Ismaïla Sarr", "I. Sarr", "SEN", "CRY", "RW", 74],
  // bronzes — the next generation, a breakout away from gold
  ["p82", "Max Dowman", "Dowman", "ENG", "ARS", "CAM", 63],
  ["p83", "Myles Lewis-Skelly", "Lewis-Skelly", "ENG", "ARS", "LB", 64],
  ["p84", "Ayyoub Bouaddi", "Bouaddi", "MAR", "MCI", "CM", 63],
  ["p85", "Eli Junior Kroupi", "Kroupi", "FRA", "BOU", "ST", 63],
  ["p86", "Luka Vušković", "Vušković", "CRO", "BHA", "CB", 62],
  ["p87", "Jobe Bellingham", "J. Bellingham", "ENG", "DOR", "CM", 64],
  ["p88", "Lucas Bergvall", "Bergvall", "SWE", "TOT", "CM", 63],
  ["p89", "Ethan Nwaneri", "Nwaneri", "ENG", "DOR", "CAM", 64],
  ["p90", "Kobbie Mainoo", "Mainoo", "ENG", "MUN", "CM", 64],
  ["p91", "Warren Zaïre-Emery", "Zaïre-Emery", "FRA", "PSG", "CM", 64],
  ["p92", "Endrick", "Endrick", "BRA", "RMA", "ST", 63],
  ["p93", "Estêvão", "Estêvão", "BRA", "CHE", "RW", 64],
  ["p94", "Leny Yoro", "Yoro", "FRA", "MUN", "CB", 62],
  // legends — the retired greats of the OpenPack hall of fame
  ["l01", "Pelé", "Pelé", "BRA", "LGD", "CF", 98],
  ["l02", "Diego Maradona", "Maradona", "ARG", "LGD", "CAM", 97],
  ["l03", "Zinedine Zidane", "Zidane", "FRA", "LGD", "CAM", 96],
  ["l04", "Ronaldo Nazário", "Ronaldo", "BRA", "LGD", "ST", 96],
  ["l05", "Johan Cruyff", "Cruyff", "NED", "LGD", "CF", 95],
  ["l06", "Thierry Henry", "Henry", "FRA", "LGD", "ST", 93],
  ["l07", "Paolo Maldini", "Maldini", "ITA", "LGD", "CB", 94],
  ["l08", "Ronaldinho", "Ronaldinho", "BRA", "LGD", "CAM", 94],
  ["l09", "Gianluigi Buffon", "Buffon", "ITA", "LGD", "GK", 93],
  ["l10", "Didier Drogba", "Drogba", "CIV", "LGD", "ST", 91],
];

// promo editions: player id → [edition, overall boost]
const PROMOS = [
  // Team of the Week (in-form)
  ["p30", "totw", 2], ["p33", "totw", 2], ["p35", "totw", 3], ["p40", "totw", 2], ["p45", "totw", 2], ["p49", "totw", 3],
  ["p52", "totw", 3], ["p53", "totw", 3], ["p57", "totw", 5], ["p64", "totw", 5], ["p69", "totw", 4], ["p79", "totw", 4],
  // Player of the Match
  ["p06", "potm", 3], ["p14", "potm", 3], ["p18", "potm", 3], ["p24", "potm", 4], ["p27", "potm", 4], ["p28", "potm", 5],
  ["p29", "potm", 4], ["p36", "potm", 3], ["p59", "potm", 6], ["p60", "potm", 6],
  // Future Stars — the youngest breakouts get the biggest jumps
  ["p43", "future", 5], ["p46", "future", 6], ["p47", "future", 5], ["p82", "future", 18], ["p83", "future", 16],
  ["p86", "future", 17], ["p89", "future", 16], ["p92", "future", 17], ["p93", "future", 18],
  // Team of the Season
  ["p05", "tots", 5], ["p02", "tots", 5], ["p19", "tots", 5], ["p16", "tots", 6], ["p15", "tots", 6],
  ["p39", "tots", 6], ["p21", "tots", 5], ["p31", "tots", 6], ["p25", "tots", 6],
  // Team of the Year — a full XI
  ["p12", "toty", 6], ["p13", "toty", 7], ["p11", "toty", 6], ["p23", "toty", 7], ["p44", "toty", 7],
  ["p10", "toty", 6], ["p20", "toty", 7], ["p08", "toty", 6], ["p04", "toty", 6], ["p01", "toty", 6], ["p03", "toty", 7],
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

// ---- cards -------------------------------------------------------------------------------

function baseEdition(ovr, rare) {
  if (ovr < 65) return "bronze";
  if (ovr < 75) return "silver";
  return rare ? "raregold" : "gold";
}

const TIER_OF = Object.fromEntries(TIERS.map((t) => [t.key, t.id]));

function makeCard(row, edition, boost, n) {
  const [id, full, display, nation, clubId, pos, ovr] = row;
  const tier = TIER_OF[edition];
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
    club: CLUBS[clubId],
    stats: rollStats(row, boost, edition),
    photo: `assets/players/${id}.webp`,
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
    const ed = row[0].startsWith("l") ? "legend" : baseEdition(row[6], row[7]);
    cards.push(makeCard(row, ed, 0, n++));
  }
  for (const [pid, ed, boost] of PROMOS) cards.push(makeCard(byId.get(pid), ed, boost, n++));
  return cards;
}

export const POOL = buildPool();

// a darker sibling of a club colour — handy for UI accents keyed to a club
export const clubShade = (club, amt = -0.3) => shade(club.colors[0], amt);
