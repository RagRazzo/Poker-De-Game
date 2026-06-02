'use strict';

const socket = io();

const playerNameInput = document.getElementById('playerName');
const roomCodeInput   = document.getElementById('roomCode');
const createBtn       = document.getElementById('createBtn');
const joinBtn         = document.getElementById('joinBtn');
const errorMsg        = document.getElementById('errorMsg');

function showError(msg) {
    errorMsg.textContent = msg;
    setTimeout(() => { errorMsg.textContent = ''; }, 4000);
}

/* Pre-fill the room code when arriving from an invite link (/?join=CODE) so a
   new player only has to enter their name and hit Join. */
const inviteCode = new URLSearchParams(window.location.search).get('join');
if (inviteCode) {
    roomCodeInput.value = inviteCode.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
    playerNameInput.focus();
}

roomCodeInput.addEventListener('input', () => {
    roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, '');
});

createBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (!name) { showError('Please enter your name first'); return; }
    const maxPlayersEl = document.getElementById('maxPlayers');
    const max_players = maxPlayersEl ? parseInt(maxPlayersEl.value, 10) : 6;
    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';
    socket.emit('create_game', { name, max_players });
});

joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    const code = roomCodeInput.value.trim();
    if (!name) { showError('Please enter your name first'); return; }
    if (code.length !== 6) { showError('Room code must be exactly 6 characters'); return; }
    joinBtn.disabled = true;
    joinBtn.textContent = 'Joining…';
    socket.emit('join_game', { name, room_code: code });
});

playerNameInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const code = roomCodeInput.value.trim();
    if (code.length === 6) joinBtn.click();
    else createBtn.click();
});

roomCodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
});

socket.on('game_created', (data) => {
    sessionStorage.setItem('playerName', playerNameInput.value.trim());
    sessionStorage.setItem('roomCode', data.room_code);
    window.location.href = '/game/' + data.room_code;
});

socket.on('joined', (data) => {
    sessionStorage.setItem('playerName', playerNameInput.value.trim());
    sessionStorage.setItem('roomCode', data.room_code);
    window.location.href = '/game/' + data.room_code;
});

socket.on('error', (data) => {
    showError(data.message);
    createBtn.disabled = false;
    createBtn.textContent = 'Create New Game';
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join';
});
