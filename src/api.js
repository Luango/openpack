// Thin wrapper around the Pokémon TCG API. Fetches a whole set's cards (and
// the list of sets), paging through results and caching each.

const API_URL = "https://api.pokemontcg.io/v2/cards";

// Optional. Without a key you get a lower rate limit (still fine for dev).
// Get one free at https://dev.pokemontcg.io/ and paste it here.
const API_KEY = "";

function headers() {
  return API_KEY ? { "X-Api-Key": API_KEY } : {};
}

function normalize(card) {
  return {
    id: card.id,
    name: card.name,
    number: card.number,
    rarity: card.rarity || "Common", // a few promos have no rarity
    image: card.images?.large || card.images?.small,
    imageSmall: card.images?.small || card.images?.large, // thumbnail for the gallery
    set: card.set?.name,
    setId: card.set?.id,
  };
}

// Fetch every card in a set, paging through results. Cached per set id.
const poolCache = new Map();

export async function fetchSetPool(setId) {
  if (poolCache.has(setId)) return poolCache.get(setId);

  const promise = (async () => {
    const all = [];
    let page = 1;
    const pageSize = 250; // API max

    while (true) {
      const url =
        `${API_URL}?q=${encodeURIComponent(`set.id:${setId}`)}` +
        `&pageSize=${pageSize}&page=${page}` +
        `&select=id,name,number,rarity,images,set`;

      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`API error ${res.status} while loading set ${setId}`);

      const { data, totalCount } = await res.json();
      all.push(...data.map(normalize));

      if (all.length >= totalCount || data.length === 0) break;
      page++;
    }
    return all;
  })();

  poolCache.set(setId, promise);
  // A FAILED fetch must not stay cached, or every later call reuses the rejected
  // promise and never recovers (until reload). Drop it on failure so it retries.
  promise.catch(() => poolCache.delete(setId));
  return promise;
}

// Every set ever printed, newest first. Paged + cached.
let setsCache;

export async function fetchSets() {
  if (setsCache) return setsCache;

  const all = [];
  let page = 1;
  const pageSize = 250; // API max

  while (true) {
    const url =
      "https://api.pokemontcg.io/v2/sets?orderBy=-releaseDate" +
      `&pageSize=${pageSize}&page=${page}&select=id,name,releaseDate,total`;

    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(`API error ${res.status} while loading sets`);

    const { data, totalCount } = await res.json();
    all.push(...data);

    if (all.length >= totalCount || data.length === 0) break;
    page++;
  }

  setsCache = all;
  return all;
}
