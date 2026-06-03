#!/usr/bin/env node
/*
 * build-cache.js — portable Card Query cache builder.
 *
 * Fetches the full MLB The Show marketplace (items + live prices) and writes a
 * cache.json that the hosted Card Query server can consume. Run it ANYWHERE that
 * can reach theshow.com (your home PC, or a CI runner whose IP isn't blocked):
 *
 *     node build-cache.js                 # writes ./cache.json for SHOW_GAME (default mlb26)
 *     SHOW_GAME=mlb25 node build-cache.js # a different year
 *     OUT=public/cache.json node build-cache.js
 *
 * No dependencies — just Node 18+ (global fetch). Commit the resulting cache.json
 * to a public repo; point the server's CACHE_SOURCE_URL at its raw URL.
 *
 * NOTE: theshow.com's WAF blocks most datacenter IPs (the hosted VPS gets 403).
 * That's the whole reason this runs elsewhere — on a clean (usually residential)
 * IP — and publishes the result for the server to pull.
 */
const fs = require("fs");

const GAME = process.env.SHOW_GAME || "mlb26";
const API_BASE = `https://${GAME}.theshow.com/apis`;
const OUT = process.env.OUT || "cache.json";
const UA = "card-query-cache-builder/1.0";

// Identical shape to the server's slimCard() so the app consumes it unchanged.
function slimCard(it, price) {
  return {
    uuid: it.uuid, name: it.name, ovr: it.ovr, rarity: it.rarity,
    pos: it.display_position, secondaries: it.display_secondary_positions || "",
    team: it.team, team_short: it.team_short_name, series: it.series,
    is_live: it.series === "Live" || it.is_live_set === true,
    is_hitter: it.is_hitter, two_way: !!it.two_way,
    bats: it.bat_hand, throws: it.throw_hand, age: it.age,
    img: it.baked_img || it.img,
    con_l: it.contact_left, con_r: it.contact_right,
    pow_l: it.power_left, pow_r: it.power_right,
    vis: it.plate_vision, dis: it.plate_discipline, clu: it.batting_clutch,
    bunt: it.bunting_ability, dbunt: it.drag_bunting_ability, dur: it.hitting_durability,
    spd: it.speed, fld: it.fielding_ability, fdur: it.fielding_durability,
    arm: it.arm_strength, aacc: it.arm_accuracy,
    brun: it.baserunning_ability, bagg: it.baserunning_aggression, steal: it.base_stealing,
    vel: it.pitch_velocity, ctl: it.pitch_control, mov: it.pitch_movement,
    sta: it.stamina, pclu: it.pitching_clutch, stuff: it.pitches && it.pitches.stuff_rating,
    k: it.k_per_bf_right, bb: it.bb_per_bf, hr: it.hr_per_bf,
    hbf_l: it.hits_per_bf_left, hbf_r: it.hits_per_bf_right,
    kbf_l: it.k_per_bf_left, kbf_r: it.k_per_bf_right,
    pitch_names: it.pitches && Array.isArray(it.pitches.pitches) ? it.pitches.pitches.map((p) => p.name) : [],
    block: it.blocking, rback: it.reaction_back, rfwd: it.reaction_forward, rleft: it.reaction_left, rright: it.reaction_right,
    pop: it.pop_time, cfld: it.catcher_fielding_rating,
    conR: it.contact_rating, powR: it.power_rating, spdR: it.speed_rating, fldR: it.fielding_rating, armR: it.arm_rating, intang: it.intangibles_rating,
    height: it.height, weight: it.weight, born: it.born, jersey_number: it.jersey_number, set_name: it.set_name,
    img_lg: it.baked_img_lg || it.img,
    quirks: it.quirks ? it.quirks.map((q) => (typeof q === "string" ? q : q.name)).filter(Boolean) : [],
    pitches_full: it.pitches || null,
    best_buy_price: price ? price.best_buy_price : 0,
    best_sell_price: price ? price.best_sell_price : 0,
  };
}

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}/${path}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`API ${res.status} on ${path}`);
  return res.json();
}

async function fetchAllPages(pathBase, arrayKey, label) {
  const first = await fetchJson(`${pathBase}&page=1`);
  const total = first.total_pages || 1;
  let arr = (first[arrayKey] || []).slice();
  const BATCH = 8;
  for (let p = 2; p <= total; p += BATCH) {
    const pages = [];
    for (let i = p; i < p + BATCH && i <= total; i++) pages.push(i);
    const results = await Promise.all(
      pages.map((n) => fetchJson(`${pathBase}&page=${n}`).catch(() => ({ [arrayKey]: [] })))
    );
    for (const r of results) arr = arr.concat(r[arrayKey] || []);
    process.stdout.write(`  ${label}: ${Math.min(p + BATCH - 1, total)}/${total}\r`);
  }
  return arr;
}

(async () => {
  console.log(`Building ${GAME} cache (items + prices)…`);
  const [items, listings] = await Promise.all([
    fetchAllPages("items.json?type=mlb_card", "items", "cards"),
    fetchAllPages("listings.json?type=mlb_card", "listings", "prices"),
  ]);
  const priceByUuid = new Map();
  for (const l of listings) {
    if (l.item) priceByUuid.set(l.item.uuid, { best_buy_price: l.best_buy_price, best_sell_price: l.best_sell_price });
  }
  const cards = items.filter((it) => it.uuid).map((it) => slimCard(it, priceByUuid.get(it.uuid)));
  const cache = { fetchedAt: Date.now(), cards, game: GAME };
  fs.writeFileSync(OUT, JSON.stringify(cache));
  console.log(`\nWrote ${OUT}: ${cards.length} cards (${priceByUuid.size} priced).`);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
