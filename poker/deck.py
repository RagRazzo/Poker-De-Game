import random

RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]
SUITS = ["S", "H", "D", "C"]
RANK_VALUE = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
    "9": 9, "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
}


class Deck:
    def __init__(self):
        self.cards = [
            {"rank": r, "suit": s, "code": r + s}
            for s in SUITS for r in RANKS
        ]

    def shuffle(self):
        random.shuffle(self.cards)

    def deal(self, n=1):
        result = []
        for _ in range(n):
            if self.cards:
                result.append(self.cards.pop())
        return result
