#!/usr/bin/env python3
"""
Case-economy simulator for Driven (rules 2026-11-13.24 + the post-Session-3 trial changes).

Plays whole cases Night by Night: Patrol actions, lead rolls and their costs,
clues (personal clues count 2 and tick Home), the Scheme clock and its beats
at 2/4/6, Dawn picks, Crack the Case (2d10 + clues vs 10 + Complexity, with
Regroup / Go in anyway), and interrogation of captured named enemies.

Fights are not played here: they are sampled from tables built with
alley_sim.py (the Session 3 alley party at 1 to 4 heroes, against Sparks and
two Saints, or a gang of one Saints group per hero). See ASSUMPTIONS in
the report this was written for.

Usage: python case_sim.py --cases 10000 --seed 1   (prints JSON)
"""
import argparse, json, math, random, statistics
from collections import Counter
import alley_sim as A
from street_level_sim import Dice

LEAD_BONUS = 3          # each hero rolls a stat that fits: +3
LEAD_RATINGS = (-1, 1, 3)
P_LT = 0.15             # a followed lead puts the lieutenant in front of the heroes (fight), while at large
P_ACC = 0.15            # a followed lead turns up the accomplice (taken without a fight), while at large
P_AMBUSH_LT = 0.5       # an ambush cost is the lieutenant (if at large), otherwise a gang
COSTS = ("scheme", "heat", "stress", "ambush")
PREF = ("stress", "heat", "ambush", "scheme")
POISE_NAMED = 13        # Sparks: Presence +1; the accomplice the same
MAX_NIGHTS = 12
COMPLEXITY = {1: 6, 2: 6, 3: 8, 4: 10}
PRESENCE = {1: 0, 2: 2, 3: 2, 4: 2}    # best Presence in the party (Cyrus 0, Bulwark +2, Patchwork +1, Rook +1)
BOXES = [4, 5, 4, 5]                   # Cyrus, Bulwark (Resilience), Patchwork, Rook (Hard to Kill)


def roll(r, bonus, defense, edge=False):
    t = r.randint(1, 10) + r.randint(1, 10) + bonus + (2 if edge else 0)
    m = t - defense
    return 0 if m < 0 else 1 if m < 4 else 2 if m < 8 else 3


# ---------------------------------------------------------------- fight tables
def fight_tables(runs, seed, ds="old"):
    T = {}
    for n in (1, 2, 3, 4):
        for mode in ("alley", "gang"):
            R = A.ARules(ds=ds, party_n=n, mode=mode, start="fresh")
            T[(mode, n)] = A.run_batch(R, runs, seed + n, A.AlleyFight, lambda R, n=n: A.make_party(R, n))
    return T


def table_stats(T):
    out = {}
    for (mode, n), res in sorted(T.items()):
        out[f"{mode}/{n}"] = {
            "win%": round(100 * sum(r["win"] for r in res) / len(res), 1),
            "capture%": round(100 * sum(r["win"] and r["sparks_out"] for r in res) / len(res), 1) if mode == "alley" else None,
            "rounds": round(statistics.mean(r["rounds"] for r in res), 2),
            "stress_gain/hero": round(statistics.mean(statistics.mean(r["stress_gain"]) for r in res), 2),
            "dying%": round(100 * sum(r["dying"] for r in res) / len(res), 2),
        }
    return out


# ---------------------------------------------------------------- the case
class Case:
    def __init__(self, cfg, T, r):
        self.c, self.T, self.r = cfg, T, r
        n = cfg["n"]
        self.n = n; self.C = COMPLEXITY[n] + cfg.get("cx_add", 0)
        self.size = cfg.get("clock_size", 6); self.beat_at = set(cfg.get("beats", (2, 4, 6)))
        self.stress = [0] * n; self.home = [0] * n; self.drive = [2] * n
        self.filled = [set() for _ in range(n)]     # filled Harm boxes, 1 = Bruised, 2 = Hurt, ...
        self.carry_edges = 0
        self.boxes = BOXES[:n]; self.down = [False] * n; self.mark = [False] * n; self.mark_box = [1] * n
        self.heat = 0; self.scheme = 0; self.beats = 0; self.filled_first = False
        self.clues = 0; self.pool = self.C + 4; self.pers = 1 if self.C <= 6 else 2
        self.lt_free = True; self.acc_free = True; self.stop_used = False; self.stop_next = False
        self.cracked = False; self.crack_night = None; self.need_new = False; self.night = 0
        self.via_trap = False
        st = self.stats = Counter()

    # -- bookkeeping
    def add_stress(self, i, k, outside=True):
        if k <= 0 or (outside and self.down[i]): return
        self.stress[i] = min(8, self.stress[i] + k)
        if self.stress[i] >= 8:
            self.stats["breaks"] += 1
            self.stress[i] = 4; self.drive[i] = min(6, self.drive[i] + 2); self.home[i] += 1

    def tick(self, k=1, who=None):
        for _ in range(k):
            if self.scheme >= self.size: return
            self.scheme += 1
            if self.scheme in self.beat_at and not self.cracked: self.beats += 1
            if self.scheme == self.size and not self.cracked: self.filled_first = True
            if who is None:
                for i in range(self.n): self.add_stress(i, 1)
            else: self.add_stress(who, 1)

    def gain_clue(self, src):
        if self.pers and self.r.random() < self.pers / max(self.pers, self.pool):
            self.pers -= 1; self.clues += 2; self.home[self.r.randrange(self.n)] += 1
            self.stats["personal"] += 1
        else:
            self.clues += 1
        self.pool = max(0, self.pool - 1)
        self.night_clues += 1
        self.stats["clue_" + src] += 1
        self.need_new = False

    # -- Harm boxes
    def top(self, i): return max(self.filled[i], default=0)
    def fill(self, i, k):
        b = self.boxes[i]
        for _ in range(k):
            free = [x for x in range(1, b + 1) if x not in self.filled[i]]
            if len(free) <= 1: break                    # sampled fights: a hero still up keeps the last box
            self.filled[i].add(free[0])

    # -- costs
    def pay(self, i, cost):
        self.stats["cost_" + cost] += 1
        if cost == "stress": self.add_stress(i, 1)
        elif cost == "heat": self.heat += 1
        elif cost == "scheme": self.tick(1, who=i)
        elif cost == "ambush":
            lt = self.lt_free and self.r.random() < P_AMBUSH_LT
            self.fight("alley" if lt else "gang")

    def allowed(self, i): return [c for c in COSTS if not (c == "stress" and self.stress[i] >= 8)]

    def cost_after(self, i, imp):
        if imp == 0: self.pay(i, self.r.choice(self.allowed(i)))
        elif imp == 1:
            offer = self.r.sample(self.allowed(i), 2)
            self.pay(i, next(c for c in PREF if c in offer))

    # -- fights
    def fight(self, mode):
        self.stats["fights_" + mode] += 1
        rec = self.r.choice(self.T[(mode, self.n)])
        self.heat += 1 if self.n >= 3 else 0          # Patchwork fires a gun
        for i in range(self.n):
            if self.down[i]: continue
            self.add_stress(i, rec["stress_gain"][i])
            b = self.boxes[i]
            if rec["dying_each"][i]:
                self.down[i] = True; self.mark[i] = True; self.stats["dying"] += 1
                self.filled[i] = set(range(1, b + 1))
            elif rec["down_each"][i] or rec["downs_each"][i]:
                self.filled[i] = set(range(1, b))          # back up at Wounded
            else:
                self.fill(i, rec["harm"][i])
            self.drive[i] = rec["end_drive"][i]
            if not self.down[i] and not (self.mark[i] and self.mark_box[i] == 1):
                self.filled[i].discard(1)                  # ruling: the breather clears only the Bruised box
        if not rec["win"]:
            self.stats["defeats"] += 1
            self.tick(2)                       # Defeat: Scheme ticks twice (all Down: no Stress, rule 6)
            for i in range(self.n):
                if self.heat < 3: self.heat += 1
                else: self.home[i] += 1
                self.filled[i] = set(range(1, self.boxes[i]))
            self.patrol_over = True; self.defeated = True
            return False
        if mode == "alley" and rec["sparks_out"] and self.lt_free:
            self.lt_free = False; self.stats["lt_captured"] += 1
            self.interrogate(lieutenant=True)
        return True

    # -- interrogation (rule 10)
    def interrogate(self, lieutenant):
        if not self.c["interrog"]: return
        i = 1 if self.n >= 2 else 0                                     # Bulwark (Presence +2), or Cyrus alone
        bonus = PRESENCE[self.n]
        edge = self.drive[i] >= 3
        if edge: self.drive[i] -= 1
        imp = roll(self.r, bonus, POISE_NAMED, edge)
        can_stop = lieutenant and not self.stop_used
        if imp == 1 and can_stop and self.drive[i] >= 2:
            self.drive[i] -= 2; imp = 2; self.stats["interrog_upgrades"] += 1
        self.stats["interrog_" + ("lt" if lieutenant else "acc")] += 1
        self.gain_clue("interrog")
        self.cost_after(i, imp)
        if imp >= 2 and can_stop:
            self.stop_used = True; self.stop_next = True; self.stats["tick_stopped"] += 1
        if imp == 3: self.gain_clue("impact3")

    # -- leads
    def follow_lead(self, i):
        self.stats["leads"] += 1
        edge = False
        if self.edges > 0:
            self.edges -= 1; edge = True; self.stats["edge_used"] += 1
        imp = roll(self.r, LEAD_BONUS, 12 + self.r.choice(LEAD_RATINGS), edge)
        self.gain_clue("lead")
        if imp == 3: self.gain_clue("impact3")       # ruling: a real second clue under every budget
        self.cost_after(i, imp)
        if self.patrol_over: return
        if self.lt_free and self.r.random() < P_LT: self.fight("alley")
        if self.patrol_over: return
        if self.acc_free and self.r.random() < P_ACC:
            self.acc_free = False; self.stats["acc_captured"] += 1
            self.interrogate(lieutenant=False)

    # -- crack
    def try_crack(self, end_of_patrol=False):
        if self.cracked or self.need_new or self.clues < math.ceil(self.C / 2): return
        thr = self.C + self.c["margin"]
        if not (self.clues >= thr or (end_of_patrol and self.scheme >= self.size - 1)): return
        self.stats["crack_rolls"] += 1
        if roll(self.r, self.clues, 10 + self.C) > 0:
            self.cracked = True; self.crack_night = self.night; return
        self.stats["crack_misses"] += 1
        if self.scheme + 2 < self.size:
            self.stats["regroup"] += 1; self.tick(2); self.need_new = True
        else:
            self.stats["go_in"] += 1; self.tick(1)
            if self.fight("alley" if self.lt_free else "gang"):
                self.gain_clue("trap"); self.cracked = True; self.crack_night = self.night; self.via_trap = True
            else:
                self.need_new = True

    # -- one Night
    def play_night(self):
        c = self.c; self.night += 1; self.night_clues = 0; self.patrol_over = False; self.defeated = False
        for i in range(self.n):
            self.drive[i] = max(2, min(3, self.drive[i]))
            self.down[i] = False
        a = c["budget"]
        team = not a.startswith("A")
        actions = (2 * self.n if not team else self.n + (1 if a == "C" else 0)) + c.get("extra_actions", 0)
        self.edges = self.carry_edges + c.get("bike_edge", 0); self.carry_edges = 0
        self.team_free = False; self.hero_free = [False] * self.n
        # no-roll gear sources (Plugs, hacking rig, Network...): ceil(n/2) heroes, plus burner extras
        sources = [i for i in range(math.ceil(self.n / 2))] + [0] * c.get("extra_sources", 0)
        for k, i in enumerate(sources):
            self.stats["sources"] += 1
            if not team:
                if not self.hero_free[i]: self.hero_free[i] = True; self.gain_clue("noroll")
                else: self.stats["source_wasted"] += 1
            else:
                if not self.team_free: self.team_free = True; self.gain_clue("noroll")
                else: self.edges += 1; self.stats["source_to_edge"] += 1
        if not team:
            for _ in range(c.get("scene", 0)): self.gain_clue("scene")
        self.try_crack()
        for k in range(actions):
            if self.cracked or self.patrol_over: break
            self.follow_lead(k % self.n)
            self.try_crack()
        if not self.cracked and not self.defeated: self.try_crack(end_of_patrol=True)
        if team: self.stats["edge_wasted"] += self.edges
        self.stats["night_clues_total"] += self.night_clues
        if self.night == 1: self.stats["night1_clues"] += self.night_clues
        if self.cracked: return
        self.dawn()

    def dawn(self):
        c = self.c; team = not c["budget"].startswith("A")
        if self.stop_next: self.stop_next = False; self.stats["dawn_tick_skipped"] += 1
        else: self.tick(1)
        wc_taken_team = self.team_free
        for i in range(self.n):
            picks = []
            if self.down[i]: picks = ["patch", "sleep"]
            else:
                if self.top(i) >= 2: picks.append("patch")
                if self.stress[i] >= 4: picks.append("sleep")
                while len(picks) < 2:
                    wc_ok = c.get("work_case", True) and "work" not in picks and \
                            ((not team and not self.hero_free[i]) or (team and not wc_taken_team))
                    wc_edge = team and c.get("work_case", True) and "work" not in picks and "workedge" not in picks \
                              and "show" in picks and self.carry_edges < self.n
                    if wc_ok: picks.append("work"); wc_taken_team = True; self.hero_free[i] = True
                    elif "show" not in picks: picks.append("show")
                    elif wc_edge: picks.append("workedge"); self.carry_edges += 1
                    elif "sleep" not in picks: picks.append("sleep")
                    else: picks.append("laylow")
            for p in picks:
                self.stats["pick_" + p] += 1
                if p == "sleep": self.stress[i] = max(0, self.stress[i] - 3)
                elif p == "patch": self.filled[i] = {self.mark_box[i]} if self.mark[i] else set()
                elif p == "show": self.stress[i] = max(0, self.stress[i] - 1)
                elif p == "laylow": self.heat = max(0, self.heat - 1)
                elif p == "work": self.gain_clue("work")
            if "show" not in picks: self.home[i] += 1
            if self.down[i] and not ("patch" in picks and "sleep" in picks): pass
            self.mark[i] = False
        self.stats["night_clues_total"] += 0

    def play(self):
        while not self.cracked and self.night < MAX_NIGHTS:
            self.play_night()
        return self


# ---------------------------------------------------------------- batch
def run_cell(cfg, T, cases, seed):
    r = random.Random(seed)
    res = [Case(cfg, T, r).play() for _ in range(cases)]
    n = len(res)
    S = Counter()
    for x in res: S.update(x.stats)
    nights = [x.crack_night or MAX_NIGHTS for x in res]
    nd = Counter(min(k, 7) for k in nights)
    tot_nights = sum(nights)
    lt_att = S["interrog_lt"]
    out = {
        "clues/night": round(S["night_clues_total"] / tot_nights, 2),
        "night1_clues": round(S["night1_clues"] / n, 2),
        "crack_night": round(statistics.mean(nights), 2),
        "crack_dist%": {(str(k) if k < 7 else "7+"): round(100 * nd[k] / n, 1) for k in sorted(nd)},
        "fills_first%": round(100 * sum(x.filled_first for x in res) / n, 1),
        "beats/case": round(statistics.mean(x.beats for x in res), 2),
        "scheme_at_crack": round(statistics.mean(x.scheme for x in res), 2),
        "stress_at_crack": round(statistics.mean(statistics.mean(x.stress) for x in res), 2),
        "workedge_picks/case": round(S["pick_workedge"] / n, 2),
        "edge_used/case": round(S["edge_used"] / n, 2),
        "home_at_crack": round(statistics.mean(statistics.mean(x.home) for x in res), 2),
        "breaks/case": round(S["breaks"] / n, 2),
        "crack_rolls/case": round(S["crack_rolls"] / n, 2),
        "crack_miss%": round(100 * S["crack_misses"] / max(1, S["crack_rolls"]), 1),
        "via_trap%": round(100 * sum(x.via_trap for x in res) / n, 1),
        "lt_interrog/case": round(lt_att / n, 2),
        "stop%_per_attempt": round(100 * S["tick_stopped"] / max(1, lt_att), 1) if lt_att else None,
        "stop%_per_case": round(100 * S["tick_stopped"] / n, 1),
        "fights/case": round((S["fights_alley"] + S["fights_gang"]) / n, 2),
        "defeats/case": round(S["defeats"] / n, 3),
        "dying/case": round(S["dying"] / n, 3),
        "sources/case": round(S["sources"] / n, 2),
        "source_wasted%": round(100 * S["source_wasted"] / max(1, S["sources"]), 1),
        "source_to_edge%": round(100 * S["source_to_edge"] / max(1, S["sources"]), 1),
        "edge_unused%": round(100 * S["edge_wasted"] / max(1, S["source_to_edge"]), 1) if S["source_to_edge"] else None,
        "work_case_picks/case": round(S["pick_work"] / n, 2),
        "lead_costs/case": {k: round(S["cost_" + k] / n, 2) for k in COSTS},
        "heat_at_crack": round(statistics.mean(x.heat for x in res), 2),
    }
    return out


BUDGETS = [("A", 0), ("A", 2), ("A", 4), ("B", 0), ("C", 0)]


def job2(cases, seed, T):
    rows = []
    for b, scene in BUDGETS:
        for n in (1, 2, 3, 4):
            for interrog in (True, False):
                for margin in (0, 2):
                    cfg = dict(budget=b, scene=scene, n=n, interrog=interrog, margin=margin)
                    o = run_cell(cfg, T, cases, seed); o.update(cfg); rows.append(o)
    side = []
    base = dict(n=3, interrog=True, margin=0)
    for label, cfg in [
        ("A0, 3 heroes", dict(budget="A", scene=0)),
        ("A0 + bike (1 more action)", dict(budget="A", scene=0, extra_actions=1)),
        ("B, 3 heroes", dict(budget="B")),
        ("B + bike (pool 3 -> 4)", dict(budget="B", extra_actions=1)),
        ("A0 + burner phones (1 more no-roll use)", dict(budget="A", scene=0, extra_sources=1)),
        ("B + burner phones (1 more no-roll use)", dict(budget="B", extra_sources=1)),
        ("A0, nobody picks Work the Case", dict(budget="A", scene=0, work_case=False)),
        ("B, nobody picks Work the Case", dict(budget="B", work_case=False)),
        ("C, nobody picks Work the Case", dict(budget="C", work_case=False)),
    ]:
        c2 = dict(base); c2.update(cfg)
        o = run_cell(c2, T, cases, seed); o["label"] = label; side.append(o)
    return rows, side


CLOCKS = [("a: 6, beats 2/4/6", dict(clock_size=6, beats=(2, 4, 6))),
          ("b: 6, beats 1/3/5", dict(clock_size=6, beats=(1, 3, 5))),
          ("c: 4, beats 1/2/3", dict(clock_size=4, beats=(1, 2, 3)))]


def job3(cases, seed, T):
    """Follow-up: budget B only, three Scheme clocks, standard and +2 Complexity."""
    rows, side = [], []
    for clock, ck in CLOCKS:
        for cx_add in (0, 2):
            for n in (1, 2, 3, 4):
                for margin in (0, 2):
                    cfg = dict(budget="B", n=n, interrog=True, margin=margin, cx_add=cx_add, **ck)
                    o = run_cell(cfg, T, cases, seed); o.update(cfg, clock=clock); rows.append(o)
        for margin in (0, 2):
            for label, extra in [("1 hero, pool 2", dict(n=1, extra_actions=1)),
                                 ("3 heroes, bike = Edge on one lead per Night", dict(n=3, bike_edge=1)),
                                 ("3 heroes, plain (for comparison)", dict(n=3))]:
                cfg = dict(budget="B", interrog=True, margin=margin, cx_add=0, **ck); cfg.update(extra)
                o = run_cell(cfg, T, cases, seed); o.update(cfg, clock=clock, label=label); side.append(o)
    return rows, side


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=int, default=10000)
    ap.add_argument("--fights", type=int, default=4000)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--ds", default="old")
    ap.add_argument("--job", default="2")
    a = ap.parse_args()
    T = fight_tables(a.fights, a.seed, a.ds)
    if a.job == "3":
        rows, side = job3(a.cases, a.seed, T)
        print(json.dumps({"fight_tables": table_stats(T), "cells": rows, "side": side}, indent=1)); return
    rows, side = job2(a.cases, a.seed, T)
    print(json.dumps({"fight_tables": table_stats(T), "cells": rows, "side": side}, indent=1))


if __name__ == "__main__":
    main()
