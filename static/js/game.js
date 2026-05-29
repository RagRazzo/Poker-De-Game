'use strict';

/* ── Init ───────────────────────────────────────────────────────────────── */
const socket = io();

const myName = sessionStorage.getItem('playerName') || '';
let state    = null;
let myCards  = [];

const SUITS_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS   = new Set(['H', 'D']);

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const potDisplay      = $('potDisplay');
const communityEl     = $('communityCards');
const phaseBadge      = $('phaseBadge');
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

/* Seats */
function renderSeats() {
    seatsContainer.innerHTML = '';
    const players = state.players || [];
    const myIdx   = players.findIndex(p => p.name === myName);

    players.forEach((p, serverIdx) => {
        // Rotate so local player is always seat 0
        const displayIdx = myIdx >= 0
            ? (serverIdx - myIdx + players.length) % players.length
            : serverIdx;
        const posClass = `seat-pos-${displayIdx}`;

        const seat = document.createElement('div');
        seat.className = 'seat ' + posClass;
        if (p.sid === state.current_player_sid) seat.classList.add('active-turn');
        if (p.folded) seat.classList.add('folded-seat');
        if (p.sid === state.dealer_sid) seat.classList.add('dealer-seat');

        const nameEl = document.createElement('div');
        nameEl.className = 'seat-name' + (p.name === myName ? ' is-you' : '');
        nameEl.textContent = p.name + (p.name === myName ? ' (You)' : '');

        const coinsEl = document.createElement('div');
        coinsEl.className = 'seat-coins';
        coinsEl.textContent = `${p.coins} coins`;

        const betEl = document.createElement('div');
        betEl.className = 'seat-bet';
        betEl.textContent = p.bet > 0 ? `Bet: ${p.bet}` : '';

        const statusEl = document.createElement('div');
        statusEl.className = 'seat-status';
        if (p.folded)    statusEl.textContent = 'Folded';
        else if (p.all_in) statusEl.textContent = 'All-In';
        else if (!p.connected) statusEl.textContent = 'Away';

        // Cards for non-local players
        const cardsRow = document.createElement('div');
        cardsRow.className = 'seat-cards';
        if (p.name !== myName && state.phase !== 'lobby') {
            for (let i = 0; i < 2; i++) {
                const back = document.createElement('div');
                back.className = 'card back';
                cardsRow.appendChild(back);
            }
        }

        seat.appendChild(nameEl);
        seat.appendChild(coinsEl);
        seat.appendChild(betEl);
        seat.appendChild(statusEl);
        seat.appendChild(cardsRow);
        seatsContainer.appendChild(seat);
    });
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
        const enough = (state.players || []).length >= 2;
        startBtn.style.display  = isHost ? 'inline-block' : 'none';
        waitingText.style.display = isHost ? 'none' : 'block';
        startBtn.disabled = !enough;
        startBtn.textContent = enough ? 'Start Game' : 'Need 2+ players';
    } else {
        lobbyOverlay.classList.remove('active');
    }
}

/* Betting controls */
function renderControls() {
    const isMyTurn = state.current_player_sid === socket.id;
    const inBetting = !['lobby', 'showdown'].includes(state.phase);

    controlsBar.style.display = (isMyTurn && inBetting) ? 'flex' : 'none';
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
