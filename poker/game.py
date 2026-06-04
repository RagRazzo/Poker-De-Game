import time
from .deck import Deck
from .hand_evaluator import evaluate_hand

SMALL_BLIND = 10
BIG_BLIND = 20
STARTING_COINS = 1000
AFK_TIMEOUT = 90   # seconds before CPU takes over
CPU_SID = "__cpu__"


class PokerGame:
    def __init__(self, room_code, host_sid, host_name, max_players=6):
        self.room_code = room_code
        self.phase = "lobby"
        self.players = []
        self.community_cards = []
        self.deck = []
        self.pot = 0
        self.current_bet = 0
        self.dealer_index = 0
        self.current_player_index = 0
        self.host_sid = host_sid
        self.last_activity = time.time()
        self.started = False
        self.min_raise = BIG_BLIND
        self.last_aggressor_index = -1
        self.max_players = max(2, min(6, max_players))
        self.turn_started_at = None   # set whenever a player's turn begins
        self.last_results = None      # cached showdown results (None until resolved)

        self.add_player(host_sid, host_name, is_host=True)

    def touch(self):
        self.last_activity = time.time()

    # ── Player management ──────────────────────────────────────────────────

    def add_player(self, sid, name, is_host=False):
        if self.phase != "lobby":
            return False, "Game already in progress"
        # Count only connected (or disconnected-but-still-seated) non-hosts
        if len(self.players) >= self.max_players:
            return False, f"Game is full ({self.max_players} players max)"
        name = (name or "").strip()
        if not name:
            return False, "Name cannot be empty"
        if any(p["name"].lower() == name.lower() for p in self.players):
            return False, "Name already taken"

        self.players.append({
            "sid": sid,
            "name": name,
            "coins": STARTING_COINS,
            "bet": 0,
            "total_bet": 0,
            "folded": False,
            "all_in": False,
            "hole_cards": [],
            "connected": True,
            "is_host": is_host,
            "has_acted": False,
        })
        self.touch()
        return True, "ok"

    def get_player(self, sid):
        for p in self.players:
            if p["sid"] == sid:
                return p
        return None

    def get_player_by_name(self, name):
        name = (name or "").strip().lower()
        for p in self.players:
            if p["name"].lower() == name:
                return p
        return None

    def remove_player(self, sid):
        """Mark a player as disconnected without removing their seat.

        Keeping the seat means:
        - The game isn't deleted when the host briefly disconnects during a page
          navigation (index.html → game.html race condition).
        - AFK timeout or the cleanup_loop handles truly-gone players.
        """
        player = self.get_player(sid)
        if not player:
            return
        player["connected"] = False

        if self.phase not in ("lobby", "showdown"):
            # Auto-fold immediately if it's their turn mid-hand
            if self.players[self.current_player_index]["sid"] == sid:
                self._do_fold(player)
                self._advance_turn()

        self.touch()

    def mark_disconnected(self, sid):
        self.remove_player(sid)

    def reconnect_player(self, name, new_sid):
        player = self.get_player_by_name(name)
        if not player:
            return False, "Player not found in this room"
        player["sid"] = new_sid
        player["connected"] = True
        if player["is_host"]:
            self.host_sid = new_sid
        self.touch()
        return True, "ok"

    def can_start(self, sid):
        connected = [p for p in self.players if p["connected"]]
        return (
            sid == self.host_sid
            and 2 <= len(connected) <= self.max_players
            and self.phase == "lobby"
        )

    # ── Round management ───────────────────────────────────────────────────

    def _eligible_players(self):
        return [p for p in self.players if p["coins"] > 0]

    def _non_folded(self):
        return [p for p in self.players if not p["folded"]]

    def _can_act(self):
        return [p for p in self.players if not p["folded"] and not p["all_in"]]

    def start_round(self):
        eligible = [p for p in self.players if p["coins"] > 0 and p["connected"]]
        if len(eligible) < 2:
            return False, "Not enough connected players with coins"

        d = Deck()
        d.shuffle()
        self.deck = d.cards[:]

        self.community_cards = []
        self.pot = 0
        self.current_bet = 0
        self.min_raise = BIG_BLIND
        self.last_results = None

        for p in self.players:
            p["bet"] = 0
            p["total_bet"] = 0
            p["folded"] = p["coins"] == 0 or not p["connected"]
            p["all_in"] = False
            p["hole_cards"] = []
            p["has_acted"] = False

        # Advance dealer among eligible seats
        if not self.started:
            for i, p in enumerate(self.players):
                if p["coins"] > 0 and p["connected"]:
                    self.dealer_index = i
                    break
        else:
            start = (self.dealer_index + 1) % len(self.players)
            for i in range(len(self.players)):
                idx = (start + i) % len(self.players)
                if self.players[idx]["coins"] > 0 and self.players[idx]["connected"]:
                    self.dealer_index = idx
                    break

        self._post_blinds()
        self._deal_hole_cards()
        self.phase = "preflop"
        self.started = True

        bb_idx = self._big_blind_index()
        utg = self._next_active_from(bb_idx)
        self.current_player_index = utg if utg != -1 else bb_idx
        self.last_aggressor_index = bb_idx
        self.turn_started_at = time.time()

        self.touch()
        return True, "ok"

    def _small_blind_index(self):
        start = (self.dealer_index + 1) % len(self.players)
        for i in range(len(self.players)):
            idx = (start + i) % len(self.players)
            if not self.players[idx]["folded"]:
                return idx
        return start

    def _big_blind_index(self):
        sb = self._small_blind_index()
        start = (sb + 1) % len(self.players)
        for i in range(len(self.players)):
            idx = (start + i) % len(self.players)
            if not self.players[idx]["folded"]:
                return idx
        return start

    def _post_blinds(self):
        sb_idx = self._small_blind_index()
        bb_idx = self._big_blind_index()
        self._place_bet(self.players[sb_idx], SMALL_BLIND)
        self._place_bet(self.players[bb_idx], BIG_BLIND)
        self.current_bet = BIG_BLIND

    def _place_bet(self, player, amount):
        actual = min(amount, player["coins"])
        player["coins"] -= actual
        player["bet"] += actual
        player["total_bet"] += actual
        self.pot += actual
        if player["coins"] == 0:
            player["all_in"] = True

    def _deal_hole_cards(self):
        for p in self.players:
            if not p["folded"]:
                p["hole_cards"] = self.deck[:2]
                self.deck = self.deck[2:]

    def _next_active_from(self, idx):
        start = (idx + 1) % len(self.players)
        for i in range(len(self.players)):
            check = (start + i) % len(self.players)
            p = self.players[check]
            if not p["folded"] and not p["all_in"]:
                return check
        return -1

    # ── Betting ────────────────────────────────────────────────────────────

    def player_action(self, sid, action, amount=0):
        if self.phase in ("lobby", "showdown"):
            return False, "Not in a betting phase"

        player = self.players[self.current_player_index]
        if player["sid"] != sid:
            return False, "Not your turn"

        if action == "fold":
            self._do_fold(player)

        elif action == "check":
            if player["bet"] < self.current_bet:
                return False, "Cannot check — there is a bet to call"
            player["has_acted"] = True

        elif action == "call":
            to_call = self.current_bet - player["bet"]
            self._place_bet(player, to_call)
            player["has_acted"] = True

        elif action == "raise":
            min_total = self.current_bet + self.min_raise
            all_in_total = player["coins"] + player["bet"]
            if amount < min_total and amount != all_in_total:
                return False, f"Minimum raise is to {min_total}"
            if amount > all_in_total:
                return False, "Cannot raise more than you have"
            to_add = amount - player["bet"]
            self._place_bet(player, to_add)
            self.min_raise = max(self.min_raise, amount - self.current_bet)
            self.current_bet = max(self.current_bet, amount)
            self.last_aggressor_index = self.current_player_index
            for other in self.players:
                if other["sid"] != sid and not other["folded"] and not other["all_in"]:
                    other["has_acted"] = False
            player["has_acted"] = True

        elif action == "allin":
            all_in_total = player["coins"] + player["bet"]
            self._place_bet(player, player["coins"])
            if all_in_total > self.current_bet:
                self.min_raise = max(self.min_raise, all_in_total - self.current_bet)
                self.current_bet = all_in_total
                self.last_aggressor_index = self.current_player_index
                for other in self.players:
                    if other["sid"] != sid and not other["folded"] and not other["all_in"]:
                        other["has_acted"] = False
            player["has_acted"] = True

        else:
            return False, "Unknown action"

        self.touch()
        self._advance_turn()
        return True, "ok"

    def add_cpu_player(self):
        self.players.append({
            "sid": CPU_SID,
            "name": "CPU",
            "coins": STARTING_COINS,
            "bet": 0,
            "total_bet": 0,
            "folded": False,
            "all_in": False,
            "hole_cards": [],
            "connected": True,
            "is_host": False,
            "has_acted": False,
            "is_cpu": True,
        })
        self.touch()

    def cpu_action(self):
        """Simple CPU: check for free, call cheap bets, fold everything else."""
        player = self.players[self.current_player_index]
        to_call = self.current_bet - player["bet"]

        if to_call == 0:
            return "check", 0
        if player["coins"] > 0 and to_call <= player["coins"] // 4:
            return "call", 0
        if player["coins"] == 0:
            return "call", 0   # already all-in effectively
        return "fold", 0

    def _do_fold(self, player):
        player["folded"] = True
        player["has_acted"] = True

    def _betting_round_complete(self):
        non_folded = self._non_folded()
        if len(non_folded) <= 1:
            return True
        can_act = self._can_act()
        if not can_act:
            return True
        for p in can_act:
            if not p["has_acted"] or p["bet"] < self.current_bet:
                return False
        return True

    def _advance_turn(self):
        if len(self._non_folded()) <= 1:
            self.advance_phase(force_showdown=True)
            self.turn_started_at = None
            return
        if self._betting_round_complete():
            self.advance_phase()
            # turn_started_at is set inside advance_phase if there is an active player
            return
        next_idx = self._next_active_from(self.current_player_index)
        if next_idx == -1:
            self.advance_phase()
            return
        self.current_player_index = next_idx
        self.turn_started_at = time.time()

    def advance_phase(self, force_showdown=False):
        if force_showdown or self.phase == "river":
            self.phase = "showdown"
            self.turn_started_at = None
            return

        for p in self.players:
            p["bet"] = 0
            p["has_acted"] = False
        self.current_bet = 0
        self.min_raise = BIG_BLIND

        if self.phase == "preflop":
            self.community_cards = self.deck[:3]
            self.deck = self.deck[3:]
            self.phase = "flop"
        elif self.phase == "flop":
            self.community_cards.append(self.deck[0])
            self.deck = self.deck[1:]
            self.phase = "turn"
        elif self.phase == "turn":
            self.community_cards.append(self.deck[0])
            self.deck = self.deck[1:]
            self.phase = "river"

        # First active player left of dealer
        start = self.dealer_index
        for i in range(len(self.players)):
            idx = (start + 1 + i) % len(self.players)
            p = self.players[idx]
            if not p["folded"] and not p["all_in"]:
                self.current_player_index = idx
                self.last_aggressor_index = -1
                self.turn_started_at = time.time()
                return

        # Everyone is all-in — keep advancing until showdown
        self.turn_started_at = None
        self.advance_phase()

    # ── Showdown ───────────────────────────────────────────────────────────

    def determine_winner(self):
        non_folded = self._non_folded()
        results = []

        if len(non_folded) == 1:
            winner = non_folded[0]
            winner["coins"] += self.pot
            results.append({
                "name": winner["name"],
                "label": "Last player standing",
                "amount": self.pot,
                "won": True,
                "hole_cards": winner["hole_cards"],
            })
            self.pot = 0
            return results

        evaluations = []
        for p in non_folded:
            ev = evaluate_hand(p["hole_cards"], self.community_cards)
            evaluations.append((p, ev))

        all_contributors = [p for p in self.players if p["total_bet"] > 0]
        bet_levels = sorted(set(p["total_bet"] for p in all_contributors))

        prev_level = 0
        awarded_names = set()

        for level in bet_levels:
            pot_slice = sum(
                min(p["total_bet"], level) - min(p["total_bet"], prev_level)
                for p in all_contributors
            )
            if pot_slice <= 0:
                prev_level = level
                continue

            eligible = [(p, ev) for p, ev in evaluations if p["total_bet"] >= level]
            if not eligible:
                prev_level = level
                continue

            best_score = max(ev["score"] for _, ev in eligible)
            winners = [(p, ev) for p, ev in eligible if ev["score"] == best_score]

            share = pot_slice // len(winners)
            remainder = pot_slice % len(winners)

            for i, (p, ev) in enumerate(winners):
                award = share + (remainder if i == 0 else 0)
                p["coins"] += award
                awarded_names.add(p["name"])
                existing = next((r for r in results if r["name"] == p["name"] and r["won"]), None)
                if existing:
                    existing["amount"] += award
                else:
                    results.append({
                        "name": p["name"],
                        "label": ev["label"],
                        "amount": award,
                        "won": True,
                        "hole_cards": p["hole_cards"],
                    })

            prev_level = level

        for p, ev in evaluations:
            if p["name"] not in awarded_names:
                results.append({
                    "name": p["name"],
                    "label": ev["label"],
                    "amount": 0,
                    "won": False,
                    "hole_cards": p["hole_cards"],
                })

        self.pot = 0
        return results

    def resolve_showdown(self):
        """Award the pot and cache results — exactly once per hand.

        Safe to call from any code path that may have reached showdown
        (a player's action, an AFK/CPU timeout, or a disconnect that
        folds the last opponent). Returns the cached results, or None if
        the hand is not at showdown.
        """
        if self.phase != "showdown":
            return None
        if self.last_results is None:
            self.last_results = self.determine_winner()
        return self.last_results

    # ── Reset ──────────────────────────────────────────────────────────────

    def reset_for_next_round(self):
        for p in self.players:
            p["bet"] = 0
            p["total_bet"] = 0
            p["folded"] = False
            p["all_in"] = False
            p["hole_cards"] = []
            p["has_acted"] = False
        self.community_cards = []
        self.deck = []
        self.pot = 0
        self.current_bet = 0
        self.turn_started_at = None
        self.last_results = None
        self.phase = "lobby"
        self.touch()

    def reset_session(self):
        for p in self.players:
            p["coins"] = STARTING_COINS
            p["bet"] = 0
            p["total_bet"] = 0
            p["folded"] = False
            p["all_in"] = False
            p["hole_cards"] = []
            p["has_acted"] = False
        self.community_cards = []
        self.deck = []
        self.pot = 0
        self.current_bet = 0
        self.turn_started_at = None
        self.last_results = None
        self.phase = "lobby"
        self.started = False
        self.touch()

    # ── State serialization ────────────────────────────────────────────────

    def public_state(self):
        cur = self.players[self.current_player_index] if self.players else None
        dealer = self.players[self.dealer_index] if self.players else None
        in_betting = self.phase not in ("lobby", "showdown")

        # Time remaining for current player (sent to clients for countdown UI)
        turn_seconds_left = None
        if in_betting and self.turn_started_at:
            elapsed = time.time() - self.turn_started_at
            turn_seconds_left = max(0, int(AFK_TIMEOUT - elapsed))

        sanitized = []
        for p in self.players:
            sanitized.append({
                "sid": p["sid"],
                "name": p["name"],
                "coins": p["coins"],
                "bet": p["bet"],
                "folded": p["folded"],
                "all_in": p["all_in"],
                "connected": p["connected"],
                "is_host": p["is_host"],
                "is_cpu": p.get("is_cpu", False),
                "has_cards": len(p["hole_cards"]) > 0,
            })

        return {
            "room_code": self.room_code,
            "phase": self.phase,
            "pot": self.pot,
            "current_bet": self.current_bet,
            "dealer_sid": dealer["sid"] if dealer else None,
            "current_player_sid": cur["sid"] if cur and in_betting else None,
            "host_sid": self.host_sid,
            "community_cards": self.community_cards,
            "players": sanitized,
            "min_raise": self.min_raise,
            "max_players": self.max_players,
            "turn_seconds_left": turn_seconds_left,
        }

    def private_cards(self, sid):
        p = self.get_player(sid)
        return p["hole_cards"] if p else []

    def to_json(self):
        return {
            "room_code": self.room_code,
            "phase": self.phase,
            "players": self.players,
            "community_cards": self.community_cards,
            "deck": self.deck,
            "pot": self.pot,
            "current_bet": self.current_bet,
            "dealer_index": self.dealer_index,
            "current_player_index": self.current_player_index,
            "host_sid": self.host_sid,
            "last_activity": self.last_activity,
            "started": self.started,
            "min_raise": self.min_raise,
            "last_aggressor_index": self.last_aggressor_index,
            "max_players": self.max_players,
            "turn_started_at": self.turn_started_at,
            "last_results": self.last_results,
        }

    @classmethod
    def from_json(cls, data):
        game = cls.__new__(cls)
        game.room_code = data["room_code"]
        game.phase = data["phase"]
        game.players = data["players"]
        game.community_cards = data["community_cards"]
        game.deck = data["deck"]
        game.pot = data["pot"]
        game.current_bet = data["current_bet"]
        game.dealer_index = data["dealer_index"]
        game.current_player_index = data["current_player_index"]
        game.host_sid = data["host_sid"]
        game.last_activity = data["last_activity"]
        game.started = data["started"]
        game.min_raise = data.get("min_raise", BIG_BLIND)
        game.last_aggressor_index = data.get("last_aggressor_index", -1)
        game.max_players = data.get("max_players", 6)
        game.turn_started_at = data.get("turn_started_at")
        game.last_results = data.get("last_results")
        return game
