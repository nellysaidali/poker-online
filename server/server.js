const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();          // ← CE QUI MANQUE CHEZ TOI
const server = http.createServer(app);

const ALLOWED_ORIGINS = [
  "https://poker-online-1.onrender.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];



const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, origin);
    if (ALLOWED_ORIGINS.includes(origin)) {
      return cb(null, origin); // IMPORTANT : renvoyer l'origin
    }
    return cb(new Error("CORS blocked: " + origin));
  },
  credentials: true,
};

app.use(cors(corsOptions));
const io = new Server(server, {
  cors: corsOptions,
});


// ---------- Utils ----------
function makeRoomCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function makeDeck() {
  const suits = ["S", "H", "D", "C"];
  const ranks = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push({ r, s });
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function suitChar(s) {
  if (s === "S") return "♠";
  if (s === "H") return "♥";
  if (s === "D") return "♦";
  return "♣";
}

function cardToStr(c) {
  return `${c.r}${suitChar(c.s)}`;
}

function rankValue(r) {
  if (r === "A") return 14;
  if (r === "K") return 13;
  if (r === "Q") return 12;
  if (r === "J") return 11;
  if (r === "T") return 10;
  return Number(r);
}

function cmpArr(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

// ---------- Hand evaluator (7 cards -> best) ----------
function straightHigh(values) {
  const set = new Set(values);
  for (let high = 14; high >= 5; high--) {
    let ok = true;
    for (let k = 0; k < 5; k++) {
      if (!set.has(high - k)) { ok = false; break; }
    }
    if (ok) return high;
  }
  if (set.has(14) && set.has(5) && set.has(4) && set.has(3) && set.has(2)) return 5;
  return 0;
}

function rank5(cards5) {
  const vals = cards5.map(c => rankValue(c.r)).sort((a,b) => b-a);
  const suits = cards5.map(c => c.s);

  const freq = new Map();
  for (const v of vals) freq.set(v, (freq.get(v) || 0) + 1);

  const groups = Array.from(freq.entries())
    .map(([v, c]) => ({ v, c }))
    .sort((a,b) => (b.c - a.c) || (b.v - a.v));

  const unique = Array.from(new Set(vals)).sort((a,b) => b-a);
  const flush = suits.every(s => s === suits[0]);
  const straight = straightHigh(unique);

  if (flush && straight) return [8, straight];

  if (groups[0].c === 4) {
    const quad = groups[0].v;
    const kicker = groups.find(g => g.v !== quad).v;
    return [7, quad, kicker];
  }

  if (groups[0].c === 3 && groups[1]?.c === 2) {
    return [6, groups[0].v, groups[1].v];
  }

  if (flush) return [5, ...vals];

  if (straight) return [4, straight];

  if (groups[0].c === 3) {
    const trip = groups[0].v;
    const kickers = groups.filter(g => g.v !== trip).map(g => g.v).sort((a,b) => b-a);
    return [3, trip, ...kickers];
  }

  if (groups[0].c === 2 && groups[1]?.c === 2) {
    const p1 = Math.max(groups[0].v, groups[1].v);
    const p2 = Math.min(groups[0].v, groups[1].v);
    const kicker = groups.find(g => g.c === 1).v;
    return [2, p1, p2, kicker];
  }

  if (groups[0].c === 2) {
    const pair = groups[0].v;
    const kickers = groups.filter(g => g.v !== pair).map(g => g.v).sort((a,b) => b-a);
    return [1, pair, ...kickers];
  }

  return [0, ...vals];
}

function combos5of7(cards7) {
  const res = [];
  for (let a = 0; a < 7; a++) {
    for (let b = a+1; b < 7; b++) {
      const five = [];
      for (let i = 0; i < 7; i++) {
        if (i !== a && i !== b) five.push(cards7[i]);
      }
      res.push(five);
    }
  }
  return res;
}

function bestRank7(cards7) {
  let best = null;
  for (const c5 of combos5of7(cards7)) {
    const r = rank5(c5);
    if (!best || cmpArr(r, best) > 0) best = r;
  }
  return best;
}

function rankName(cat) {
  return [
    "High Card",
    "Pair",
    "Two Pair",
    "Three of a Kind",
    "Straight",
    "Flush",
    "Full House",
    "Four of a Kind",
    "Straight Flush"
  ][cat] || "Unknown";
}

// ---------- Game model ----------
function ensureGame(room) {
  if (!room.game) {
    room.game = {
      seats: [],
      handId: 0,
      deck: [],
      board: [],
      phase: "idle",
      dealerSeat: 0,
      sb: 10,
      bb: 20,
      pot: 0,
      currentSeat: 0,
      toCall: 0,
      lastWinners: null,
      lastPots: null
    };
  }
}

function ensureGameSeats(room) {
  ensureGame(room);

  const humans = Array.from(room.humans.values());
  const seats = [];

  for (const h of humans.slice(0, 2)) {
    seats.push({
      seat: seats.length,
      type: "human",
      socketId: h.id,
      name: h.name,
      stack: 2000,
      hand: [],
      inHand: true,
      bet: 0,
      hasActed: false,
      allIn: false,
      totalContrib: 0
    });
  }

  const botCount = Math.max(0, 4 - seats.length);
  for (let i = 0; i < botCount; i++) {
    seats.push({
      seat: seats.length,
      type: "bot",
      socketId: null,
      name: `Bot ${i + 1}`,
      stack: 2000,
      hand: [],
      inHand: true,
      bet: 0,
      hasActed: false,
      allIn: false,
      totalContrib: 0
    });
  }

  room.game.seats = seats;
}

function recomputeBots(room) {
  const humanCount = room.humans.size;
  room.bots = Math.max(0, Math.min(3, 4 - humanCount));
  ensureGameSeats(room);
}

function isActingSeat(s) {
  return s.inHand && !s.allIn;
}

function hasAnyActing(game) {
  return game.seats.some(isActingSeat);
}

function nextActingSeatIndex(start, seats) {
  const n = seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (start + i) % n;
    if (isActingSeat(seats[idx])) return idx;
  }
  return start;
}

function resetActionsForRound(game) {
  for (const s of game.seats) {
    if (isActingSeat(s)) s.hasActed = false;
  }
}

function clearBetsForNewStreet(game) {
  for (const s of game.seats) {
    s.bet = 0;
    if (s.inHand && s.stack === 0) s.allIn = true;
  }
  game.toCall = 0;
  resetActionsForRound(game);
}

function takeChips(game, seatIndex, amount) {
  const s = game.seats[seatIndex];
  const pay = Math.min(amount, s.stack);
  s.stack -= pay;
  s.bet += pay;
  s.totalContrib += pay;
  game.pot += pay;
  if (s.stack === 0) s.allIn = true;
  return pay;
}

function postBlind(game, seatIndex, amount) {
  takeChips(game, seatIndex, amount);
}

function dealPreflop(game) {
  game.deck = shuffle(makeDeck());
  game.board = [];
  for (const s of game.seats) s.hand = [];

  // 2 cartes par joueur, une par tour
  for (let r = 0; r < 2; r++) {
    for (const s of game.seats) {
      const card = game.deck.pop();
      if (!card) continue; // sécurité
      s.hand.push(card);
    }
  }

  // sécurité: s'assurer que personne n'a undefined
  for (const s of game.seats) {
    s.hand = (s.hand || []).filter(Boolean);
  }
}


function startHand(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  ensureGameSeats(room);

  const g = room.game;
  g.lastWinners = null;
  g.lastPots = null;
  g.handId += 1;
  g.phase = "preflop";
  g.pot = 0;
  g.toCall = 0;

  for (const s of g.seats) {
    s.inHand = s.stack > 0;
    s.bet = 0;
    s.hasActed = false;
    s.allIn = false;
    s.totalContrib = 0;
  }

  g.dealerSeat = (g.dealerSeat + 1) % g.seats.length;

  dealPreflop(g);

  const sbSeat = nextActingSeatIndex(g.dealerSeat, g.seats) || ((g.dealerSeat + 1) % g.seats.length);
  const bbSeat = nextActingSeatIndex(sbSeat, g.seats) || ((sbSeat + 1) % g.seats.length);

  postBlind(g, sbSeat, g.sb);
  postBlind(g, bbSeat, g.bb);

  g.toCall = Math.max(...g.seats.filter(s => s.inHand).map(s => s.bet));

  resetActionsForRound(g);

  g.currentSeat = hasAnyActing(g) ? nextActingSeatIndex(bbSeat, g.seats) : bbSeat;

  fastForwardIfNoActions(g);
}

function applyAction(game, seatIndex, action) {
  const s = game.seats[seatIndex];
  if (!s.inHand) return { ok: false, error: "Déjà fold" };
  if (s.allIn) return { ok: false, error: "All-in (plus d'action possible)" };

  const type = action?.type;
  const prevToCall = game.toCall;

  if (type === "fold") {
    s.inHand = false;
    s.hasActed = true;
    return { ok: true };
  }

  if (type === "check") {
    const need = game.toCall - s.bet;
    if (need !== 0) return { ok: false, error: "Impossible de check" };
    s.hasActed = true;
    return { ok: true };
  }

  if (type === "call") {
    const need = Math.max(0, game.toCall - s.bet);
    takeChips(game, seatIndex, need);
    s.hasActed = true;
    game.toCall = Math.max(...game.seats.filter(p => p.inHand).map(p => p.bet));
    return { ok: true };
  }

  if (type === "raise") {
    const target = Number(action?.amount);
    if (!Number.isFinite(target)) return { ok: false, error: "Raise invalide" };
    if (target <= prevToCall) return { ok: false, error: "Raise doit être > toCall" };

    const needToCall = Math.max(0, prevToCall - s.bet);
    const needRaise = target - prevToCall;
    const totalNeed = needToCall + needRaise;

    takeChips(game, seatIndex, totalNeed);

    const newMax = Math.max(...game.seats.filter(p => p.inHand).map(p => p.bet));
    const didIncrease = newMax > prevToCall;
    game.toCall = newMax;

    if (didIncrease) {
      for (const p of game.seats) {
        if (isActingSeat(p)) p.hasActed = false;
      }
    }

    s.hasActed = true;
    return { ok: true };
  }

  return { ok: false, error: "Action inconnue" };
}

function inHandSeats(game) {
  return game.seats.filter(s => s.inHand);
}

function allActedAndMatched(game) {
  const act = inHandSeats(game);
  if (act.length <= 1) return true;

  return act.every(s => {
    if (!isActingSeat(s)) return true;
    return s.hasActed && s.bet === game.toCall;
  });
}

// ---------- Side pots + showdown ----------
function buildSidePotsFromTotalContrib(game) {
  const contributors = game.seats.filter(s => s.totalContrib > 0);
  if (contributors.length === 0) return [];

  const levels = Array.from(new Set(contributors.map(s => s.totalContrib))).sort((a,b)=>a-b);

  const pots = [];
  let prev = 0;
  for (const level of levels) {
    const slice = level - prev;
    const contributingPlayers = contributors.filter(s => s.totalContrib >= level);
    const eligiblePlayers = game.seats.filter(s => s.inHand && s.totalContrib >= level);

    const amount = slice * contributingPlayers.length;
    if (amount > 0) pots.push({ amount, eligible: eligiblePlayers });
    prev = level;
  }
  return pots;
}

function showdown(game) {
  const stillIn = inHandSeats(game);

  if (stillIn.length === 1) {
    const w = stillIn[0];
    w.stack += game.pot;
    game.lastWinners = { winners: [w.name], hand: "Win by fold" };
    game.lastPots = [{ index: 0, amount: game.pot, eligible: [w.name] }];
    game.pot = 0;
    game.phase = "idle";
    return;
  }

  const ranks = new Map();
  for (const s of stillIn) {
    const seven = [...s.hand, ...game.board];
    ranks.set(s.seat, bestRank7(seven));
  }

  const pots = buildSidePotsFromTotalContrib(game);

  const winnersNames = new Set();
  let lastBestHandName = "";

  for (const pot of pots) {
    if (!pot.eligible || pot.eligible.length === 0) continue;

    let best = null;
    let winners = [];

    for (const s of pot.eligible) {
      const r = ranks.get(s.seat);
      if (!best || cmpArr(r, best) > 0) {
        best = r;
        winners = [s];
        lastBestHandName = rankName(r[0]);
      } else if (cmpArr(r, best) === 0) {
        winners.push(s);
      }
    }

    const share = Math.floor(pot.amount / winners.length);
    let rem = pot.amount - share * winners.length;

    for (const w of winners) {
      w.stack += share;
      winnersNames.add(w.name);
    }
    if (rem > 0) winners[0].stack += rem;
  }

  game.pot = 0;
  game.lastWinners = { winners: Array.from(winnersNames), hand: lastBestHandName || "Showdown" };
  game.lastPots = buildSidePotsFromTotalContrib(game).map((p, i) => ({
    index: i,
    amount: p.amount,
    eligible: p.eligible.map(s => s.name)
  }));
  game.phase = "idle";
}

// ---------- Streets ----------
function dealFlop(game) {
  const a = game.deck.pop();
  const b = game.deck.pop();
  const c = game.deck.pop();
  if (a) game.board.push(a);
  if (b) game.board.push(b);
  if (c) game.board.push(c);
  game.board = game.board.filter(Boolean);
}
function dealTurn(game) {
  const a = game.deck.pop();
  if (a) game.board.push(a);
  game.board = game.board.filter(Boolean);
}
function dealRiver(game) {
  const a = game.deck.pop();
  if (a) game.board.push(a);
  game.board = game.board.filter(Boolean);
}


function firstToActPostflop(game) {
  if (!hasAnyActing(game)) return game.currentSeat;
  return nextActingSeatIndex(game.dealerSeat, game.seats);
}

function fastForwardIfNoActions(game) {
  if (game.phase === "idle") return;
  if (hasAnyActing(game)) return;

  if (game.phase === "preflop") {
    dealFlop(game); game.phase = "flop";
    dealTurn(game); game.phase = "turn";
    dealRiver(game); game.phase = "river";
    showdown(game);
    return;
  }
  if (game.phase === "flop") {
    dealTurn(game); game.phase = "turn";
    dealRiver(game); game.phase = "river";
    showdown(game);
    return;
  }
  if (game.phase === "turn") {
    dealRiver(game); game.phase = "river";
    showdown(game);
    return;
  }
  if (game.phase === "river") showdown(game);
}

function goToNextStreet(game) {
  if (inHandSeats(game).length <= 1) {
    showdown(game);
    return;
  }

  if (game.phase === "preflop") {
    dealFlop(game);
    game.phase = "flop";
    clearBetsForNewStreet(game);
    game.currentSeat = firstToActPostflop(game);
    fastForwardIfNoActions(game);
    return;
  }

  if (game.phase === "flop") {
    dealTurn(game);
    game.phase = "turn";
    clearBetsForNewStreet(game);
    game.currentSeat = firstToActPostflop(game);
    fastForwardIfNoActions(game);
    return;
  }

  if (game.phase === "turn") {
    dealRiver(game);
    game.phase = "river";
    clearBetsForNewStreet(game);
    game.currentSeat = firstToActPostflop(game);
    fastForwardIfNoActions(game);
    return;
  }

  if (game.phase === "river") showdown(game);
}

function advanceTurnOrStreet(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const g = room.game;

  if (inHandSeats(g).length <= 1) {
    showdown(g);
    return;
  }

  if (allActedAndMatched(g)) {
    goToNextStreet(g);
    return;
  }

  if (hasAnyActing(g)) g.currentSeat = nextActingSeatIndex(g.currentSeat, g.seats);
  else fastForwardIfNoActions(g);
}

// ---------- Bots (plus audacieux) ----------
function cardVal(c) { return rankValue(c.r); }

function preflopScore(hand) {
  const a = cardVal(hand[0]);
  const b = cardVal(hand[1]);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const paired = a === b;
  const suited = hand[0].s === hand[1].s;
  const gap = hi - lo;

  let score = 0;

  if (paired) score += 22 + hi;              // grosse base
  else score += hi * 1.2 + lo * 0.6;

  if (suited) score += 3;
  if (gap === 1) score += 2;                 // connecteurs
  if (gap === 0) score += 0;
  if (gap >= 5) score -= 3;

  if (hi >= 13 && lo >= 10) score += 6;      // broadways
  if (hi >= 14 && lo >= 11) score += 4;      // AJs+
  return score;
}

function potOdds(need, pot) {
  if (need <= 0) return 0;
  return need / (pot + need); // ratio
}

function botStrength(game, seatIndex) {
  const s = game.seats[seatIndex];
  if (!s || !Array.isArray(s.hand)) return 0.0;

  // Nettoyage: enlever undefined au cas où
  const hand = s.hand.filter(Boolean);
  const board = Array.isArray(game.board) ? game.board.filter(Boolean) : [];

  // Si pas encore 2 cartes, on joue safe
  if (hand.length < 2) return 0.0;

  if (game.phase === "preflop") {
    const sc = preflopScore(hand);
    return Math.max(0, Math.min(1, (sc - 18) / 25));
  }

  // Postflop: il faut 5 à 7 cartes max, mais jamais undefined
  const seven = [...hand, ...board].filter(Boolean);

  // Si board pas assez (ex: flop pas complet), on évite bestRank7
  if (seven.length < 5) return 0.15;

  // bestRank7 suppose 7 cartes; si on en a 5 ou 6, on complète en mode safe
  // (simple: on ne calcule que si on a 7, sinon on baisse l'agressivité)
  if (seven.length < 7) {
    return 0.25;
  }

  const r = bestRank7(seven.slice(0, 7));
  const cat = r[0];
  let strength = cat / 8;
  if (cat >= 4) strength += 0.10;
  if (cat >= 6) strength += 0.10;
  return Math.max(0, Math.min(1, strength));
}

function botDecide(game, seatIndex) {
  const s = game.seats[seatIndex];
  const need = Math.max(0, game.toCall - s.bet);

  const strength = botStrength(game, seatIndex);

  // style: un peu plus agressif en général
  const aggro = 0.55 + Math.random() * 0.25; // 0.55..0.80

  // bluff chance (plus quand personne n'a misé)
  const bluff = (need === 0 ? 0.18 : 0.08) * (Math.random());

  // fold threshold basé sur pot odds
  const odds = potOdds(need, game.pot);
  const callGood = strength > odds * 0.9;

  // si check possible
  if (need === 0) {
    // value bet / bluff
    if (strength > 0.55 && Math.random() < aggro) {
      const target = game.toCall + game.bb; // petit bet
      return { type: "raise", amount: target };
    }
    if (bluff > 0.12) {
      const target = game.toCall + game.bb;
      return { type: "raise", amount: target };
    }
    return { type: "check" };
  }

  // quand on doit payer
  if (!callGood && strength < 0.35 && Math.random() < 0.55) {
    return { type: "fold" };
  }

  // raise si fort ou semi-bluff
  const canRaise = s.stack > need + game.bb;
  if (canRaise && (strength > 0.70 || (strength > 0.45 && Math.random() < aggro) || bluff > 0.14)) {
    // sizing simple: 1bb à 3bb au-dessus
    const mult = strength > 0.80 ? 3 : (strength > 0.60 ? 2 : 1);
    const target = game.toCall + mult * game.bb;
    return { type: "raise", amount: target };
  }

  return { type: "call" };
}

async function runBotsIfNeeded(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const g = room.game;

  while (["preflop","flop","turn","river"].includes(g.phase)) {
    if (!hasAnyActing(g)) {
      fastForwardIfNoActions(g);
      emitRoomState(roomCode);
      break;
    }

    const current = g.seats[g.currentSeat];
    if (!current || !current.inHand || current.allIn) {
      advanceTurnOrStreet(roomCode);
      emitRoomState(roomCode);
      continue;
    }

    if (current.type !== "bot") break;

    const action = botDecide(g, g.currentSeat);
    applyAction(g, g.currentSeat, action);

    advanceTurnOrStreet(roomCode);
    emitRoomState(roomCode);

    await new Promise(r => setTimeout(r, 260));
  }
}

// ---------- state emit ----------
function publicState(roomCode) {
  const room = rooms[roomCode];
  const g = room.game;

  return {
    roomCode,
    humans: Array.from(room.humans.values()).map(h => ({ id: h.id, name: h.name })),
    botCount: room.bots,
    totalSeats: 4,
    game: {
      phase: g?.phase ?? "idle",
      handId: g?.handId ?? 0,
      dealerSeat: g?.dealerSeat ?? 0,
      sb: g?.sb ?? 10,
      bb: g?.bb ?? 20,
      pot: g?.pot ?? 0,
      toCall: g?.toCall ?? 0,
      currentSeat: g?.currentSeat ?? 0,
      board: (g?.board ?? []).map(cardToStr),
      lastWinners: g?.lastWinners ?? null,
      lastPots: g?.lastPots ?? null,
      seats: (g?.seats ?? []).map(s => ({
        seat: s.seat,
        type: s.type,
        name: s.name,
        stack: s.stack,
        inHand: s.inHand,
        bet: s.bet,
        allIn: s.allIn,
        totalContrib: s.totalContrib
      }))
    }
  };
}

function privateStateFor(roomCode, socketId) {
  const base = publicState(roomCode);
  const room = rooms[roomCode];
  const seat = room.game.seats.find(s => s.type === "human" && s.socketId === socketId);

  return {
    ...base,
    you: seat ? { seat: seat.seat, name: seat.name, hand: seat.hand.map(cardToStr) } : null
  };
}

function emitRoomState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  io.to(roomCode).emit("state:update", publicState(roomCode));
  for (const h of room.humans.values()) {
    io.to(h.id).emit("state:private", privateStateFor(roomCode, h.id));
  }
}

// ---------- socket handlers ----------
io.on("connection", (socket) => {
  socket.on("room:create", ({ name }, cb) => {
    const roomCode = makeRoomCode();
    rooms[roomCode] = { humans: new Map(), bots: 0, game: null };

    rooms[roomCode].humans.set(socket.id, { id: socket.id, name: name || "Joueur" });
    recomputeBots(rooms[roomCode]);

    socket.join(roomCode);
    emitRoomState(roomCode);
    cb?.({ ok: true, roomCode });
  });

  socket.on("room:join", ({ roomCode, name }, cb) => {
    roomCode = (roomCode || "").toUpperCase();
    const room = rooms[roomCode];
    if (!room) return cb?.({ ok: false, error: "Room introuvable" });
    if (room.humans.size >= 2) return cb?.({ ok: false, error: "Room pleine (max 2 humains)" });

    room.humans.set(socket.id, { id: socket.id, name: name || "Joueur" });
    recomputeBots(room);

    socket.join(roomCode);
    emitRoomState(roomCode);
    cb?.({ ok: true });
  });

  socket.on("game:startHand", async ({ roomCode }, cb) => {
    roomCode = (roomCode || "").toUpperCase();
    const room = rooms[roomCode];
    if (!room) return cb?.({ ok: false, error: "Room introuvable" });
    if (!room.humans.has(socket.id)) return cb?.({ ok: false, error: "Pas dans la room" });

    startHand(roomCode);
    emitRoomState(roomCode);
    cb?.({ ok: true });

    await runBotsIfNeeded(roomCode);
  });

  socket.on("game:action", async ({ roomCode, action }, cb) => {
    roomCode = (roomCode || "").toUpperCase();
    const room = rooms[roomCode];
    if (!room) return cb?.({ ok: false, error: "Room introuvable" });
    if (!room.humans.has(socket.id)) return cb?.({ ok: false, error: "Pas dans la room" });

    const g = room.game;
    if (!g || !["preflop","flop","turn","river"].includes(g.phase)) {
      return cb?.({ ok: false, error: "Pas de main en cours" });
    }

    const seatIndex = g.seats.findIndex(s => s.type === "human" && s.socketId === socket.id);
    if (seatIndex < 0) return cb?.({ ok: false, error: "Seat introuvable" });
    if (g.currentSeat !== seatIndex) return cb?.({ ok: false, error: "Pas ton tour" });

    const result = applyAction(g, seatIndex, action);
    if (!result.ok) return cb?.(result);

    advanceTurnOrStreet(roomCode);
    emitRoomState(roomCode);
    cb?.({ ok: true });

    await runBotsIfNeeded(roomCode);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of Object.entries(rooms)) {
      if (room.humans.has(socket.id)) {
        room.humans.delete(socket.id);
        recomputeBots(room);
        emitRoomState(code);
        if (room.humans.size === 0) delete rooms[code];
        break;
      }
    }
  });
});

app.get("/", (req, res) => res.send("Poker server OK"));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on", PORT));
