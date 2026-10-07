# roster.py — which real player each card id is, for the photo pipeline.
#
# id → English Wikipedia article title. The pipeline (fetch.py) takes the
# article's lead image — Wikipedia only serves FREE images as a page image, so
# every photo is Commons-licensed (CC BY / CC BY-SA / CC0 / PD) — and records
# its author + licence for the credits (src/photos.js). Gameplay data (nation,
# club, position, rating) lives in src/players.js; keep the ids in sync.
#
# Some articles lead with a photo that won't crop to a card portrait (a group
# shot, a side-on action frame, an old newsprint scan). FILE pins a specific
# Commons file instead; CROP nudges the automatic head-and-shoulders crop
# (see cutout.py).

ROSTER = {
    # ---- golds ----------------------------------------------------------------
    "p01": "Kylian Mbappé",
    "p02": "Erling Haaland",
    "p03": "Ousmane Dembélé",
    "p04": "Lamine Yamal",
    "p05": "Harry Kane",
    "p06": "Mohamed Salah",
    "p07": "Vinícius Júnior",
    "p08": "Jude Bellingham",
    "p09": "Rodri (footballer, born 1996)",
    "p10": "Pedri",
    "p11": "Virgil van Dijk",
    "p12": "Thibaut Courtois",
    "p13": "Achraf Hakimi",
    "p14": "Florian Wirtz",
    "p15": "Jamal Musiala",
    "p16": "Bukayo Saka",
    "p17": "Federico Valverde",
    "p18": "Lautaro Martínez",
    "p19": "Raphinha",
    "p20": "Vitinha (footballer, born February 2000)",
    "p21": "Gianluigi Donnarumma",
    "p22": "Declan Rice",
    "p23": "William Saliba",
    "p24": "Bruno Fernandes",
    "p25": "Joshua Kimmich",
    "p26": "Martin Ødegaard",
    "p27": "Lionel Messi",
    "p28": "Cristiano Ronaldo",
    "p29": "Son Heung-min",
    "p30": "Victor Osimhen",
    "p31": "Alessandro Bastoni",
    "p32": "Alisson Becker",
    "p33": "Luka Modrić",
    "p34": "Christian Pulisic",
    "p35": "Kaoru Mitoma",
    "p36": "Alexander Isak",
    "p37": "Cole Palmer",
    "p38": "Joško Gvardiol",
    "p39": "Michael Olise",
    "p40": "Robert Lewandowski",
    "p41": "Alphonso Davies",
    "p42": "Kevin De Bruyne",
    "p43": "Pau Cubarsí",
    "p44": "Nuno Mendes (footballer, born 2002)",
    "p45": "Nico Williams",
    "p46": "Arda Güler",
    "p47": "Désiré Doué",
    "p48": "Manuel Neuer",
    "p49": "Antoine Griezmann",
    "p50": "Jules Koundé",
    "p51": "Takefusa Kubo",
    "p52": "Sadio Mané",
    "p53": "Mohammed Kudus",
    "p54": "Jonathan David",
    "p55": "Casemiro",
    "p56": "N'Golo Kanté",
    # ---- silvers: the old guard + the steady pros ------------------------------
    "p57": "Thomas Müller",
    "p58": "Olivier Giroud",
    "p59": "Ángel Di María",
    "p60": "James Rodríguez",
    "p61": "Hugo Lloris",
    "p62": "Kyle Walker",
    "p63": "Thomas Partey",
    "p64": "Leon Bailey",
    "p65": "Xherdan Shaqiri",
    "p66": "Raúl Jiménez",
    "p67": "Marco Reus",
    "p68": "Alexis Sánchez",
    "p69": "Memphis Depay",
    "p70": "Ivan Perišić",
    "p71": "Jordan Henderson",
    "p72": "Hirving Lozano",
    "p73": "Thiago Silva",
    "p74": "Jamie Vardy",
    "p75": "Marcelo Brozović",
    "p76": "Teemu Pukki",
    "p77": "Weston McKennie",
    "p78": "Tyler Adams",
    "p79": "Franck Kessié",
    "p80": "Youssef En-Nesyri",
    "p81": "Ismaïla Sarr",
    # ---- bronzes: the next generation -----------------------------------------
    "p82": "Max Dowman",
    "p83": "Myles Lewis-Skelly",
    "p84": "Ayyoub Bouaddi",
    "p85": "Eli Junior Kroupi",
    "p86": "Luka Vušković",
    "p87": "Jobe Bellingham",
    "p88": "Lucas Bergvall",
    "p89": "Ethan Nwaneri",
    "p90": "Kobbie Mainoo",
    "p91": "Warren Zaïre-Emery",
    "p92": "Endrick (footballer, born 2006)",
    "p93": "Estêvão (footballer, born 2007)",
    "p94": "Leny Yoro",
    # ---- legends --------------------------------------------------------------
    "l01": "Pelé",
    "l02": "Diego Maradona",
    "l03": "Zinedine Zidane",
    "l04": "Ronaldo (Brazilian footballer)",
    "l05": "Johan Cruyff",
    "l06": "Thierry Henry",
    "l07": "Paolo Maldini",
    "l08": "Ronaldinho",
    "l09": "Gianluigi Buffon",
    "l10": "Didier Drogba",
}

# id → a specific Commons file to use instead of the article's lead image
FILE = {
    "p13": "Achraf Hakimi Morocco v Norway 7 June 2026-32.jpg",           # lead image has a team-mate fused on
    "p21": "Norway Italy - June 2025 B 33 - Gianluigi Donnarumma (close-up).jpg",  # lead image is in a suit
    "p35": "Kaoru Mitoma (2022).jpg",                       # lead image is a low-res TV grab
    "p40": "Robert Lewandowski 2018, JAP-POL (cropped).jpg",
    "p41": "Alphonso Davies Canada v Qatar 18 June 2026-030.jpg",
    "p49": "Antoine Griezmann in 2017 (cropped).jpg",
    "p53": "Mohammed Kudus of West Ham United (cropped).jpeg",
    "p56": "N'Golo Kante France v Senegal 16 June 2026-267.jpg",
    "p76": "Teemu Pukki S04.jpg",
    # legends: playing-days photos over the later public-appearance leads
    "l01": "Pelé México 70.jpg",
    "l02": "Maradona 1986 vs italy.jpg",
    "l06": "Thierry Henry Arsenal U19s Vs Olympiacos (cropped).jpg",
    "l09": "Gianluigi Buffon (31784615942) (cropped).jpg",
}

# id → crop nudges for cutout.py: dx/dy shift the crop centre (in face widths,
# + = right/down), zoom > 1 frames tighter
CROP = {
    "p61": {"dx": 0.2},
    "l01": {"zoom": 1.45},  # frame above the sticker's name bar
    "l06": {"zoom": 1.25},
}
