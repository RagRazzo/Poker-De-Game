from itertools import combinations
from .deck import RANK_VALUE

HIGH_CARD = 0
PAIR = 1
TWO_PAIR = 2
THREE_KIND = 3
STRAIGHT = 4
FLUSH = 5
FULL_HOUSE = 6
FOUR_KIND = 7
STRAIGHT_FLUSH = 8

CATEGORY_NAMES = {
    HIGH_CARD: "High Card",
    PAIR: "Pair",
    TWO_PAIR: "Two Pair",
    THREE_KIND: "Three of a Kind",
    STRAIGHT: "Straight",
    FLUSH: "Flush",
    FULL_HOUSE: "Full House",
    FOUR_KIND: "Four of a Kind",
    STRAIGHT_FLUSH: "Straight Flush",
}


def _rank_counts(cards5):
    counts = {}
    for c in cards5:
        v = RANK_VALUE[c["rank"]]
        counts[v] = counts.get(v, 0) + 1
    return counts


def _is_flush(cards5):
    return len({c["suit"] for c in cards5}) == 1


def _straight_high(values):
    vals = sorted(set(values), reverse=True)
    for i in range(len(vals) - 4):
        window = vals[i:i + 5]
        if len(window) == 5 and window[0] - window[4] == 4:
            return window[0]
    # Wheel: A-2-3-4-5
    if {14, 2, 3, 4, 5}.issubset(set(values)):
        return 5
    return None


def _score_five(cards5):
    counts = _rank_counts(cards5)
    values = [RANK_VALUE[c["rank"]] for c in cards5]

    is_flush = _is_flush(cards5)
    straight_high = _straight_high(values)

    freqs = sorted(counts.values(), reverse=True)
    by_count = sorted(counts.items(), key=lambda x: (x[1], x[0]), reverse=True)
    sorted_vals = [v for v, _ in by_count]

    if is_flush and straight_high:
        return (STRAIGHT_FLUSH, straight_high, 0, 0, 0, 0)

    if freqs[0] == 4:
        quad, kick = sorted_vals[0], sorted_vals[1]
        return (FOUR_KIND, quad, kick, 0, 0, 0)

    if freqs[0] == 3 and len(freqs) > 1 and freqs[1] == 2:
        trip, pair = sorted_vals[0], sorted_vals[1]
        return (FULL_HOUSE, trip, pair, 0, 0, 0)

    if is_flush:
        sv = sorted(values, reverse=True)
        return (FLUSH, sv[0], sv[1], sv[2], sv[3], sv[4])

    if straight_high:
        return (STRAIGHT, straight_high, 0, 0, 0, 0)

    if freqs[0] == 3:
        trip = sorted_vals[0]
        kicks = sorted([v for v, c in counts.items() if c != 3], reverse=True)
        k1, k2 = (kicks + [0, 0])[:2]
        return (THREE_KIND, trip, k1, k2, 0, 0)

    if freqs[0] == 2 and len(freqs) > 1 and freqs[1] == 2:
        pairs = sorted([v for v, c in counts.items() if c == 2], reverse=True)
        kick = max((v for v, c in counts.items() if c == 1), default=0)
        return (TWO_PAIR, pairs[0], pairs[1], kick, 0, 0)

    if freqs[0] == 2:
        pair = sorted_vals[0]
        kicks = sorted([v for v, c in counts.items() if c == 1], reverse=True)
        k1, k2, k3 = (kicks + [0, 0, 0])[:3]
        return (PAIR, pair, k1, k2, k3, 0)

    sv = sorted(values, reverse=True)
    return (HIGH_CARD, sv[0], sv[1], sv[2], sv[3], sv[4])


def best_of_seven(cards):
    if len(cards) <= 5:
        return _score_five(cards)
    return max(_score_five(list(combo)) for combo in combinations(cards, 5))


def label_for(score):
    cat = score[0]
    name = CATEGORY_NAMES.get(cat, "Unknown")
    if cat == STRAIGHT_FLUSH and score[1] == 14:
        return "Royal Flush"
    return name


def evaluate_hand(hole_cards, community_cards):
    all_cards = hole_cards + community_cards
    score = best_of_seven(all_cards)
    return {
        "score": score,
        "category": score[0],
        "label": label_for(score),
    }


def compare(score_a, score_b):
    if score_a > score_b:
        return 1
    if score_a < score_b:
        return -1
    return 0
