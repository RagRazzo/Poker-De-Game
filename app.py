import eventlet
eventlet.monkey_patch()

import os
import json
import time
import random

from flask import Flask, render_template, request, redirect, url_for
from flask_socketio import SocketIO, join_room, leave_room, emit

from poker import PokerGame

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-key-change-in-prod")

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="eventlet",
    ping_timeout=60,
    ping_interval=25,
)

GAMES = {}        # room_code → PokerGame
SID_TO_ROOM = {}  # socket_id → room_code

ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

os.makedirs("games", exist_ok=True)

# Reload persisted games on startup
for fname in os.listdir("games"):
    if fname.endswith(".json"):
        try:
            with open(f"games/{fname}") as f:
                data = json.load(f)
            game = PokerGame.from_json(data)
            GAMES[game.room_code] = game
        except Exception:
            pass


# ── Helpers ────────────────────────────────────────────────────────────────

def gen_room_code():
    while True:
        code = "".join(random.choices(ROOM_CODE_CHARS, k=6))
        if code not in GAMES:
            return code


def save(game):
    try:
        with open(f"games/{game.room_code}.json", "w") as f:
            json.dump(game.to_json(), f)
    except Exception:
        pass


def broadcast_state(game):
    socketio.emit("game_state", game.public_state(), room=game.room_code)
    for p in game.players:
        if p["connected"] and p["hole_cards"]:
            socketio.emit("your_cards", {"hole_cards": p["hole_cards"]}, to=p["sid"])


# ── HTTP Routes ────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/game/<room_code>")
def game_room(room_code):
    code = room_code.upper()
    if code not in GAMES:
        return redirect(url_for("index"))
    return render_template("game.html", room_code=code)


@app.route("/health")
def health():
    return "ok"


# ── Socket.IO Events ───────────────────────────────────────────────────────

@socketio.on("create_game")
def on_create_game(data):
    name = (data.get("name") or "").strip()[:16]
    if not name:
        emit("error", {"message": "Name is required"})
        return
    code = gen_room_code()
    game = PokerGame(code, request.sid, name)
    GAMES[code] = game
    SID_TO_ROOM[request.sid] = code
    join_room(code)
    save(game)
    emit("game_created", {"room_code": code})
    broadcast_state(game)


@socketio.on("join_game")
def on_join_game(data):
    name = (data.get("name") or "").strip()[:16]
    code = (data.get("room_code") or "").strip().upper()
    if not name:
        emit("error", {"message": "Name is required"})
        return
    if code not in GAMES:
        emit("error", {"message": "Room not found — check the code and try again"})
        return
    game = GAMES[code]
    ok, msg = game.add_player(request.sid, name)
    if not ok:
        emit("error", {"message": msg})
        return
    SID_TO_ROOM[request.sid] = code
    join_room(code)
    save(game)
    emit("joined", {"room_code": code, "name": name})
    broadcast_state(game)


@socketio.on("rejoin")
def on_rejoin(data):
    name = (data.get("name") or "").strip()[:16]
    code = (data.get("room_code") or "").strip().upper()
    if code not in GAMES:
        emit("error", {"message": "Room not found or expired"})
        return
    game = GAMES[code]
    ok, msg = game.reconnect_player(name, request.sid)
    if not ok:
        emit("error", {"message": msg})
        return
    SID_TO_ROOM[request.sid] = code
    join_room(code)
    save(game)
    cards = game.private_cards(request.sid)
    if cards:
        emit("your_cards", {"hole_cards": cards})
    emit("joined", {"room_code": code, "name": name})
    broadcast_state(game)


@socketio.on("start_game")
def on_start_game(data):
    code = SID_TO_ROOM.get(request.sid)
    if not code or code not in GAMES:
        emit("error", {"message": "Not in a game"})
        return
    game = GAMES[code]
    if not game.can_start(request.sid):
        emit("error", {"message": "Only the host can start, and you need 2–6 players"})
        return
    ok, msg = game.start_round()
    if not ok:
        emit("error", {"message": msg})
        return
    save(game)
    broadcast_state(game)


@socketio.on("player_action")
def on_player_action(data):
    code = SID_TO_ROOM.get(request.sid)
    if not code or code not in GAMES:
        emit("error", {"message": "Not in a game"})
        return
    game = GAMES[code]
    action = (data.get("action") or "").strip()
    try:
        amount = int(data.get("amount", 0))
    except (ValueError, TypeError):
        amount = 0

    ok, msg = game.player_action(request.sid, action, amount)
    if not ok:
        emit("error", {"message": msg})
        return

    if game.phase == "showdown":
        results = game.determine_winner()
        revealed = [
            {"name": r["name"], "cards": r["hole_cards"]}
            for r in results
            if r.get("hole_cards")
        ]
        socketio.emit(
            "showdown",
            {
                "pot": sum(r["amount"] for r in results),
                "results": [
                    {"name": r["name"], "label": r["label"],
                     "amount": r["amount"], "won": r["won"]}
                    for r in results
                ],
                "revealed": revealed,
            },
            room=code,
        )

    save(game)
    broadcast_state(game)


@socketio.on("next_round")
def on_next_round(data):
    code = SID_TO_ROOM.get(request.sid)
    if not code or code not in GAMES:
        return
    game = GAMES[code]
    if game.host_sid != request.sid:
        emit("error", {"message": "Only the host can start the next round"})
        return
    game.reset_for_next_round()
    ok, msg = game.start_round()
    if not ok:
        emit("error", {"message": msg})
        return
    save(game)
    broadcast_state(game)


@socketio.on("new_session")
def on_new_session(data):
    code = SID_TO_ROOM.get(request.sid)
    if not code or code not in GAMES:
        return
    game = GAMES[code]
    if game.host_sid != request.sid:
        emit("error", {"message": "Only the host can start a new session"})
        return
    game.reset_session()
    save(game)
    broadcast_state(game)


@socketio.on("chat_message")
def on_chat_message(data):
    code = SID_TO_ROOM.get(request.sid)
    if not code or code not in GAMES:
        return
    game = GAMES[code]
    player = game.get_player(request.sid)
    if not player:
        return
    text = (data.get("text") or "").strip()[:300]
    if not text:
        return
    game.touch()
    save(game)
    socketio.emit(
        "chat_message",
        {"name": player["name"], "text": text, "ts": int(time.time() * 1000)},
        room=code,
    )


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    code = SID_TO_ROOM.pop(sid, None)
    if not code or code not in GAMES:
        return
    game = GAMES[code]
    game.remove_player(sid)

    remaining = [p for p in game.players if p["connected"]]
    if not remaining:
        GAMES.pop(code, None)
        try:
            os.remove(f"games/{code}.json")
        except FileNotFoundError:
            pass
        return

    save(game)
    broadcast_state(game)


# ── Cleanup background task ────────────────────────────────────────────────

def cleanup_loop():
    while True:
        eventlet.sleep(60)
        now = time.time()
        for code in list(GAMES):
            game = GAMES.get(code)
            if game and now - game.last_activity > 15 * 60:
                socketio.emit(
                    "game_expired",
                    {"message": "Room closed due to inactivity (15 min)"},
                    room=code,
                )
                GAMES.pop(code, None)
                try:
                    os.remove(f"games/{code}.json")
                except FileNotFoundError:
                    pass


socketio.start_background_task(cleanup_loop)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, debug=False)
