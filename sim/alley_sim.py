#!/usr/bin/env python3
"""
Session 3 reruns (rules 2026-11-13.24 plus the post-Session-3 trial changes).

Built on street_level_sim.py: it subclasses Fight and keeps its tactics, and adds
only what the alley and the Cannery side test need:

- zones (Mouth M, Dumpster Row D, Fire Escape F, Loading Door L; all adjacent),
  Near/Far range for guns, High Ground Edge, Dark, Hazard zones;
- the Hazard rule: any missed roll in a Hazard zone costs the roller 1 Harm;
- Sparks (lieutenant, pistol + 2 flares), a 2-Saint group, the ambush;
- Danger Sense old (+1 Guard), new (once per fight, Disadvantage on the first
  Harm attack from a named enemy), or both;
- Vengeance Steady/Fraying, Thrill Fraying, Martial Artist hands as light melee;
- rule 5: the free Presence attack neither uses up nor suffers "Disadvantage on
  their next roll".

Usage:
  python alley_sim.py --runs 10000 --seed 1        # full Job 1 grid + Cannery side test, JSON to stdout
  python alley_sim.py --log 1 --ds new             # one alley fight, roll by roll
"""
import argparse, json, random, statistics, sys
from collections import Counter
from dataclasses import dataclass
import street_level_sim as S
from street_level_sim import Fight, Hero, Mooks, Boss, Rules, Dice, net_adv, harm_to_hero, add_stress, DEF_BASE

ALL_ZONES = ("M", "D", "F", "L")


@dataclass
class ARules(Rules):
    ds: str = "old"              # old | new | both | none
    base_boxes: int = 4
    start: str = "fresh"         # fresh | session
    patch: str = "sniper"        # sniper: Patchwork shoots from the Dark Loading Door | tase: grapples up and tases Sparks
    saints: int = 2              # Saints in the alley group
    mode: str = "alley"          # alley | gang (case-sim gang fight: one group of 3 per hero, no Sparks, no Hazard)
    flares: int = 2
    sparks_role: str = "trickster"
    ambush: bool = True
    hazard_mode: str = "flat"    # flat: 1 Harm to anyone | tough: Toughness vs blunt negates (physical hazards only)
    hazard_fire: bool = True     # the alley Hazard is fire (Toughness never applies)
    party_n: int = 3
    kit_items: str = ""          # Patchwork's belt holds no flashbang or smoke; the taser gun is handled here
    bw_extra: bool = True        # Bulwark's Resilience box on top of the base boxes
    ambush_opener: str = "saints"  # who takes the one ambush roll with Edge: saints | sparks


class HazardDice:
    """Wraps Dice so a Miss by whoever is acting in a Hazard zone costs them 1 Harm."""
    def __init__(self, inner, fight):
        self.inner, self.f = inner, fight
        self.r = inner.r
    def d10(self): return self.inner.d10()
    def roll(self, bonus, defense, adv=0, edge=False):
        res = self.inner.roll(bonus, defense, adv, edge)
        a = self.f.actor
        if res[0] == 0 and a is not None and self.f.zone_of(a) in self.f.hazards:
            self.f.hazard_hit(a)
        return res


def make_party(R, n=None):
    n = n or R.party_n
    gb = 1 if R.ds in ("old", "both") else 0
    cy = Hero("cyrus", "Cyrus", "Brawler", "Vengeance", 3, 1, 2, 0, boxes=R.base_boxes,
              weapon="light", armor_guns=1, flairs=("opportunist",), guard_bonus=gb)
    cy.ds_new = R.ds in ("new", "both")
    bw = Hero("bulwark", "Bulwark", "Protector", "Mercy", 3, 0, 1, 2, boxes=R.base_boxes + (1 if R.bw_extra else 0),
              medkit=1, power="Toughness", tough_blunt=1, guard_bonus=1, weapon="heavy")
    pw = Hero("patchwork", "Patchwork", "Specialist", "Thrill", 0, 2, 3, 1, boxes=R.base_boxes,
              weapon="pistol", flairs=("nvg", "grapple", "earpiece"))
    rk = Hero("rook", "Rook", "Brawler", "Spite", 4, 2, -1, 1, boxes=R.base_boxes + 1,
              weapon="light", armor_guns=1, medkit=1, flairs=("hard_to_kill",))
    party = [cy, bw, pw, rk][:n]
    if R.start == "session":
        for h, (s, d) in zip(party, [(1, 1), (0, 2), (3, 2), (0, 2)]):
            h.stress, h.drive = s, d
    for h in party:
        h.ds_new = getattr(h, "ds_new", False)
        h.start_stress = h.stress
    return party


class ZoneFight(Fight):
    """Fight with zones, a Hazard, and the post-Session-3 rule changes."""
    def __init__(self, party, rules, dice, log=False):
        super().__init__(party, "custom", rules, dice, log)
        self.d = HazardDice(dice, self)
        self.actor = None
        self.hazards = set()
        self.zone = {}
        self.ehits = self.erolls = 0           # enemy Harm attacks
        self.phits = self.prolls = 0           # enemy Presence attacks
        self.enemy_hazard = 0
        for h in party:
            h.stats["hazard_harm"] = 0
            h.hurt_by = set()
            h.ds_used = False
            h.thrill_round = -1
            h.end_harm = 0

    # -- zones
    def zone_of(self, x): return self.zone.get(id(x))
    def set_zone(self, x, z): self.zone[id(x)] = z

    def hazard_hit(self, who):
        R = self.rules
        if isinstance(who, Hero):
            if who.down: return
            if R.hazard_mode == "tough" and not self.fire_hazard(who) and who.toughness(False, False) >= 1:
                self.log(f"   {who.name} misses in the Hazard: Toughness turns it"); return
            self.log(f"   {who.name} misses in the Hazard: 1 Harm")
            self.hurt(who, 1, physical=False)
            who.stats["hazard_harm"] += 1
            if not who.down: self.arch_drive_if(who, "hurt")
        elif isinstance(who, Mooks):
            if who.out: return
            who.count -= 1; self.enemy_hazard += 1
            self.log(f"   {who.name} miss in the Hazard: one drops ({who.count} left)")
            if who.gunner and self.d.r.random() < 1 / (who.count + 1): who.gunner = False
            self.morale()
        elif isinstance(who, Boss):
            if who.out: return
            if R.hazard_mode == "tough" and not self.fire_hazard(who) and who.toughness_v >= 1:
                self.log(f"   {who.name} misses in the Hazard: Toughness turns it"); return
            who.harm += 1; self.enemy_hazard += 1
            self.log(f"   {who.name} misses in the Hazard: 1 Harm ({who.harm}/{who.harm_max})")
            if who.out: self.morale()

    def fire_hazard(self, who): return False

    # -- the post-Session-3 roll wrapper: Vengeance Edge, Thrill Advantage, ranges
    def ranged_mods(self, h, t):
        """(adv, edge) for a hero's ranged attack on t."""
        adv, edge = 0, False
        hz, tz = self.zone_of(h), self.zone_of(t)
        nvg = "nvg" in h.flairs
        if hz != tz and h.arch != "Specialist": adv = net_adv(adv, -1)          # Far
        if "L" in (hz, tz) and not nvg: adv = net_adv(adv, -1)                 # Dark
        if hz == "F" and tz != "F": edge = True                               # High Ground
        return adv, edge

    def hroll(self, h, stat, defense, adv=0, edge=False, target=None):
        if target is not None and id(target) in h.hurt_by and h.trait == "Vengeance":
            edge = True                                                       # Vengeance Steady
        if h.trait == "Thrill" and h.stress >= 4 and stat == "flow" and h.thrill_round != self.round:
            h.thrill_round = self.round; adv = net_adv(adv, 1) if adv >= 0 else 0
        if target is not None and h.weapon == "pistol" and stat == "flow":
            a2, e2 = self.ranged_mods(h, target)
            adv = net_adv(adv, a2) if a2 else adv; edge = edge or e2
        imp = super().hroll(h, stat, defense, adv, edge, target)
        if imp == 0 and isinstance(target, Boss) and self.rules.sparks_role == "trickster" \
                and getattr(target, "trick_round", -1) != self.round:
            target.trick_round = self.round; target.drive = min(6, target.drive + 1)
        return imp

    def jab(self, h, t, stat=None):
        if t is None or getattr(t, "out", True): return
        if h.weapon != "pistol" and self.zone_of(t) != self.zone_of(h): return   # melee Jab needs the same zone
        stat = stat or ("flow" if (h.weapon == "pistol" or h.flow > h.force) else "force")
        pen = 0 if (h.weapon == "light" and self.rules.light_jab and stat != "presence") else 2
        defense = t.poise if stat == "presence" else t.guard
        edge = (isinstance(t, Boss) and t.breaking) or (id(t) in h.hurt_by and h.trait == "Vengeance")
        imp, m, dice, tot = self.d.roll(getattr(h, stat) - pen, defense, net_adv(h.phys_adv(stat)), edge)
        h.stats["rolls"] += 1
        if imp == 0:
            h.stats["misses"] += 1
            if isinstance(t, Boss) and getattr(t, "trick_round", -1) != self.round and self.rules.sparks_role == "trickster":
                t.trick_round = self.round; t.drive = min(6, t.drive + 1)
        self.log(f"   {h.name} Jab ({stat}) {dice} = {tot} vs {defense}: {'MISS' if imp==0 else 'hit'}")
        if imp: self.resolve(h, t, 1, stat, jab=True)

    def hit_boss(self, h, impact, weapon, b=None, jab=False):
        b = b or self.boss
        dealt = super().hit_boss(h, impact, weapon, b, jab)
        if dealt and h.trait == "Vengeance" and h.stress >= 4 and id(b) in h.hurt_by and not b.out:
            b.harm += 1; dealt += 1; self.log(f"   Vengeance (Fraying): +1 Harm ({b.harm}/{b.harm_max})")
            if b.out: self.arch_drive_if(h, "drop"); self.morale()
        return dealt

    def resolve(self, h, t, imp, stat, jab=False):
        if imp <= 0: return
        if isinstance(t, Mooks):
            dropped = self.hit_group(h, t, imp)
            h.engaged_with = t if h.weapon != "pistol" else None
            if h.arch == "Brawler" and dropped and not jab:
                z = self.zone_of(h)
                nxt = next((g for g in self.groups if not g.out and self.zone_of(g) == z), None) or \
                      next((b for b in self.live_bosses() if self.zone_of(b) == z), None)
                if nxt: self.log("   Pile Through"); self.jab(h, nxt)
        else:
            super().resolve(h, t, imp, stat, jab)

    def target_for(self, h):
        t = super().target_for(h)
        if t is not None and h.weapon != "pistol":
            self.set_zone(h, self.zone_of(t))        # free move (and climb) to engage
        return t

    def redirect(self, t):
        for p in self.up():
            if p.arch == "Protector" and p is not t and self.zone_of(p) == self.zone_of(t) \
                    and (p.stand_ground or (t.wounded and not p.wounded)):
                self.log(f"   {p.name} interposes")
                self.arch_drive(p, "Protector: interpose")
                return p
        return t

    def on_hurt(self, h, src):
        if src is not None: h.hurt_by.add(id(src))
        super().on_hurt(h, src)

    # -- turns, with the actor tracked for the Hazard
    def hero_turn(self, h):
        self.actor = h
        try: self._pre_move(h); super().hero_turn(h)
        finally: self.actor = None
    def _pre_move(self, h): pass

    def mook_turn(self, g):
        self.actor = g
        try: self._mook_turn(g)
        finally: self.actor = None

    def boss_turn(self, b=None):
        b = b or self.boss
        self.actor = b
        try: self._boss_turn(b)
        finally: self.actor = None

    def _mook_turn(self, g):
        targets = self.up()
        if not targets: return
        gz = self.zone_of(g)
        eng = [h for h in targets if h.engaged_with is g]
        here = [h for h in targets if self.zone_of(h) == gz]
        t = eng[0] if eng else (self.d.r.choice(here) if here else self.d.r.choice(targets))
        t = self.redirect(t)
        tz = self.zone_of(t)
        gun = g.gunner
        if tz != gz and not gun:
            self.set_zone(g, tz); gz = tz                 # close in (free move)
        far = tz != gz
        engaged = any(h.engaged_with is g for h in self.up())
        adv = net_adv(-1 if (gun and engaged) else 0,
                      -1 if (gun and far) else 0,
                      -1 if (gun and "L" in (gz, tz) and self.rules.mode == "alley") else 0,
                      -1 if g.dis_next else 0)
        g.dis_next = False
        edge = g.count >= 3 or (g.harm_each > 1 and g.count >= g.start)
        if getattr(g, "ambush_edge", False): edge = True; g.ambush_edge = False
        imp, m, dice, tot = self.d.roll(g.attack, t.guard, adv, edge)
        self.erolls += 1; self.ehits += imp > 0
        self.log(f" {g.name} ({g.count}{', gun' if gun else ''}) -> {t.name} {dice} = {tot} vs {t.guard}: "
                 f"{'MISS' if imp==0 else 'Impact '+str(imp)}")
        if imp:
            self.hurt(t, harm_to_hero(t, imp, self.rules, gun=gun, from_mook=True))
            self.on_hurt(t, g)
        else:
            self.on_missed(t)

    def presence_attack(self, b):
        targets = self.up()
        if not targets: return
        b.threat_round = self.round
        t = min(targets, key=lambda x: x.poise)
        imp, m, dice, tot = self.d.roll(b.presence, t.poise, 0, False)   # rule 5: no Disadvantage, none used up
        self.prolls += 1; self.phits += imp > 0
        self.log(f" {b.name} threatens {t.name} {dice} = {tot} vs {t.poise}: {'MISS' if imp==0 else str(imp)+' Stress'}")
        if imp: add_stress(t, imp)

    def _boss_turn(self, b):
        targets = self.up()
        if not targets: return
        self.boss_attack(b)
        if self.rules.villain_presence and getattr(b, "threat_round", 0) != self.round:
            self.presence_attack(b)

    def boss_attack(self, b):
        """Sparks: pistol or flare from the Fire Escape."""
        R = self.rules
        targets = self.up()
        if not targets: return
        bz = self.zone_of(b)
        first = getattr(b, "opener", False)
        b.opener = False
        if first:
            inM = [h for h in targets if self.zone_of(h) == "M"]
            t = self.d.r.choice(inM or targets)
        else:
            t = b.last_hurt_by if (b.last_hurt_by and not b.last_hurt_by.down) else self.d.r.choice(targets)
        t = self.redirect(t)
        tz = self.zone_of(t)
        flare = b.flares > 0 and (first or (tz not in self.hazards and tz != bz))
        adv = 0
        if tz != bz: adv = net_adv(adv, -1)                                       # Far
        if "L" in (bz, tz): adv = net_adv(adv, -1)                                # Dark
        if any(h.engaged_with is b and self.zone_of(h) == bz for h in self.up()): adv = net_adv(adv, -1)  # engaged
        if b.dis_next: adv = net_adv(adv, -1); b.dis_next = False
        if t.ds_new and not t.ds_used:                                            # Danger Sense (new)
            t.ds_used = True; adv = net_adv(adv, -1); self.log(f"   {t.name} calls Danger Sense: Disadvantage")
        edge = getattr(b, "ambush_edge", False) or (bz == "F" and tz != "F")
        b.ambush_edge = False
        if not edge and b.drive >= 3: b.drive -= 1; edge = True
        stat = b.flow
        imp, m, dice, tot = self.d.roll(stat, t.guard, adv, edge)
        self.erolls += 1; self.ehits += imp > 0
        wname = "flare" if flare else "pistol"
        self.log(f" {b.name} ({wname}) -> {t.name} {dice} = {tot} vs {t.guard}: {'MISS' if imp==0 else 'Impact '+str(imp)}")
        if flare:
            b.flares -= 1
            if tz != bz: self.hazards.add(tz); self.log(f"   the flare sets zone {tz} burning: it is a Hazard")
        if imp:
            if imp == 1 and b.drive >= 2: b.drive -= 2; imp = 2; self.log(f"   {b.name} spends 2 Drive to upgrade")
            harm = (imp + (1 if imp >= 2 else 0)) if flare else harm_to_hero(t, imp, R, gun=True)
            self.hurt(t, harm, physical=not flare)
            self.on_hurt(t, b)
        else:
            self.on_missed(t)

    # -- loop: the ambushing side leads the alternation
    def run(self):
        R = self.rules
        while not self.done() and self.round < R.max_rounds:
            self.round += 1
            self.log(f"--- Round {self.round}")
            heroes = list(self.heroes)
            foes = self.live_bosses() + [g for g in self.groups if not g.out]
            if self.round == 1 and R.ambush:
                foes.sort(key=lambda f: not getattr(f, "ambush_edge", False))
            seq = []
            a, b = (foes, heroes) if (R.ambush and self.round == 1) else (heroes, foes)
            for i in range(max(len(a), len(b))):
                if i < len(a): seq.append(a[i])
                if i < len(b): seq.append(b[i])
            for x in seq:
                if self.done(): break
                if isinstance(x, Hero): self.hero_turn(x)
                elif not x.out:
                    if isinstance(x, Mooks): self.mook_turn(x)
                    else: self.boss_turn(x)
            self.end_of_round()
        win = bool(self.up()) and (not self.foes() or self.obj_won)
        return self.result(win)

    def end_of_round(self): pass

    def result(self, win):
        H = self.heroes
        return {"win": win, "rounds": self.round,
                "downs": sum(h.stats["downs"] for h in H),
                "dying": any(h.dying for h in H),
                "broke": any(h.stats["breaks"] for h in H),
                "end_stress": [h.stress for h in H],
                "stress_gain": [h.stress - h.start_stress for h in H],
                "harm": [h.stats["harm_taken"] for h in H],
                "end_harm": [h.harm for h in H],
                "hazard": [h.stats["hazard_harm"] for h in H],
                "end_drive": [h.drive for h in H],
                "hero_rolls": sum(h.stats["rolls"] for h in H),
                "hero_misses": sum(h.stats["misses"] for h in H),
                "e_rolls": self.erolls, "e_hits": self.ehits,
                "p_rolls": self.prolls, "p_hits": self.phits,
                "enemy_hazard": self.enemy_hazard,
                "dying_each": [h.dying for h in H], "down_each": [h.down for h in H],
                "downs_each": [h.stats["downs"] for h in H], "broke_each": [h.stats["breaks"] > 0 for h in H],
                "sparks_out": any(b.out for b in self.bosses)}


class AlleyFight(ZoneFight):
    def __init__(self, party, rules, dice, log=False):
        super().__init__(party, rules, dice, log)
        R = rules
        for h in party: self.set_zone(h, "M")
        if R.mode == "alley":
            g = Mooks(name="Saints", count=R.saints, start=R.saints, guard=13, gunner=True)
            self.groups = [g]; self.set_zone(g, "M")    # they close in on the ambush
            sp = Boss(name="Sparks", force=1, flow=3, focus=1, presence=1, harm_max=5, toughness_v=0,
                      drive=2, weapon="pistol", role="lieutenant")
            sp.flares = R.flares
            self.bosses = [sp]; self.set_zone(sp, "F")
        else:   # gang: one group of 3 per hero, no lieutenant, no Hazard
            self.groups = [Mooks(name=f"Saints {chr(65+i)}", guard=13) for i in range(len(party))]
            for g in self.groups: self.set_zone(g, "M")
        if R.ambush:
            # ruling: one roll in total has the ambush Edge, the side's first
            opener = self.groups[0] if (R.ambush_opener == "saints" or not self.bosses) else self.bosses[0]
            opener.ambush_edge = True
            for b in self.bosses: b.opener = True      # Sparks still opens his own turn with the flare into the Mouth

    def fire_hazard(self, who): return self.rules.hazard_fire

    def _pre_move(self, h):
        if h.down or h.arch != "Specialist": return
        if self.rules.patch == "sniper" and self.zone_of(h) != "L":
            self.set_zone(h, "L"); self.log(f" {h.name} moves into the Dark Loading Door")

    def _hero_turn(self, h):
        R = self.rules
        sp = next((b for b in self.live_bosses() if b.name == "Sparks"), None)
        if h.arch == "Specialist" and R.patch == "tase" and sp and not h.down:
            shots = getattr(h, "taser_shots", 2); loaded = getattr(h, "taser_loaded", True)
            if shots > 0 and not sp.dis_next and h.drive < R.sig_cost:
                if self.zone_of(h) != self.zone_of(sp):
                    self.set_zone(h, self.zone_of(sp)); self.log(f" {h.name} grapples up to the Fire Escape")
                if True:   # ruling: a Full Action Strike with Flow, no -2
                    imp, m, dice, tot = self.d.roll(h.flow, sp.guard, net_adv(h.phys_adv("flow")), False)
                    h.stats["rolls"] += 1; h.taser_shots = shots - 1
                    self.log(f" {h.name} taser gun at Sparks {dice} = {tot} vs {sp.guard}: {'MISS' if imp==0 else 'hit'}")
                    if imp:
                        sp.dis_next = True; self.arch_drive(h, "Specialist: tool")
                    else:
                        h.stats["misses"] += 1
                return
        super()._hero_turn(h)


# ---------------------------------------------------------------- Cannery side test
class CanneryHazardFight(ZoneFight):
    """The Cannery as in street_level_sim (no range penalties) plus the Kill Floor Hazard (hooks)."""
    def __init__(self, party, rules, dice, log=False):
        super().__init__(party, rules, dice, log)
        self.groups = [Mooks(name=f"Saints {chr(65+i)}", guard=rules.mook_guard) for i in range(2)]
        self.boss = Boss()
        self.hazards = {"K"}
        self.set_zone(self.groups[0], "K"); self.set_zone(self.groups[1], "D"); self.set_zone(self.boss, "K")
        for h in party:
            self.set_zone(h, "C" if h.arch == "Stalker" else "D")
            h.drive = 1
    def ranged_mods(self, h, t): return 0, False
    def _mook_turn(self, g): Fight.mook_turn(self, g); self.erolls += 1
    def _boss_turn(self, b): Fight.boss_turn(self, b)
    def end_of_round(self):
        R = self.rules
        if (R.hostage and not self.done() and not self.clock_stopped
                and self.clock_skip != self.round and self.clock < R.hostage):
            self.clock += 1
            if self.clock == R.hostage:
                for h in self.up(): add_stress(h, 2)
    def run(self):
        self.rules.ambush = False
        return super().run()


def cannery_party(R):
    H = S.make_heroes(R)
    p = [H["rook"], H["nightjar"]]
    for h in p:
        h.ds_new = False; h.start_stress = h.stress; h.flairs = tuple(h.flairs)
    return p


# ---------------------------------------------------------------- batch + summary
def run_batch(R, runs, seed, cls=AlleyFight, party_fn=make_party):
    dice = Dice(seed)
    return [cls(party_fn(R), R, dice).run() for _ in range(runs)]


def summarize(res, names):
    n = len(res)
    rd = Counter(min(r["rounds"], 9) for r in res)
    harm = sum(sum(r["harm"]) for r in res); hz = sum(sum(r["hazard"]) for r in res)
    out = {
        "win%": 100 * sum(r["win"] for r in res) / n,
        "rounds": statistics.mean(r["rounds"] for r in res),
        "rounds_dist%": {k if k < 9 else "9+": round(100 * rd[k] / n, 1) for k in sorted(rd)},
        "downs/fight": sum(r["downs"] for r in res) / n,
        "dying%": 100 * sum(r["dying"] for r in res) / n,
        "break%": 100 * sum(r["broke"] for r in res) / n,
        "end_stress": {nm: round(statistics.mean(r["end_stress"][i] for r in res), 2) for i, nm in enumerate(names)},
        "hero_harm/fight": harm / n,
        "downs_by_hero": {nm: round(statistics.mean(r["downs_each"][i] for r in res), 3) for i, nm in enumerate(names)},
        "harm_by_hero": {nm: round(statistics.mean(r["harm"][i] for r in res), 2) for i, nm in enumerate(names)},
        "break_by_hero%": {nm: round(100 * statistics.mean(r["broke_each"][i] for r in res), 1) for i, nm in enumerate(names)},
        "hazard_share%": 100 * hz / harm if harm else 0.0,
        "hazard_harm_by_hero": {nm: round(statistics.mean(r["hazard"][i] for r in res), 3) for i, nm in enumerate(names)},
        "enemy_hazard/fight": sum(r["enemy_hazard"] for r in res) / n,
        "hero_hit%": 100 * (1 - sum(r["hero_misses"] for r in res) / max(1, sum(r["hero_rolls"] for r in res))),
        "enemy_hit%": 100 * sum(r["e_hits"] for r in res) / max(1, sum(r["e_rolls"] for r in res)),
        "presence_hit%": 100 * sum(r["p_hits"] for r in res) / max(1, sum(r["p_rolls"] for r in res)),
    }
    return out


def job1(runs, seed):
    out = {"alley": [], "alley_side": [], "cannery": []}
    names = ["cyrus", "bulwark", "patchwork"]
    for start in ("session", "fresh"):
        for boxes in (4, 5):
            for ds in ("old", "new", "both"):
                R = ARules(ds=ds, base_boxes=boxes, start=start)
                s = summarize(run_batch(R, runs, seed), names)
                s.update(start=start, boxes=boxes, ds=ds)
                out["alley"].append(s)
    # sensitivity rows (fresh, 4 boxes, old Danger Sense unless noted)
    for label, kw in [("no Danger Sense at all", dict(ds="none")),
                      ("Patchwork grapples up and tases Sparks", dict(patch="tase")),
                      ("3 Saints instead of 2", dict(saints=3)),
                      ("no ambush", dict(ambush=False)),
                      ("1 flare instead of 2", dict(flares=1)),
                      ("Sparks earns no Drive (no Trickster trigger)", dict(sparks_role="none"))]:
        R = ARules(start="fresh", **kw)
        s = summarize(run_batch(R, runs, seed), names); s["variant"] = label
        out["alley_side"].append(s)
    for mode in ("flat", "tough"):
        R = ARules(hazard_mode=mode, hazard_fire=False, objective=3, hostage=4, mode="cannery", sparks_role="none", kit_items="taser,flashbang,smoke")
        res = run_batch(R, runs, seed, CanneryHazardFight, cannery_party)
        s = summarize(res, ["rook", "nightjar"]); s["hazard_mode"] = mode
        out["cannery"].append(s)
    return out


def job1b(runs, seed):
    """Follow-up: rulings applied; fresh; DS old/none; 4/5 boxes; 2/3 Saints; plus Bulwark without his extra box at 5."""
    names = ["cyrus", "bulwark", "patchwork"]; rows = []
    for ds in ("old", "none"):
        for saints in (2, 3):
            for boxes, bwx in ((4, True), (5, True), (5, False)):
                R = ARules(ds=ds, base_boxes=boxes, saints=saints, start="fresh", bw_extra=bwx)
                s = summarize(run_batch(R, runs, seed), names)
                s.update(ds=ds, saints=saints, boxes=boxes, bulwark_extra_box=bwx); rows.append(s)
    side = []
    for label, kw in [("Sparks takes the ambush Edge instead of the Saints", dict(ambush_opener="sparks")),
                      ("Patchwork tases (Full Action, Flow, no -2)", dict(patch="tase"))]:
        R = ARules(start="fresh", **kw)
        s = summarize(run_batch(R, runs, seed), names); s["variant"] = label; side.append(s)
    return {"grid": rows, "side": side}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=10000)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--log", type=int, default=0)
    ap.add_argument("--ds", default="old")
    ap.add_argument("--start", default="fresh")
    ap.add_argument("--job", default="1")
    a = ap.parse_args()
    if a.job == "1b":
        print(json.dumps(job1b(a.runs, a.seed), indent=1)); return
    if a.log:
        dice = Dice(a.seed)
        for _ in range(a.log):
            R = ARules(ds=a.ds, start=a.start)
            r = AlleyFight(make_party(R), R, dice, log=True).run()
            print("=== WIN" if r["win"] else "=== LOSS", r["rounds"], "rounds\n")
        return
    print(json.dumps(job1(a.runs, a.seed), indent=1))


if __name__ == "__main__":
    main()
