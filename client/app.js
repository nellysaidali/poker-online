const SERVER_URL = "https://poker-online.onrender.com";

const socket = io(SERVER_URL, {
  path: "/socket.io",
  transports: ["polling", "websocket"], // IMPORTANT: polling d’abord
});


let lastPublic = null;
let lastPrivate = null;

function money(n) {
  const v = Number(n) || 0;
  return `${Math.floor(v)}€`;
}


function setMsg(t) {
  const el = $("msg");
  if (el) el.textContent = t || "";
}

function setServerOnline(isOnline) {
  const dot = $("serverDot");
  const text = $("serverText");
  if (!dot || !text) return;

  dot.classList.toggle("dot-green", isOnline);
  dot.classList.toggle("dot-red", !isOnline);
  dot.title = isOnline ? "Connecté" : "Déconnecté";
  text.textContent = isOnline ? "En ligne" : "Hors ligne";
}

socket.on("connect", () => {
  setServerOnline(true);
  setMsg("Connecté au serveur.");
});

socket.on("disconnect", () => {
  setServerOnline(false);
  setMsg("Déconnecté.");
});

socket.on("state:update", (state) => {
  lastPublic = state;
  render();
});

socket.on("state:private", (state) => {
  lastPrivate = state;
  render();
});

function myRoomCode() {
  return ($("roomCode")?.value || "").trim().toUpperCase();
}

function mySeatIndex() {
  return lastPrivate?.you?.seat ?? null;
}

function isMyTurn() {
  const seat = mySeatIndex();
  if (seat === null) return false;
  const phase = lastPublic?.game?.phase;
  const inHandPhases = ["preflop", "flop", "turn", "river"];
  return inHandPhases.includes(phase) && lastPublic?.game?.currentSeat === seat;
}

function mySeat() {
  const seat = mySeatIndex();
  if (seat === null) return null;
  return lastPublic?.game?.seats?.find((s) => s.seat === seat) || null;
}

function minRaiseTo() {
  const g = lastPublic?.game;
  if (!g) return 0;
  return (g.toCall || 0) + (g.bb || 0);
}

function clampRaiseTo(target) {
  const g = lastPublic?.game;
  const me = mySeat();
  if (!g || !me) return Math.floor(target);

  const min = minRaiseTo();
  target = Math.max(target, min);

  const maxTotal = (g.toCall || 0) + ((me.stack || 0) + (me.bet || 0));
  target = Math.min(target, maxTotal);

  return Math.floor(target);
}

function showOverlay(show, text = "-") {
  const ov = $("handOverlay");
  if (!ov) return;

  ov.classList.toggle("hidden", !show);

  const res = $("overlayResult");
  if (res) res.textContent = text;

  const potsEl = $("potsBreakdown");
  if (!potsEl) return;

  potsEl.innerHTML = "";
  if (!show) return;

  const pots = lastPublic?.game?.lastPots || null;
  if (!pots || pots.length === 0) {
    potsEl.innerHTML = `<div class="potLine">Pas de détail de pots.</div>`;
    return;
  }

  for (const p of pots) {
    const line = document.createElement("div");
    line.className = "potLine";
    const label = p.index === 0 ? "Main pot" : `Side pot ${p.index}`;
    const eligible = Array.isArray(p.eligible) ? p.eligible.join(", ") : "-";
    line.textContent = `${label} : ${money(p.amount)} (éligibles: ${eligible})`;
    potsEl.appendChild(line);
  }
}

function render() {
  if (!lastPublic) return;
  const g = lastPublic.game;

  if ($("phase")) $("phase").textContent = g.phase;
  if ($("pot")) $("pot").textContent = money(g.pot);
  if ($("toCall")) $("toCall").textContent = money(g.toCall);
  if ($("dealerSeat")) $("dealerSeat").textContent = String(g.dealerSeat);
  if ($("currentSeat")) $("currentSeat").textContent = String(g.currentSeat);
  if ($("board")) $("board").textContent = (g.board && g.board.length) ? g.board.join(" ") : "-";

  if ($("result")) {
    $("result").textContent = g.lastWinners
      ? `${g.lastWinners.winners.join(" & ")} (${g.lastWinners.hand})`
      : "-";
  }

  const seatsEl = $("seats");
  if (seatsEl) {
    seatsEl.innerHTML = "";
    for (const s of g.seats) {
      const div = document.createElement("div");
      div.className = "seat";

      const isCurrent = (s.seat === g.currentSeat) && ["preflop","flop","turn","river"].includes(g.phase);
      if (isCurrent) div.classList.add("isCurrent");
      if (s.seat === g.dealerSeat && g.phase !== "idle") div.classList.add("isDealer");
      if (!s.inHand) div.classList.add("isOut");

      const flags = [s.allIn ? "ALL-IN" : null].filter(Boolean).join(" ");

      div.innerHTML = `
        <div class="top">
          <div><b>${s.name}</b> <span class="badge">(${s.type})</span></div>
          <div class="badge">Seat ${s.seat}</div>
        </div>
        <div class="badge">
          Stack: ${money(s.stack)} | Bet: ${money(s.bet)} | InHand: ${s.inHand} ${flags ? `| ${flags}` : ""}
        </div>
      `;
      seatsEl.appendChild(div);
    }
  }

  const handEl = $("yourHand");
  if (handEl) {
    handEl.innerHTML = "";
    const myHand = lastPrivate?.you?.hand || [];
    for (const c of myHand) {
      const chip = document.createElement("div");
      chip.className = "cardChip";
      chip.textContent = c;
      handEl.appendChild(chip);
    }
  }

  const myTurn = isMyTurn();
  const ids = ["btnFold","btnCheck","btnCall","btnRaise","btnMinRaise","btnPlusBB","btnPlus2BB","btnPot","btnAllIn"];
  for (const id of ids) {
    const b = $(id);
    if (b) b.disabled = !myTurn;
  }

  const hint = $("turnHint");
  if (hint) hint.textContent = myTurn ? "C'est ton tour." : "Attends ton tour (ou démarre une main).";

  const ended = (g.phase === "idle") && !!g.lastWinners;
  if (ended) {
    const txt = `${g.lastWinners.winners.join(" & ")} (${g.lastWinners.hand})`;
    showOverlay(true, txt);
  } else {
    showOverlay(false);
  }

  const raiseInput = $("raiseTo");
  if (myTurn && raiseInput && !raiseInput.value) {
    raiseInput.value = String(clampRaiseTo(minRaiseTo()));
  }
}

function sendAction(action) {
  const roomCode = myRoomCode();
  if (!roomCode) return setMsg("Mets un code room.");
  socket.emit("game:action", { roomCode, action }, (res) => {
    if (!res?.ok) setMsg(res?.error || "Action refusée");
    else setMsg("Action envoyée");
  });
}

// handlers (safe)
$("create")?.addEventListener("click", () => {
  const name = ($("name")?.value || "").trim() || "Joueur 1";
  socket.emit("room:create", { name }, (res) => {
    if (!res?.ok) return setMsg("Erreur création room");
    if ($("roomCode")) $("roomCode").value = res.roomCode;
    setMsg(`Room créée: ${res.roomCode}`);
  });
});

$("join")?.addEventListener("click", () => {
  const name = ($("name")?.value || "").trim() || "Joueur 2";
  const roomCode = myRoomCode();
  if (!roomCode) return setMsg("Mets un code room.");
  socket.emit("room:join", { roomCode, name }, (res) => {
    if (!res?.ok) return setMsg(res?.error || "Erreur join");
    setMsg(`Rejoint la room ${roomCode}`);
  });
});

$("startHand")?.addEventListener("click", () => {
  const roomCode = myRoomCode();
  if (!roomCode) return setMsg("Mets le code room avant de démarrer une main.");
  socket.emit("game:startHand", { roomCode }, (res) => {
    if (!res?.ok) return setMsg(res?.error || "Erreur startHand");
    setMsg("Main démarrée.");
    const raiseInput = $("raiseTo");
    if (raiseInput) raiseInput.value = "";
  });
});

$("btnFold")?.addEventListener("click", () => sendAction({ type: "fold" }));
$("btnCheck")?.addEventListener("click", () => sendAction({ type: "check" }));
$("btnCall")?.addEventListener("click", () => sendAction({ type: "call" }));
$("btnRaise")?.addEventListener("click", () => {
  const v = Number($("raiseTo")?.value);
  if (!Number.isFinite(v) || v <= 0) return setMsg("Mets un montant Raise To valide (ex: 60)");
  sendAction({ type: "raise", amount: clampRaiseTo(v) });
});

$("btnMinRaise")?.addEventListener("click", () => {
  const input = $("raiseTo");
  if (input) input.value = String(clampRaiseTo(minRaiseTo()));
});

$("btnPlusBB")?.addEventListener("click", () => {
  const g = lastPublic?.game;
  const input = $("raiseTo");
  if (!input) return;
  const base = Number(input.value) || clampRaiseTo(minRaiseTo());
  input.value = String(clampRaiseTo(base + (g?.bb || 0)));
});

$("btnPlus2BB")?.addEventListener("click", () => {
  const g = lastPublic?.game;
  const input = $("raiseTo");
  if (!input) return;
  const base = Number(input.value) || clampRaiseTo(minRaiseTo());
  input.value = String(clampRaiseTo(base + 2 * (g?.bb || 0)));
});

$("btnPot")?.addEventListener("click", () => {
  const g = lastPublic?.game;
  const input = $("raiseTo");
  if (!g || !input) return;
  input.value = String(clampRaiseTo((g.toCall || 0) + (g.pot || 0)));
});

$("btnAllIn")?.addEventListener("click", () => {
  const g = lastPublic?.game;
  const me = mySeat();
  const input = $("raiseTo");
  if (!g || !me || !input) return;
  const target = (g.toCall || 0) + ((me.stack || 0) + (me.bet || 0));
  input.value = String(clampRaiseTo(target));
});

$("btnCloseOverlay")?.addEventListener("click", () => showOverlay(false));
$("btnNextHand")?.addEventListener("click", () => {
  const roomCode = myRoomCode();
  socket.emit("game:startHand", { roomCode }, (res) => {
    if (!res?.ok) return setMsg(res?.error || "Erreur startHand");
    setMsg("Nouvelle main.");
    showOverlay(false);
    const raiseInput = $("raiseTo");
    if (raiseInput) raiseInput.value = "";
  });
});

setServerOnline(socket.connected);
