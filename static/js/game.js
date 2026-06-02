'use strict';

/* ── Init ───────────────────────────────────────────────────────────────── */
const socket = io();

const myName = sessionStorage.getItem('playerName') || '';
let state    = null;
let myCards  = [];

/* Timer state */
let timerInterval     = null;
let timerRefSeconds   = null;
let timerRefTimestamp = null;

/* Constants */
const TOTAL_TURN_SECONDS = 90;
const URGENT_THRESHOLD   = 30;
const RING_CIRC_SMALL    = 125.66;  // 2π × 20
const RING_CIRC_LARGE    = 188.50;  // 2π × 30

const SUITS_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS   = new Set(['H', 'D']);

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const potDisplay      = $('potDisplay');
const communityEl     = $('communityCards');
const phaseBadge      = $('phaseBadge');
const turnTimerEl     = $('turnTimer');
const timerText       = $('timerText');
const ringProgress    = $('ringProgress');
const myTurnTimerEl   = $('myTurnTimer');
const myTimerText     = $('myTimerText');
const myRingProgress  = $('myRingProgress');
const seatsContainer  = $('seatsContainer');
const myCardsEl       = $('myCards');
const myCardsLabel    = $('myCardsLabel');
const controlsBar     = $('controlsBar');
const foldBtn         = $('foldBtn');
const checkBtn        = $('checkBtn');
const callBtn         = $('callBtn');
const raiseBtn        = $('raiseBtn');
const raiseAmount     = $('raiseAmount');
const allinBtn        = $('allinBtn');
const lobbyOverlay    = $('lobbyOverlay');
const lobbyPlayers    = $('lobbyPlayers');
const startBtn        = $('startBtn');
const waitingText     = $('waitingText');
const showdownOverlay = $('showdownOverlay');
const showdownResults = $('showdownResults');
const showdownActions = $('showdownActions');
const turnStatusEl    = $('turnStatus');
const chatMessages    = $('chatMessages');
const chatInput       = $('chatInput');
const chatSend        = $('chatSend');
const chatCollapse    = $('chatCollapse');
const chatSidebar     = $('chatSidebar');
const copyBtn         = $('copyBtn');
const copyHint        = $('copyHint');
const myNameBadge     = $('myNameBadge');
const toastEl         = $('toast');

/* ── Rejoin on connect ───────────────────────────────────────────────────── */
socket.on('connect', () => {
    if (myName) {
        socket.emit('rejoin', { room_code: ROOM_CODE, name: myName });
    }
});

socket.on('joined', () => { /* server confirms, state will arrive via game_state */ });

/* ── game_state ─────────────────────────────────────────────────────────── */
socket.on('game_state', (s) => {
    state = s;
    if (s.turn_seconds_left != null && !['lobby', 'showdown'].includes(s.phase)) {
        timerRefSeconds   = s.turn_seconds_left;
        timerRefTimestamp = Date.now();
        startCountdown();
    } else {
        stopCountdown();
    }
    render();
});

/* ── Private cards ───────────────────────────────────────────────────────── */
socket.on('your_cards', (data) => {
    myCards = data.hole_cards || [];
    renderMyCards();
});

/* ── Showdown ────────────────────────────────────────────────────────────── */
socket.on('showdown', (data) => {
    showShowdown(data);
});

/* ── Chat ────────────────────────────────────────────────────────────────── */
socket.on('chat_message', (msg) => {
    appendChat(msg.name, msg.text);
});

/* ── Error & expiry ──────────────────────────────────────────────────────── */
socket.on('error', (data) => toast(data.message, true));

socket.on('game_expired', (data) => {
    toast(data.message, true);
    setTimeout(() => { window.location.href = '/'; }, 3500);
});

/* ── Render ──────────────────────────────────────────────────────────────── */
function render() {
    if (!state) return;

    myNameBadge.textContent = myName ? `Playing as ${myName}` : '';

    potDisplay.textContent = `Pot: ${state.pot}`;

    const phaseLabels = {
        lobby: '', preflop: 'Pre-Flop',
        flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown',
    };
    phaseBadge.textContent = phaseLabels[state.phase] || '';

    renderCommunityCards();
    renderSeats();
    renderMyCards();
    renderLobbyOverlay();
    renderControls();

    // Sync turn-status with current state immediately (timer interval updates it every second)
    const inBetting = !['lobby', 'showdown'].includes(state.phase);
    if (!inBetting || !state.current_player_sid) {
        if (turnStatusEl) { turnStatusEl.textContent = ''; turnStatusEl.className = 'turn-status'; }
    }
}

/* ── Countdown timer ─────────────────────────────────────────────────────── */
function startCountdown() {
    stopCountdown();
    const tick = () => {
        const elapsed   = Math.floor((Date.now() - timerRefTimestamp) / 1000);
        const remaining = Math.max(0, timerRefSeconds - elapsed);
        updateTimerDisplay(remaining);
        if (remaining <= 0) stopCountdown();
    };
    tick();
    timerInterval = setInterval(tick, 1000);
}

function stopCountdown() {
    clearInterval(timerInterval);
    timerInterval = null;
    updateTimerDisplay(null);
}

function updateTimerDisplay(remaining) {
    const active   = remaining != null && remaining > 0;
    const urgent   = active && remaining <= URGENT_THRESHOLD;
    const fraction = active ? Math.min(1, remaining / TOTAL_TURN_SECONDS) : 0;

    timerText.textContent = active ? remaining + 's' : '';
    ringProgress.style.strokeDashoffset = RING_CIRC_SMALL * (1 - fraction);
    turnTimerEl.classList.toggle('urgent', urgent);
    turnTimerEl.style.visibility = active ? 'visible' : 'hidden';

    const curPlayer = state && (state.players || []).find(p => p.sid === state.current_player_sid);
    const isCpu     = curPlayer && curPlayer.is_cpu;
    const isMyTurn  = state && state.current_player_sid === socket.id;
    const inBetting = state && !['lobby', 'showdown'].includes(state.phase);
    const showBig   = active && isMyTurn && inBetting && !isCpu;
    myTurnTimerEl.style.display = showBig ? 'flex' : 'none';
    if (showBig) {
        myTimerText.textContent = remaining;
        myRingProgress.style.strokeDashoffset = RING_CIRC_LARGE * (1 - fraction);
        myTurnTimerEl.classList.toggle('urgent', urgent);
    }

    updateTurnStatus(remaining, curPlayer, isMyTurn, inBetting, urgent);
}

function updateTurnStatus(remaining, curPlayer, isMyTurn, inBetting, urgent) {
    if (!turnStatusEl) return;
    if (!state || !inBetting || !state.current_player_sid || !curPlayer) {
        turnStatusEl.textContent = '';
        turnStatusEl.className = 'turn-status';
        return;
    }
    const active   = remaining != null && remaining > 0;
    const timeStr  = active ? ` — ${remaining}s` : '';
    const name     = isMyTurn ? 'Your turn' : `${curPlayer.name}'s turn`;
    turnStatusEl.textContent = name + timeStr;
    turnStatusEl.className   = 'turn-status' +
        (isMyTurn ? ' is-my-turn' : '') +
        (urgent   ? ' urgent'     : '');
}

/* Community cards */
function renderCommunityCards() {
    communityEl.innerHTML = '';
    const revealed = state.community_cards || [];
    for (let i = 0; i < 5; i++) {
        if (revealed[i]) {
            communityEl.appendChild(makeCard(revealed[i]));
        } else {
            const slot = document.createElement('div');
            slot.className = 'card-slot empty';
            communityEl.appendChild(slot);
        }
    }
}

/* Seats — DOM diffing to avoid flicker and animation resets */
function renderSeats() {
    const players  = state.players || [];
    const myIdx    = players.findIndex(p => p.name === myName);
    const liveSids = new Set(players.map(p => p.sid));
    const inBetting = !['lobby', 'showdown'].includes(state.phase);

    // Remove seats no longer in state
    seatsContainer.querySelectorAll('[data-sid]').forEach(el => {
        if (!liveSids.has(el.dataset.sid)) el.remove();
    });

    players.forEach((p, serverIdx) => {
        const displayIdx = myIdx >= 0
            ? (serverIdx - myIdx + players.length) % players.length
            : serverIdx;

        let seat = seatsContainer.querySelector(`[data-sid="${CSS.escape(p.sid)}"]`);

        if (!seat) {
            seat = document.createElement('div');
            seat.dataset.sid = p.sid;

            const nameEl  = document.createElement('div');
            nameEl.className = 'seat-name';
            const coinsEl = document.createElement('div');
            coinsEl.className = 'seat-coins';
            const betEl   = document.createElement('div');
            betEl.className = 'seat-bet';
            const statusEl = document.createElement('div');
            statusEl.className = 'seat-status';
            const cardsRow = document.createElement('div');
            cardsRow.className = 'seat-cards';
            const badgeEl  = document.createElement('div');
            badgeEl.className = 'seat-your-turn-badge';
            badgeEl.textContent = 'Your Turn';

            seat.appendChild(nameEl);
            seat.appendChild(coinsEl);
            seat.appendChild(betEl);
            seat.appendChild(statusEl);
            seat.appendChild(cardsRow);
            seat.appendChild(badgeEl);

            if (p.is_cpu) {
                const cpuBadge = document.createElement('div');
                cpuBadge.className = 'seat-cpu-badge';
                cpuBadge.textContent = '🤖 CPU';
                seat.appendChild(cpuBadge);
            }

            seatsContainer.appendChild(seat);
        }

        const isActive = p.sid === state.current_player_sid;
        const isLocal  = p.name === myName;

        seat.className = `seat seat-pos-${displayIdx}`;
        if (isActive)            seat.classList.add('active-turn');
        if (isActive && isLocal) seat.classList.add('is-local');
        if (p.folded)            seat.classList.add('folded-seat');
        if (p.sid === state.dealer_sid) seat.classList.add('dealer-seat');

        const nameEl   = seat.querySelector('.seat-name');
        const coinsEl  = seat.querySelector('.seat-coins');
        const betEl    = seat.querySelector('.seat-bet');
        const statusEl = seat.querySelector('.seat-status');
        const cardsRow = seat.querySelector('.seat-cards');

        nameEl.className  = 'seat-name' + (isLocal ? ' is-you' : '');
        nameEl.textContent = p.name + (isLocal ? ' (You)' : '');

        coinsEl.textContent = `${p.coins} coins`;
        betEl.textContent   = p.bet > 0 ? `Bet: ${p.bet}` : '';

        statusEl.textContent = p.folded ? 'Folded'
            : p.all_in ? 'All-In'
            : !p.connected && !p.is_cpu ? 'Away'
            : '';

        const neededCards = (!isLocal && state.phase !== 'lobby') ? 2 : 0;
        if (cardsRow.children.length !== neededCards) {
            cardsRow.innerHTML = '';
            for (let i = 0; i < neededCards; i++) {
                const back = document.createElement('div');
                back.className = 'card back';
                cardsRow.appendChild(back);
            }
        }
    });

    seatsContainer.dataset.players = players.length;
    seatsContainer.classList.toggle('in-betting', inBetting && !!state.current_player_sid);

    const tableArea = document.querySelector('.table-area');
    if (tableArea) tableArea.dataset.playerCount = players.length;
}

/* My hole cards */
function renderMyCards() {
    myCardsEl.innerHTML = '';
    if (myCards.length === 0) {
        myCardsLabel.textContent = '';
        return;
    }
    myCardsLabel.textContent = 'Your Cards';
    myCards.forEach(c => myCardsEl.appendChild(makeCard(c, true)));
}

/* Lobby overlay */
function renderLobbyOverlay() {
    if (state.phase === 'lobby') {
        lobbyOverlay.classList.add('active');
        showdownOverlay.style.display = 'none';

        lobbyPlayers.innerHTML = '';
        (state.players || []).forEach(p => {
            const row = document.createElement('div');
            row.className = 'lobby-player';
            row.innerHTML = `
                <span class="lp-name">${esc(p.name)}${p.name === myName ? ' (You)' : ''}</span>
                ${p.is_host ? '<span class="lp-host">Host</span>' : ''}
                <span class="lp-coins">${p.coins} coins</span>
            `;
            lobbyPlayers.appendChild(row);
        });

        const isHost = socket.id === state.host_sid;
        const connectedCount = (state.players || []).filter(p => p.connected && !p.is_cpu).length;
        const enough = connectedCount >= 2;
        const maxP = state.max_players || 6;
        startBtn.style.display  = isHost ? 'inline-block' : 'none';
        waitingText.style.display = isHost ? 'none' : 'block';
        startBtn.disabled = !enough;
        startBtn.textContent = enough
            ? `Start Game (${connectedCount}/${maxP})`
            : `Waiting for players… (${connectedCount}/${maxP})`;

        // CPU button for 2-player games when host is alone
        const lobbyFooter = $('lobbyFooter');
        const existingCpuBtn = lobbyFooter ? lobbyFooter.querySelector('.btn-cpu') : null;
        if (existingCpuBtn) existingCpuBtn.remove();
        const isTwoPlayer = state.max_players === 2;
        const noCpu = !(state.players || []).some(p => p.is_cpu);
        if (isHost && isTwoPlayer && connectedCount === 1 && noCpu && lobbyFooter) {
            const cpuBtn = document.createElement('button');
            cpuBtn.className = 'big-btn btn-cpu';
            cpuBtn.textContent = 'Play vs CPU';
            cpuBtn.onclick = () => socket.emit('start_with_cpu', {});
            lobbyFooter.appendChild(cpuBtn);
        }
    } else {
        lobbyOverlay.classList.remove('active');
    }
}

/* Betting controls */
function renderControls() {
    const isMyTurn = state.current_player_sid === socket.id;
    const inBetting = !['lobby', 'showdown'].includes(state.phase);

    controlsBar.style.display = (isMyTurn && inBetting) ? '' : 'none';
    if (!isMyTurn || !inBetting) return;

    const me = (state.players || []).find(p => p.name === myName);
    if (!me) return;

    const toCall = state.current_bet - me.bet;
    const canCheck = me.bet >= state.current_bet;

    checkBtn.disabled = !canCheck;
    callBtn.disabled  = canCheck || me.coins === 0;
    callBtn.textContent = toCall > 0 ? `Call ${toCall}` : 'Call';

    const minRaise = state.min_raise || 20;
    const minRaiseTotal = state.current_bet + minRaise;
    const maxRaise = me.coins + me.bet;
    raiseAmount.min   = minRaiseTotal;
    raiseAmount.max   = maxRaise;
    if (!raiseAmount.value || +raiseAmount.value < minRaiseTotal) {
        raiseAmount.value = Math.min(minRaiseTotal, maxRaise);
    }
    raiseBtn.disabled  = me.coins === 0 || maxRaise < minRaiseTotal;
    allinBtn.disabled  = me.coins === 0;
    allinBtn.textContent = `All-in (${me.coins + me.bet})`;
}

/* ── Card helpers ────────────────────────────────────────────────────────── */
function makeCard(card, large) {
    const el = document.createElement('div');
    el.className = 'card' + (RED_SUITS.has(card.suit) ? ' red' : '');

    const rankEl = document.createElement('div');
    rankEl.className = 'rank';
    rankEl.textContent = card.rank === 'T' ? '10' : card.rank;

    const suitEl = document.createElement('div');
    suitEl.className = 'suit';
    suitEl.textContent = SUITS_GLYPH[card.suit] || card.suit;

    el.appendChild(rankEl);
    el.appendChild(suitEl);
    return el;
}

/* ── Showdown modal ──────────────────────────────────────────────────────── */
function showShowdown(data) {
    showdownResults.innerHTML = '';

    (data.results || []).forEach(r => {
        const row = document.createElement('div');
        row.className = 'sd-result' + (r.won ? ' winner' : '');

        const crown = r.won ? '👑' : '  ';
        const revealedEntry = (data.revealed || []).find(rv => rv.name === r.name);

        let cardsHtml = '';
        if (revealedEntry) {
            cardsHtml = '<div class="sd-cards">' +
                revealedEntry.cards.map(c => cardHtml(c)).join('') +
                '</div>';
        }

        row.innerHTML = `
            <div class="sd-winner-crown">${crown}</div>
            <div class="sd-info">
                <div class="sd-name">${esc(r.name)}</div>
                <div class="sd-label">${esc(r.label)}</div>
            </div>
            ${cardsHtml}
            <div class="sd-amount">${r.won ? '+' + r.amount : ''}</div>
        `;
        showdownResults.appendChild(row);
    });

    showdownActions.innerHTML = '';
    const isHost = socket.id === state.host_sid;
    if (isHost) {
        const nextBtn = document.createElement('button');
        nextBtn.className = 'big-btn btn-next';
        nextBtn.textContent = 'Next Round';
        nextBtn.onclick = () => {
            socket.emit('next_round', {});
            showdownOverlay.style.display = 'none';
        };

        const resetBtn = document.createElement('button');
        resetBtn.className = 'big-btn btn-reset';
        resetBtn.textContent = 'New Game (reset coins)';
        resetBtn.onclick = () => {
            socket.emit('new_session', {});
            showdownOverlay.style.display = 'none';
        };

        showdownActions.appendChild(nextBtn);
        showdownActions.appendChild(resetBtn);
    } else {
        showdownActions.innerHTML = '<p style="color:#90b890;font-size:0.85rem;">Waiting for host to start next round…</p>';
    }

    showdownOverlay.style.display = 'flex';
}

function cardHtml(c) {
    const cls = RED_SUITS.has(c.suit) ? 'card red' : 'card';
    const rank = c.rank === 'T' ? '10' : c.rank;
    return `<div class="${cls}"><div class="rank">${rank}</div><div class="suit">${SUITS_GLYPH[c.suit] || c.suit}</div></div>`;
}

/* ── Action buttons ──────────────────────────────────────────────────────── */
foldBtn.addEventListener('click', () => {
    socket.emit('player_action', { action: 'fold', amount: 0 });
});

checkBtn.addEventListener('click', () => {
    socket.emit('player_action', { action: 'check', amount: 0 });
});

callBtn.addEventListener('click', () => {
    socket.emit('player_action', { action: 'call', amount: 0 });
});

raiseBtn.addEventListener('click', () => {
    const amt = parseInt(raiseAmount.value, 10);
    if (isNaN(amt)) { toast('Enter a valid raise amount'); return; }
    socket.emit('player_action', { action: 'raise', amount: amt });
});

allinBtn.addEventListener('click', () => {
    socket.emit('player_action', { action: 'allin', amount: 0 });
});

/* ── Lobby start ─────────────────────────────────────────────────────────── */
startBtn.addEventListener('click', () => {
    socket.emit('start_game', {});
});

/* ── Chat ────────────────────────────────────────────────────────────────── */
function appendChat(name, text, system) {
    const msg = document.createElement('div');
    msg.className = 'chat-msg' + (system ? ' system' : '');
    if (system) {
        msg.innerHTML = `<span class="msg-text">${esc(text)}</span>`;
    } else {
        msg.innerHTML = `<span class="msg-name">${esc(name)}:</span><span class="msg-text">${esc(text)}</span>`;
    }
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat_message', { text });
    chatInput.value = '';
}

chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
});

/* Chat collapse (mobile) */
let chatOpen = false;
chatCollapse.addEventListener('click', () => {
    chatOpen = !chatOpen;
    chatSidebar.classList.toggle('open', chatOpen);
    chatCollapse.textContent = chatOpen ? '×' : '−';
});

/* ── Copy room code ──────────────────────────────────────────────────────── */
copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(ROOM_CODE).then(() => {
        copyHint.textContent = 'Copied!';
        setTimeout(() => { copyHint.textContent = ''; }, 2000);
    }).catch(() => {
        copyHint.textContent = ROOM_CODE;
    });
});

/* ── Toast ───────────────────────────────────────────────────────────────── */
let toastTimer = null;
function toast(msg, isError) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.style.borderColor = isError ? 'rgba(255,100,100,0.4)' : 'rgba(255,255,255,0.15)';
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

/* ── XSS escape ──────────────────────────────────────────────────────────── */
function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
