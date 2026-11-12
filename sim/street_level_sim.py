#!/usr/bin/env python3
"""
Driven fight simulator (rules version 2026-11-12.21).

Plays out fights by the rules thousands of times and reports balance numbers:
win rate, rounds, Harm taken, heroes Down or Dying, Drive earned and spent,
Signature Moves used, and how far Stress climbs.

It models the COMBAT rules only. Investigation, Dawn, clocks other than a
hostage/round limit, and zone movement are abstracted (see LIMITS at bottom).

Usage examples:
  python3 street_level_sim.py                                  # default party vs Cannery
  python3 street_level_sim.py --party rook,nightjar,ledger --scenario boss
  python3 street_level_sim.py --all-combos --scenario cannery --runs 3000
  python3 street_level_sim.py --compare sig-cost=2 --compare stress-on-miss
  python3 street_level_sim.py --no-gear                        # Session 1 conditions
  python3 street_level_sim.py --log 1 --seed 7                 # print one fight, roll by roll

Rule switches (defaults match the current rules doc):
  --sig-cost N         Signature Move cost in Drive (default 3)
  --stress-on-miss     every hero miss also gives 1 Stress (proposed rule)
  --no-graze           guns add +1 Impact on ANY hit (old rule)
  --no-mook-cap        mook attacks are not capped at 2 Harm
  --no-second-wind     disable the Second Wind trial rule
  --no-gear            strip all gear and powers (Session 1 conditions)
  --boss-harm N        override the boss's Harm boxes
  --dark               the fight zone is Dark (ranged attacks at Disadvantage)
  --spill full|reduced|none   mook spill (default reduced: Impact 3 drops 2, else 1)
  --boss-actions N     boss turns per round (default 0 = one per two heroes rounded up, or one per hero if the villain fights alone)
  --boss-def N         bonus to the boss's Guard and Wits
  --mook-guard N       mook Guard (default 13)
  --fixed-gang         always 2 mook groups instead of one per hero
  --no-down-stress / --no-villain-presence / --no-strange-stress / --no-invuln-overflow
                       turn off the post-Session-1 Stress rules one at a time
  --config FILE        run an encounter in the app's JSON format, print the result as JSON
  --objective N        the fight has an Objective of N steps (3 = the Cannery's Free the hostage);
                       non-fighters work it, and finishing it wins the fight
  --hostage N          a clock of N that ticks each round; when it fills every hero takes 2 Stress
  --no-grit / --no-light-jab / --no-villain-stress / --old-weapons
                       turn off the Nov 11 and 12 rule changes one at a time
  Leader test hero: marshal (Presence +4, Rally, Carry the weight, On My Signal)
  Extra test heroes with strange powers: jessica (Mighty), luke (Invulnerability), logan (Healing Factor)
"""
import argparse, itertools, json, random, statistics, sys
from dataclasses import dataclass, field, fields

SIM_VERSION = "2026-11-12.2"   # bump when fight logic or run_encounter's output changes

# ---------------------------------------------------------------- dice
DEF_BASE = 12   # defenses are DEF_BASE + stat (was 10 before the Nov 9 balance pass)
BAND = 4        # Impact band width: margin 0..BAND-1 = Impact 1, BAND..2*BAND-1 = Impact 2

class Dice:
    def __init__(self, seed=None):
        self.r = random.Random(seed)
    def d10(self):
        return self.r.randint(1, 10)
    def roll(self, bonus, defense, adv=0, edge=False):
        """2d10 (+3rd die for Advantage/Disadvantage) + bonus (+2 Edge) vs defense.
        Returns (impact 0..3, margin, dice, total)."""
        n = 3 if adv else 2
        dice = [self.d10() for _ in range(n)]
        s = sorted(dice)
        kept = s[-2:] if adv > 0 else (s[:2] if adv < 0 else dice)
        total = sum(kept) + bonus + (2 if edge else 0)
        margin = total - defense
        impact = 0 if margin < 0 else 1 if margin < BAND else 2 if margin < 2*BAND else 3
        return impact, margin, dice, total

def net_adv(*flags):
    """Advantage and Disadvantage cancel; neither stacks."""
    a = any(f > 0 for f in flags); d = any(f < 0 for f in flags)
    return 0 if a == d else (1 if a else -1)

# ---------------------------------------------------------------- rules config
@dataclass
class Rules:
    sig_cost: int = 3
    stress_on_miss: bool = False
    graze: bool = True
    mook_cap: bool = True
    second_wind: bool = True
    gear: bool = True
    boss_harm: int = None
    dark: bool = False
    max_rounds: int = 15
    mook_guard: int = 13      # 12 + mook Flow
    spill: str = "reduced"       # full: Impact N drops N mooks | reduced: Impact 3 drops 2, else 1 | none: 1 per hit
    boss_actions: int = 0     # boss turns per round; 0 = one per two heroes, rounded up
    boss_def: int = 0         # bonus to the boss's Guard and Wits
    groups: int = 0             # force a number of mook groups (0 = use the scaling rule)
    gang_per_hero: bool = True
    down_stress: bool = True        # going Down: +2 Stress; seeing an ally go Down: +1
    villain_presence: bool = True   # named villains sometimes make Presence attacks (Stress)
    strange_stress: bool = True     # first use of a strange power each fight: +1 Stress
    invuln_overflow: bool = True    # Invulnerability: Stress past 8 spills into Harm (proposed fix)
    presence_free: bool = True     # villain threat is an extra action once per round, not a replacement
    heal_cost: bool = False         # Healing Factor: every heal costs 1 Stress, not just the first
    heal_calm: bool = False        # old rule: Healing Factor only heals if you weren't hurt since your last turn
    kit: bool = True               # model Specialist Kit and the Prepared Signature
    kit_edge: bool = False         # Specialists roll Kit with Edge
    trap_pierce: bool = True       # Prepared's trap ignores Toughness
    protector_any: bool = True     # Protector trigger: any attack against you (hit or miss)
    det_payoff: bool = True        # Detective trigger: an ally hits using your Read's Edge
    read_pierce: bool = True       # a hit using Read's Edge ignores Toughness (the weakness)
    broken: str = ""               # hero key with the Already Broken Flair (test only)
    broken_drive: int = 3          # its starting Drive
    kit_items: str = "taser,flashbang,smoke"   # Patchwork's 3 Kit picks for the Night
    heal_hurt_cost: bool = True    # current rule: a heal after being hurt since your last turn costs 1 Stress  # one group of 3 mooks per hero (False = always 2 groups)
    # Nov 11 and 12 rules
    objective: int = 0             # Objective steps (0 = none). 3 = the Cannery's Free the hostage
    bruisers: int = 0              # swap this many mook groups for a bruiser group (2 Harm each)
    bruisers_extra: int = 0        # add this many bruiser groups on top of the usual gang
    bruiser_size: int = 3          # bruisers in a group
    obj_per_round: int = 0         # at most this many Objective steps finished per round (0 = no limit)
    hostage: int = 0               # a clock that ticks each round; full = 2 Stress to every hero (0 = none)
    grit: bool = True              # Grit your teeth: 1 Stress to ignore Wounded for a turn
    light_jab: bool = True         # a Jab with light melee has no -2
    new_weapons: bool = True       # knife +1 only on Impact 2+; heavy melee never on a Jab
    villain_stress: bool = True    # named enemies have a Stress track; Breaking gives every attack on them Edge
    spite_fraying: bool = True     # a Fraying Spite hero: the attacker takes 1 Stress, once per round
    taser_named: bool = True       # a taser gives a named enemy Disadvantage on their next roll (not a lost Quick Action)

# ---------------------------------------------------------------- combatants
@dataclass
class Hero:
    key: str; name: str; arch: str; trait: str
    force: int; flow: int; focus: int; presence: int
    boxes: int = 4
    weapon: str = "unarmed"        # unarmed | light | heavy | pistol | knife
    armor_guns: int = 0            # Kevlar: Toughness vs guns and blades
    armor_all: int = 0             # Iron Skin / tactical armor / Armored
    medkit: int = 0
    flairs: tuple = ()
    power: str = ""
    strange: bool = False          # power is strange tier (costs 2 slots, first-use Stress)
    guard_bonus: int = 0           # riot shield etc.
    tough_blunt: int = 0           # Resilience power: Toughness 1 vs fists and blunt
    armor_flaky: bool = False      # powered armor: a Miss on the wearer's roll cuts it out until their next turn
    # state
    armor_off: bool = False
    harm: int = 0; stress: int = 0; drive: int = 2   # start each Night with 2 (was 1)
    hidden: bool = False; dying: bool = False
    engaged_with: object = None
    sw_used: bool = False; trait_drive_used: bool = False
    stand_ground: bool = False; arch_drive_round: int = -1
    opportunist_used: bool = False
    strange_used: bool = False
    broke: bool = False
    kit_used: tuple = ()
    adv_next: bool = False
    grit_on: bool = False          # Grit your teeth is on this turn
    rally_edge: bool = False       # a Leader's Rally: Edge on the next roll
    carry_used: bool = False       # Leader: Carry the weight, once per scene
    stats: dict = field(default_factory=lambda: {"harm_taken": 0, "drive_earned": 0, "drive_spent": 0,
                                                  "sigs": 0, "max_stress": 0, "downs": 0, "misses": 0,
                                                  "rolls": 0, "second_winds": 0, "breaks": 0,
                                                  "harm_to_stress": 0})
    @property
    def guard(self): return DEF_BASE + self.flow + self.guard_bonus
    @property
    def wits(self): return DEF_BASE + self.focus
    @property
    def poise(self): return DEF_BASE + self.presence
    @property
    def down(self): return self.harm >= self.boxes
    @property
    def wounded(self): return (not self.down) and self.harm >= self.boxes - 1
    def toughness(self, gun, blade):
        base = 1 if (self.force >= 3 or self.tough_blunt) and not gun and not blade else (1 if self.force >= 3 and blade else 0)
        vs = 0 if self.armor_off else self.armor_all
        if (gun or blade) and self.armor_guns: vs = max(vs, self.armor_guns)
        t = max(base, vs)
        if self.stand_ground: t = min(2, t + 1)
        return t
    def phys_adv(self, stat):
        return -1 if self.wounded and not self.grit_on and stat in ("force", "flow") else 0

@dataclass
class Mooks:
    name: str = "Saints"; count: int = 3; start: int = 3
    attack: int = 2; guard: int = 13; gunner: bool = True
    fled: bool = False
    dis_next: bool = False
    harm_each: int = 1             # 2 = bruisers: every 2 Harm drops one, leftover carries to the next
    dmg: int = 0
    @property
    def out(self): return self.count <= 0 or self.fled
    @property
    def poise(self): return DEF_BASE

@dataclass
class Boss:
    name: str = "The Butcher"
    force: int = 4; flow: int = 0; focus: int = 1; presence: int = 2
    harm_max: int = 10; toughness_v: int = 1; drive: int = 2   # case villain: 10 Harm (Nov 10)
    weapon: str = "unarmed"
    role: str = "villain"          # villain: one turn per two heroes (per hero if alone) | lieutenant: one turn a round
    harm: int = 0; read_edge: bool = False; called: bool = False
    last_hurt_by: object = None
    defbonus: int = 0
    dis_next: bool = False; tased: bool = False
    stress: int = 0                # named enemies have a Stress track (Nov 11)
    @property
    def poise(self): return DEF_BASE + self.presence
    @property
    def stress_max(self): return 4 if self.role == "lieutenant" else 6
    @property
    def breaking(self): return self.stress >= self.stress_max
    @property
    def guard(self): return DEF_BASE + self.flow + self.defbonus
    @property
    def wits(self): return DEF_BASE + self.focus + self.defbonus
    @property
    def out(self): return self.harm >= self.harm_max

# ---------------------------------------------------------------- sample heroes
def make_heroes(rules):
    g = rules.gear
    H = {
      "bulwark": Hero("bulwark", "Bulwark", "Protector", "Mercy", 3, 0, 1, 2,
                      boxes=5 if g else 4, medkit=1 if g else 0, power="Toughness" if g else "",
                      tough_blunt=1 if g else 0, guard_bonus=1 if g else 0),
      "rook": Hero("rook", "Rook", "Brawler", "Spite", 4, 2, -1, 1, boxes=5,
                   weapon="light" if g else "unarmed", armor_guns=1 if g else 0,
                   medkit=1 if g else 0, flairs=("hard_to_kill",)),
      "nightjar": Hero("nightjar", "Nightjar", "Stalker", "Vengeance", 1, 4, 2, -1,
                       weapon="light" if g else "unarmed", flairs=("opportunist",),
                       power="Shadow Manipulation" if g else "", strange=g),
      "patchwork": Hero("patchwork", "Patchwork", "Specialist", "Thrill", 0, 2, 3, 1,
                        weapon="unarmed"),
      "ledger": Hero("ledger", "The Ledger", "Detective", "Order", -1, 1, 4, 2,
                     weapon="pistol" if g else "unarmed", armor_guns=1 if g else 0),
      # strange-power test heroes (2-slot power + 1 gear)
      "jessica": Hero("jessica", "Jessica", "Detective", "Spite", 2, 1, 3, 0,
                      power="Mighty", strange=True),
      "luke": Hero("luke", "Luke", "Protector", "Justice", 4, -1, 1, 2,
                   power="Invulnerability", strange=True),
      "logan": Hero("logan", "Logan", "Brawler", "Vengeance", 3, 2, 1, 0,
                    weapon="light", power="Healing Factor", strange=True),
      # Leader test hero (Nov 12): Presence +4, a sidearm and a vest
      "marshal": Hero("marshal", "Marshal", "Leader", "Duty", -1, 2, 1, 4,
                      weapon="pistol" if g else "unarmed", armor_guns=1 if g else 0),
    }
    return H

# ---------------------------------------------------------------- damage
def weapon_bonus(weapon, impact, rules, target_tough, jab=False):
    if impact <= 0: return 0
    if weapon == "heavy": return 0 if (jab and rules.new_weapons) else 1
    if weapon == "light": return 1 if impact >= 2 else 0
    if weapon == "pistol": return 1 if (impact >= 2 or not rules.graze) else 0
    if weapon == "knife": return 1 if target_tough == 0 and (impact >= 2 or not rules.new_weapons) else 0
    return 0

def harm_to_hero(h, impact, rules, gun=False, blade=False, from_mook=False):
    if impact <= 0: return 0
    t = h.toughness(gun, blade)
    wb = 1 if (gun and (impact >= 2 or not rules.graze)) else 0
    harm = max(1, impact + wb - t)
    if from_mook and rules.mook_cap: harm = min(harm, 2)
    return harm

def apply_hero_harm(h, harm, log, rules=None, physical=True):
    if harm <= 0: return
    if h.power == "Invulnerability" and physical:
        room = 8 - h.stress
        to_stress = harm if not (rules and rules.invuln_overflow) else min(harm, room)
        add_stress(h, to_stress); h.stats["harm_to_stress"] += to_stress
        log(f"   {h.name} shrugs it off: {to_stress} Stress ({h.stress}/8)")
        harm -= to_stress
        if harm <= 0 or not (rules and rules.invuln_overflow): return
        log(f"   ...Stress is full, {harm} spills into Harm")
    if h.down:
        h.dying = True; log(f"   {h.name} is DYING")
        return
    h.harm = min(h.boxes, h.harm + harm)
    h.stats["harm_taken"] += harm
    log(f"   {h.name} takes {harm} Harm ({h.harm}/{h.boxes})")
    if h.down:
        h.stats["downs"] += 1; log(f"   {h.name} goes DOWN")

def gain_drive(h, n, why, log):
    before = h.drive
    h.drive = min(6, h.drive + n)
    got = h.drive - before
    h.stats["drive_earned"] += got
    if got: log(f"   {h.name} +{got} Drive ({why}) -> {h.drive}")

def spend(h, n):
    h.drive -= n; h.stats["drive_spent"] += n

def add_stress(h, n):
    if n <= 0: return
    h.stress = min(8, h.stress + n)
    h.stats["max_stress"] = max(h.stats["max_stress"], h.stress)
    if h.stress >= 8 and not h.broke:
        h.broke = True; h.stats["breaks"] += 1

# ---------------------------------------------------------------- the fight
class Fight:
    def __init__(self, party, scenario, rules, dice, log=False):
        self.rules, self.d = rules, dice
        self.heroes = party
        self.groups, self.bosses = [], []
        self.verbose = log
        if scenario in ("gang", "cannery"):
            if rules.groups: n = rules.groups
            elif not rules.gang_per_hero: n = 2
            elif scenario == "cannery": n = max(1, len(party) // 2)   # with a named villain: one group per two heroes
            else: n = len(party)
            self.groups = [Mooks(name=f"Saints {chr(65+i)}", guard=rules.mook_guard) for i in range(n)]
            bz = rules.bruiser_size
            mk = lambda i: Mooks(name=f"Bruisers {chr(65+i)}", count=bz, start=bz, attack=3, guard=12, gunner=False, harm_each=2)
            for i in range(min(rules.bruisers, len(self.groups))):   # swap mook groups for bruiser groups
                self.groups[i] = mk(i)
            for i in range(rules.bruisers_extra):                    # or add bruiser groups on top
                self.groups.append(mk(len(self.groups)))
        if scenario in ("boss", "cannery"):
            self.boss = Boss()   # the Butcher: 10 Harm (the "2 fewer for Toughness" trial rule was dropped on Nov 12)
            if rules.boss_harm: self.boss.harm_max = rules.boss_harm
        if self.boss: self.boss.defbonus = rules.boss_def
        if scenario == "gunboss":
            self.boss = Boss(name="Lieutenant", force=1, flow=3, focus=1, presence=1,
                             harm_max=rules.boss_harm or 5, toughness_v=0, weapon="pistol")
            self.groups = [Mooks(name="Saints A", guard=rules.mook_guard)]
            self.boss.defbonus = rules.boss_def
        self.round = 0
        self.smoke_until = -1
        # Objective (Nov 11 and 12): steps left, each (rating, stats that fit). 3 steps = the Cannery.
        cannery_steps = [(-1, ("force", "focus")), (1, ("flow", "focus")), (1, ("flow", "presence"))]
        any_stat = ("force", "flow", "focus", "presence")
        self.steps = list(cannery_steps) if rules.objective == 3 else [(1, any_stat)] * rules.objective
        self.obj_total = len(self.steps); self.obj_won = False; self.obj_edge = False; self.obj_worker = None
        self.clock = 0; self.clock_skip = -1; self.clock_stopped = False
        for h in self.heroes:
            if h.key == rules.broken: h.stress = 4; h.drive = rules.broken_drive
        # Stalker with a shadow power, or in the dark, starts Hidden (heroes chose the ground)
        for h in self.heroes:
            if h.arch == "Stalker": h.hidden = True
            if h.trait == "Order": gain_drive(h, 1, "Order: plan", self.log); h.trait_drive_used = True

    def log(self, s):
        if self.verbose: print(s)

    # -- state
    # Named enemies live in self.bosses. self.boss is the first one still standing
    # (None if none are), which is all the single-villain tactics ever look at.
    @property
    def boss(self):
        return next((b for b in self.bosses if not b.out), None)
    @boss.setter
    def boss(self, b):
        self.bosses = [b] if b else []
    def live_bosses(self): return [b for b in self.bosses if not b.out]
    def foes(self):
        f = [g for g in self.groups if not g.out]
        f.extend(self.live_bosses())
        return f
    def up(self): return [h for h in self.heroes if not h.down]
    def done(self): return not self.foes() or not self.up() or self.obj_won

    # -- hero roll wrapper
    def hroll(self, h, stat, defense, adv=0, edge=False, target=None):
        payoff = None
        if not edge and target is not None and getattr(target, "read_edge", False):
            edge = True; target.read_edge = False; payoff = getattr(target, "read_by", None)
            target.pierce_next = self.rules.read_pierce
        if h.adv_next: adv = net_adv(adv, 1) if adv >= 0 else 0; h.adv_next = False
        a = net_adv(adv, h.phys_adv(stat))
        if not edge and isinstance(target, Boss) and target.breaking and self.rules.villain_stress:
            edge = True   # a Breaking villain: every attack against them has Edge
        rallied = None
        if not edge and h.rally_edge:
            edge = True; h.rally_edge = False; rallied = getattr(h, "rally_by", None)
        if not edge and h.drive >= 2 and h.drive - 1 >= self.reserve(h):
            spend(h, 1); edge = True
        imp, m, dice, tot = self.d.roll(getattr(h, stat), defense, a, edge)
        h.stats["rolls"] += 1
        if imp and rallied is not None and not rallied.down:
            self.arch_drive(rallied, "Leader: Rally paid off")
        if imp and payoff is not None and payoff is not h and self.rules.det_payoff and not payoff.down:
            self.arch_drive(payoff, "Detective: Read paid off")
        if imp == 0:
            h.stats["misses"] += 1
            if h.armor_flaky and h.armor_all: h.armor_off = True   # the GM cuts the armor out on a Miss
            if self.rules.stress_on_miss: add_stress(h, 1)
        self.log(f"   {h.name} {stat} {getattr(h,stat):+d}{' Edge' if edge else ''}"
                 f"{' Adv' if a>0 else ' Dis' if a<0 else ''} {dice} = {tot} vs {defense}: "
                 f"{'MISS' if imp==0 else 'Impact '+str(imp)}")
        return imp

    def reserve(self, h):
        """Keep Drive back for a Signature if one is in reach."""
        return self.rules.sig_cost if h.drive >= self.rules.sig_cost - 1 else 0

    def use_strange(self, h):
        if h.strange and self.rules.strange_stress and not h.strange_used and h.power != "Invulnerability":
            h.strange_used = True; add_stress(h, 1); self.log(f"   {h.name} pays 1 Stress for {h.power}")

    def hurt(self, t, harm, physical=True):
        t.hurt_recently = True
        was_down = t.down
        apply_hero_harm(t, harm, self.log, self.rules, physical)
        if t.down and not was_down and self.rules.down_stress:
            add_stress(t, 2)
            for a in self.up():   # witnesses: only the first ally Down per fight
                if not getattr(a, 'saw_down', False):
                    a.saw_down = True; add_stress(a, 1)

    def arch_drive(self, h, why):
        if h.arch_drive_round != self.round:
            h.arch_drive_round = self.round; gain_drive(h, 1, why, self.log)

    # -- damage to foes
    def hit_group(self, h, g, impact, sig_takedown=False):
        if impact <= 0 or g.out: return 0
        if g.harm_each > 1:   # bruisers take Harm like a named enemy
            g.dmg += impact + weapon_bonus(h.weapon, impact, self.rules, 0)
            drops = min(g.count, g.dmg // g.harm_each)
            g.dmg = 0 if drops >= g.count else g.dmg - drops * g.harm_each
        else:
            sp = self.rules.spill
            n = impact if sp == "full" else (2 if impact >= 3 else 1) if sp == "reduced" else 1
            drops = min(g.count, n)
        g.count -= drops
        self.log(f"   {drops} of {g.name} drop ({g.count} left)")
        # the gunner is down if he was among them
        if g.gunner and g.count >= 0 and self.d.r.random() < drops / (drops + g.count if drops + g.count else 1):
            g.gunner = False
        if drops: self.arch_drive_if(h, "drop")
        self.morale()
        return drops

    def stress_boss(self, h, b, n):
        """A hero's Presence attack on a named enemy: Stress equal to the Impact."""
        if n <= 0 or b.out or not self.rules.villain_stress: return
        was = b.breaking
        b.stress = min(b.stress_max, b.stress + n)
        self.log(f"   {b.name} takes {n} Stress ({b.stress}/{b.stress_max})")
        if b.breaking and not was: self.log(f"   {b.name} is BREAKING: every attack against them has Edge")

    def hit_boss(self, h, impact, weapon, b=None, jab=False):
        b = b or self.boss
        if impact <= 0 or b.out: return 0
        tough = 0 if (weapon in ("pistol", "taser") or h.power == "Mighty" or getattr(b, "pierce_next", False)) else b.toughness_v
        b.pierce_next = False  # Mighty ignores Toughness
        harm = impact + weapon_bonus(weapon, impact, self.rules, tough, jab)
        if h.power == "Mighty" and impact >= 2:
            harm += 1; self.use_strange(h)
        harm = max(1, harm - tough)
        # Drive upgrade: +1 Impact (Impact 1 or 2 only) for 2 if it finishes him or it's worth it
        if h.drive >= 2 and impact < 3 and (b.harm + harm + 1 >= b.harm_max > b.harm + harm):  # Impact 3 is the top
            spend(h, 2); harm += 1; self.log(f"   {h.name} spends 2 Drive to upgrade")
        b.harm = min(b.harm_max, b.harm + harm); b.last_hurt_by = h
        self.log(f"   {b.name} takes {harm} ({b.harm}/{b.harm_max})")
        if b.out: self.arch_drive_if(h, "drop"); self.morale()
        return harm

    def arch_drive_if(self, h, event):
        if h.arch == "Brawler" and event in ("drop", "hurt"): self.arch_drive(h, "Brawler")

    def morale(self):
        start = sum(g.start for g in self.groups)
        left = sum(g.count for g in self.groups if not g.fled)
        boss_up = self.boss and not self.boss.out
        if self.groups and left * 2 <= start and not boss_up:
            for g in self.groups:
                if not g.out: g.fled = True; self.log(f"   {g.name} flee")

    # -- hero turn
    def target_for(self, h):
        live = [g for g in self.groups if not g.out]
        gunners = [g for g in live if g.gunner]
        if h.arch in ("Brawler", "Protector", "Specialist"):
            if gunners: return gunners[0]
            if live: return live[0]
            return self.boss if self.boss and not self.boss.out else None
        if h.arch == "Stalker":
            if self.boss and not self.boss.out and h.hidden and h.drive >= self.rules.sig_cost: return self.boss
            if gunners: return gunners[0]
            if live: return live[0]
            return self.boss if self.boss and not self.boss.out else None
        # Detective: boss first if there is one
        if self.boss and not self.boss.out: return self.boss
        return gunners[0] if gunners else (live[0] if live else None)

    def hero_turn(self, h):
        self._hero_turn(h)
        calm = not getattr(h, "hurt_recently", False)
        h.hurt_recently = False
        if h.power == "Healing Factor" and not h.down and h.harm > 0 and (calm or not self.rules.heal_calm):
            if self.rules.heal_cost and h.strange_used: add_stress(h, 1)
            elif self.rules.heal_hurt_cost and not calm: add_stress(h, 1)
            self.use_strange(h); h.harm -= 1; self.log(f"   {h.name} heals 1 ({h.harm}/{h.boxes})")

    def _hero_turn(self, h):
        R = self.rules
        if h.down:
            if R.second_wind and not h.sw_used and h.drive >= 3:
                spend(h, 3); h.sw_used = True; h.harm = h.boxes - 1
                h.stats["second_winds"] += 1; self.log(f" {h.name}: Second Wind, back up at Wounded")
            return
        h.stand_ground = False
        h.armor_off = False   # powered armor comes back on this turn (really a Quick Action; the sim lets it happen free)
        # Grit your teeth: a Wounded hero takes 1 Stress to ignore the penalty this turn (not if it risks Breaking)
        h.grit_on = False
        if R.grit and h.wounded and h.stress <= 5 and h.arch != "Leader":
            h.grit_on = True; add_stress(h, 1); self.log(f" {h.name} grits their teeth (1 Stress, {h.stress}/8)")
        # med kit on a Downed ally
        downed = [x for x in self.heroes if x.down and x is not h]
        if h.medkit and downed:
            x = downed[0]; h.medkit -= 1; x.harm = x.boxes - 1; x.dying = False
            self.log(f" {h.name}: med kit on {x.name} (back up at Wounded)"); return
        sig = h.drive >= R.sig_cost
        # Objective: non-fighters work it unless a Signature Move is ready
        capped = self.rules.obj_per_round and getattr(self, "obj_round", (0, 0)) == (self.round, self.rules.obj_per_round)
        if self.steps and h.arch in ("Detective", "Specialist", "Leader") and not sig and not capped:
            self.work_objective(h); return
        t = self.target_for(h)
        if t is None: return
        self.log(f" {h.name} ({h.arch}) -> {t.name}")
        if h.arch == "Leader":
            self.leader_turn(h, t, sig); return
        if h.arch == "Detective" and isinstance(t, Boss):
            if sig and not t.called:
                spend(h, R.sig_cost); h.stats["sigs"] += 1; t.called = True
                self.log("   Called It: the Butcher's next attack fails, allies get a free Jab")
                for a in self.up():
                    if a is not h: self.jab(a, t)
                return
            if not getattr(t, "read_done", False):
                t.read_done = True
                imp = self.hroll(h, "focus", t.wits)
                if imp: t.read_edge = True; t.read_by = h; self.arch_drive(h, "Detective: Read")
                # second Quick: a Jab
                self.jab(h, t); return
        if h.arch == "Brawler" and sig:
            spend(h, R.sig_cost); h.stats["sigs"] += 1
            defense = t.guard
            imp = self.hroll(h, "force", defense, adv=1, target=t)
            if imp: imp = min(3, imp) + 1
            self.log("   Haymaker")
            self.resolve(h, t, imp, "force"); return
        if h.arch == "Stalker" and h.hidden and sig and isinstance(t, Boss):
            spend(h, R.sig_cost); h.stats["sigs"] += 1
            imp = self.hroll(h, "flow", t.guard, adv=1, edge=self.rules.dark, target=t)
            h.hidden = False
            if imp: imp = 3
            self.log("   Take Down"); self.resolve(h, t, imp, "flow"); return
        if h.arch == "Protector" and sig and len(self.up()) > 1:
            spend(h, R.sig_cost); h.stats["sigs"] += 1; h.stand_ground = True
            self.log("   Stand Your Ground: all attacks come to Bulwark this round")
            self.jab(h, t); return
        if h.arch == "Specialist" and R.kit:
            if self.specialist_turn(h, t, sig): return
        # Stalker out of hiding: Vanish (Quick) + Jab (Quick), if the zone allows it
        if h.arch == "Stalker" and not h.hidden and (h.power == "Shadow Manipulation" or self.rules.dark):
            watch = max([DEF_BASE + 1] + [b.wits for b in self.live_bosses()])
            if h.power == "Shadow Manipulation": self.use_strange(h)
            if self.hroll(h, "flow", watch):
                h.hidden = True; self.log(f"   {h.name} vanishes")
            self.jab(h, t); return
        # ordinary Strike
        stat = "flow" if (h.weapon == "pistol" or h.flow > h.force) and h.power != "Mighty" else "force"
        adv = 1 if h.hidden else 0
        if h.weapon == "pistol" and self.rules.dark: adv = net_adv(adv, -1)
        imp = self.hroll(h, stat, t.guard, adv=adv, target=t)
        if h.hidden:
            h.hidden = False; self.arch_drive(h, "Stalker: from hiding")
        self.resolve(h, t, imp, stat)

    def leader_turn(self, h, t, sig):
        """Leader: On My Signal with 3 Drive; otherwise Rally an ally and a Presence Jab."""
        R = self.rules
        allies = [a for a in self.up() if a is not h]
        best = max(allies, key=lambda a: max(a.force, a.flow)) if allies else None
        if sig and best:
            spend(h, R.sig_cost); h.stats["sigs"] += 1
            self.log(f"   On My Signal: {best.name} takes a full turn now, Advantage on the first roll")
            best.adv_next = True
            self._hero_turn(best)
            return
        # Presence shakes a villain until they Break; after that (or against Toughness-free mooks) it still drops mooks
        shaken = isinstance(t, Boss) and (t.breaking or not R.villain_stress)
        stat = ("flow" if h.flow >= h.force else "force") if shaken else "presence"
        # With a real fighter beside them, Rally and Jab. Otherwise a full Presence Strike does more.
        if best and max(best.force, best.flow) >= 3:
            best.rally_edge = True; best.rally_by = h
            self.log(f"   Rally: {best.name} has Edge on their next roll")
            self.jab(h, t, stat=stat)
            return
        defense = t.poise if stat == "presence" else t.guard
        imp = self.hroll(h, stat, defense, target=t)
        self.resolve(h, t, imp, stat)

    def work_objective(self, h):
        """A Full Action on the next Objective step. You can't work a step while engaged: break away first."""
        foe = h.engaged_with
        if foe is not None and not foe.out:
            atk = foe.attack if isinstance(foe, Mooks) else foe.force
            imp, m, dice, tot = self.d.roll(atk - 2, h.guard, 0, False)
            self.log(f" {h.name} breaks away from {foe.name}: free Jab {dice} = {tot} vs {h.guard}: {'MISS' if imp==0 else 'hit'}")
            if imp: self.hurt(h, harm_to_hero(h, 1, self.rules, from_mook=isinstance(foe, Mooks)))
            h.engaged_with = None
            if h.down: return
        rating, stats = self.steps[0]
        stat = max(stats, key=lambda s: getattr(h, s))
        n = self.obj_total - len(self.steps) + 1
        self.log(f" {h.name} ({h.arch}) works Objective step {n} of {self.obj_total}")
        edge = self.obj_edge; self.obj_edge = False
        imp = self.hroll(h, stat, DEF_BASE + rating, edge=edge)
        self.obj_worker = h
        if imp == 0: return
        if imp == 1:   # a cost: Stress while Steady, otherwise Harm
            if h.stress < 3: add_stress(h, 1); self.log(f"   cost: 1 Stress ({h.stress}/8)")
            else: self.hurt(h, 1, physical=False)
        if imp == 3: self.obj_edge = True
        self.steps.pop(0)
        r, k = getattr(self, "obj_round", (0, 0))
        self.obj_round = (self.round, k + 1 if r == self.round else 1)
        self.arch_drive(h, "Objective step")
        # every step pays (the Cannery): step 1 holds the clock this round, step 2 stops it
        if n == 1: self.clock_skip = self.round
        if n == 2: self.clock_stopped = True
        if not self.steps:
            self.obj_won = True; self.log("   The Objective is done: the heroes win")

    def specialist_turn(self, h, t, sig):
        """Prepared, or up to two Kit items as Quick Actions. Returns True if the turn was used."""
        R = self.rules
        items = [i for i in R.kit_items.split(",") if i and i not in h.kit_used]
        boss_up = self.boss and not self.boss.out
        if sig:
            spend(h, R.sig_cost); h.stats["sigs"] += 1
            tgt = self.boss if boss_up else t
            self.log("   Prepared: a trap goes off (Impact 2), Advantage on the next roll")
            if isinstance(tgt, Mooks): self.hit_group(h, tgt, 2)
            else: self.hit_boss(h, 2, "taser" if R.trap_pierce else "unarmed")
            h.adv_next = True
            return True
        quick = 2; used_any = False
        gunners = [g for g in self.groups if not g.out and g.gunner] or [b for b in self.live_bosses() if b.weapon == "pistol"]
        for item in ("flashbang", "smoke", "taser"):
            if quick == 0 or item not in items: continue
            if item == "flashbang" and len(self.foes()) >= 1:
                h.kit_used += (item,); quick -= 1; used_any = True; changed = False
                for f in self.foes():
                    if self.hroll(h, "flow", f.guard, edge=R.kit_edge):
                        f.dis_next = True; changed = True
                self.log("   Flashbang")
                if changed: self.arch_drive(h, "Specialist: Kit")
            elif item == "smoke" and gunners and self.smoke_until < self.round:
                h.kit_used += (item,); quick -= 1; used_any = True
                self.smoke_until = self.round + 1
                self.log("   Smoke: the zone is Dark until the end of next round")
                self.arch_drive(h, "Specialist: Kit")
            elif item == "taser" and boss_up:
                h.kit_used += (item,); quick -= 1; used_any = True
                stat = "flow" if h.flow >= h.force else "force"
                imp, m, dice, tot = self.d.roll(getattr(h, stat) - 2, self.boss.guard, net_adv(h.phys_adv(stat)), R.kit_edge)
                h.stats["rolls"] += 1
                self.log(f"   {h.name} Taser {dice} = {tot} vs {self.boss.guard}: {'MISS' if imp==0 else 'hit'}")
                if imp == 0: h.stats["misses"] += 1
                else:
                    if R.taser_named: self.boss.dis_next = True
                    else: self.boss.tased = True
                    self.hit_boss(h, 1, "taser")
        if not used_any: return False
        if quick: self.jab(h, t)
        return True

    def jab(self, h, t, stat=None):
        if t is None or getattr(t, "out", True): return
        stat = stat or ("flow" if (h.weapon == "pistol" or h.flow > h.force) else "force")
        pen = 0 if (h.weapon == "light" and self.rules.light_jab and stat != "presence") else 2
        defense = t.poise if stat == "presence" else t.guard
        edge = isinstance(t, Boss) and t.breaking and self.rules.villain_stress
        imp, m, dice, tot = self.d.roll(getattr(h, stat) - pen, defense, net_adv(h.phys_adv(stat)), edge)
        h.stats["rolls"] += 1
        if imp == 0:
            h.stats["misses"] += 1
            if h.armor_flaky and h.armor_all: h.armor_off = True
            if self.rules.stress_on_miss: add_stress(h, 1)
        self.log(f"   {h.name} Jab ({stat}) {dice} = {tot} vs {defense}: {'MISS' if imp==0 else 'hit'}")
        if imp: self.resolve(h, t, 1, stat, jab=True)

    def resolve(self, h, t, imp, stat, jab=False):
        if imp <= 0: return
        if isinstance(t, Mooks):
            dropped = self.hit_group(h, t, imp)
            h.engaged_with = t if h.weapon != "pistol" else None
            if h.arch == "Brawler" and dropped and not jab:
                nxt = next((g for g in self.groups if not g.out), None) or (self.boss if self.boss and not self.boss.out else None)
                if nxt: self.log("   Pile Through"); self.jab(h, nxt)
        elif stat == "presence":
            self.stress_boss(h, t, imp)
            if h.arch == "Leader": self.arch_drive(h, "Leader: Presence attack hit")
        else:
            self.hit_boss(h, imp, h.weapon, t, jab=jab)
            h.engaged_with = t if h.weapon != "pistol" else None

    # -- enemy turns
    def mook_turn(self, g):
        targets = self.up()
        if not targets: return
        # shoot whoever is engaged with them, else a random standing hero
        eng = [h for h in targets if h.engaged_with is g]
        t = eng[0] if eng else self.d.r.choice(targets)
        t = self.redirect(t)
        gun = g.gunner
        engaged = any(h.engaged_with is g for h in self.up())
        smoke = gun and self.smoke_until >= self.round
        adv = net_adv(-1 if (gun and engaged) else 0, -1 if (gun and (self.rules.dark or smoke)) else 0, -1 if g.dis_next else 0)
        g.dis_next = False
        edge = g.count >= 3 or (g.harm_each > 1 and g.count >= g.start)
        imp, m, dice, tot = self.d.roll(g.attack, t.guard, adv, edge)
        self.log(f" {g.name} ({g.count}{', gun' if gun else ''}) -> {t.name} {dice} = {tot} vs {t.guard}: "
                 f"{'MISS' if imp==0 else 'Impact '+str(imp)}")
        if imp:
            harm = harm_to_hero(t, imp, self.rules, gun=gun, from_mook=True)
            self.hurt(t, harm)
            self.on_hurt(t, g)
        else:
            self.on_missed(t)

    def boss_turn(self, b=None):
        b = b or self.boss
        targets = self.up()
        if not targets: return
        if b.called:
            b.called = False; self.log(f" {b.name}'s attack fails (Called It)"); return
        b.turns = getattr(b, "turns", 0) + 1
        free = self.rules.presence_free and getattr(b, "threat_round", 0) != self.round
        if self.rules.villain_presence and (free or (not self.rules.presence_free and b.turns % 2 == 0)):
            b.threat_round = self.round
            t = min(targets, key=lambda x: x.poise)
            imp, m, dice, tot = self.d.roll(b.presence, t.poise, -1 if b.dis_next else 0, False)
            b.dis_next = False
            self.log(f" {b.name} threatens {t.name} (Presence) {dice} = {tot} vs {t.poise}: "
                     f"{'MISS' if imp==0 else str(imp)+' Stress'}")
            if imp:
                lead = next((l for l in self.up() if l.arch == "Leader" and l is not t
                             and not l.carry_used and l.stress + imp <= 3), None)
                if lead:
                    lead.carry_used = True; self.log(f"   {lead.name} carries the weight: takes it instead")
                    add_stress(lead, imp)
                else: add_stress(t, imp)
            if not self.rules.presence_free: return
            targets = self.up()
            if not targets: return
        worker = self.obj_worker if (self.steps and self.obj_worker and not self.obj_worker.down) else None
        t = b.last_hurt_by if (b.last_hurt_by and not b.last_hurt_by.down) else \
            worker or next((h for h in targets if h.engaged_with is b), None) or self.d.r.choice(targets)
        t = self.redirect(t)
        if self.obj_total and b.weapon != "pistol": t.engaged_with = b   # he closes in on them
        edge = False
        if b.drive >= 1: b.drive -= 1; edge = True
        gun = b.weapon == "pistol"
        stat = b.flow if gun else b.force
        engaged = any(h.engaged_with is b for h in self.up())
        smoke = gun and self.smoke_until >= self.round
        adv = net_adv(-1 if (gun and engaged) else 0, -1 if (gun and (self.rules.dark or smoke)) else 0, -1 if b.dis_next else 0)
        b.dis_next = False
        jab = b.tased; b.tased = False
        imp, m, dice, tot = self.d.roll(stat - (2 if jab else 0), t.guard, adv, edge)
        if jab and imp: imp = 1
        if jab: self.log(f"   ({b.name} was tased: only a Jab)")
        self.log(f" {b.name} -> {t.name} {dice} = {tot} vs {t.guard}: {'MISS' if imp==0 else 'Impact '+str(imp)}")
        if imp:
            self.hurt(t, harm_to_hero(t, imp, self.rules, gun=gun))
            self.on_hurt(t, b)
            if (self.rules.spite_fraying and self.rules.villain_stress and t.trait == "Spite" and t.stress >= 4
                    and getattr(b, "spite_round", 0) != self.round):
                b.spite_round = self.round; self.stress_boss(t, b, 1)
        else:
            self.on_missed(t)

    def redirect(self, t):
        """Protector Interpose / Stand Your Ground."""
        for p in self.up():
            if p.arch == "Protector" and p is not t and (p.stand_ground or (t.wounded and not p.wounded)):
                self.log(f"   {p.name} interposes")
                self.arch_drive(p, "Protector: interpose")
                return p
        return t

    def on_hurt(self, h, src):
        if h.down: return
        self.arch_drive_if(h, "hurt")
        if h.arch == "Protector" and self.rules.protector_any: self.arch_drive(h, "Protector: drew the attack")
        if not h.trait_drive_used and h.trait in ("Spite", "Vengeance", "Mercy"):
            h.trait_drive_used = True; gain_drive(h, 1, h.trait, self.log)

    def on_missed(self, h):
        if h.arch == "Protector": self.arch_drive(h, "Protector: attack missed")
        if "opportunist" in h.flairs and not h.opportunist_used:
            h.opportunist_used = True; gain_drive(h, 1, "Opportunist", self.log)

    # -- loop
    def run(self):
        while not self.done() and self.round < self.rules.max_rounds:
            self.round += 1
            self.log(f"--- Round {self.round}")
            heroes = list(self.heroes)
            foes = self.foes()
            live = self.live_bosses()
            alone = not self.groups and len(self.bosses) == 1
            def turns(b):
                if b.role == "lieutenant": return 1
                return self.rules.boss_actions or (len(self.heroes) if alone else -(-len(self.heroes) // 2))  # alone: one turn per hero
            if len(live) == 1:
                b = live[0]; k = turns(b)
                if k > 1:
                    foes = [f for f in foes if f is not b]
                    # spread the boss's turns through the round
                    for n in range(k): foes.insert(min(len(foes), n * 2), b)
            elif live:
                # several named enemies: take their turns in rotation, spread through the round
                left = {id(b): turns(b) for b in live}
                order = []
                while any(left.values()):
                    for b in live:
                        if left[id(b)]: order.append(b); left[id(b)] -= 1
                foes = [f for f in foes if not isinstance(f, Boss)]
                for n, b in enumerate(order): foes.insert(min(len(foes), n * 2), b)
            i = j = 0
            while i < len(heroes) or j < len(foes):
                if i < len(heroes):
                    self.hero_turn(heroes[i]); i += 1
                    if self.done(): break
                if j < len(foes):
                    f = foes[j]; j += 1
                    if getattr(f, "out", False): continue
                    if isinstance(f, Mooks): self.mook_turn(f)
                    else: self.boss_turn(f)
                    if self.done(): break
            # clocks tick last
            if (self.rules.hostage and not self.done() and not self.clock_stopped
                    and self.clock_skip != self.round and self.clock < self.rules.hostage):
                self.clock += 1; self.log(f" Hostage clock {self.clock} of {self.rules.hostage}")
                if self.clock == self.rules.hostage:
                    self.log(" The clock fills: every hero takes 2 Stress")
                    for h in self.up(): add_stress(h, 2)
        win = bool(self.up()) and (not self.foes() or self.obj_won)
        return {"win": win, "rounds": self.round, "by_objective": self.obj_won, "clock_full": bool(self.rules.hostage) and self.clock >= self.rules.hostage,
                "any_down": any(h.stats["downs"] for h in self.heroes),
                "any_dying": any(h.dying for h in self.heroes),
                "heroes": {h.key: dict(h.stats) for h in self.heroes}}

# ---------------------------------------------------------------- batch
def batch(party_keys, scenario, rules, runs, seed):
    dice = Dice(seed)
    res = []
    for _ in range(runs):
        H = make_heroes(rules)
        party = [H[k] for k in party_keys]
        res.append(Fight(party, scenario, rules, dice).run())
    n = len(res)
    out = {
        "party": ",".join(party_keys), "scenario": scenario,
        "win%": 100 * sum(r["win"] for r in res) / n,
        "rounds": statistics.mean(r["rounds"] for r in res),
        "anyDown%": 100 * sum(r["any_down"] for r in res) / n,
        "dying%": 100 * sum(r["any_dying"] for r in res) / n,
        "objective%": 100 * sum(r["by_objective"] for r in res) / n,
        "clockFull%": 100 * sum(r["clock_full"] for r in res) / n,
    }
    per = {}
    for k in party_keys:
        hs = [r["heroes"][k] for r in res]
        per[k] = {
            "harm": statistics.mean(x["harm_taken"] for x in hs),
            "down%": 100 * sum(1 for x in hs if x["downs"]) / n,
            "earned": statistics.mean(x["drive_earned"] for x in hs),
            "spent": statistics.mean(x["drive_spent"] for x in hs),
            "sigs": statistics.mean(x["sigs"] for x in hs),
            "hit%": 100 * (1 - sum(x["misses"] for x in hs) / max(1, sum(x["rolls"] for x in hs))),
            "stress": statistics.mean(x["max_stress"] for x in hs),
            "fraying%": 100 * sum(1 for x in hs if x["max_stress"] >= 4) / n,
            "break%": 100 * sum(1 for x in hs if x["breaks"]) / n,
        }
    out["per"] = per
    return out

def print_result(o, detail=True):
    print(f"{o['party']:<28} {o['scenario']:<8} win {o['win%']:5.1f}%  rounds {o['rounds']:4.1f}  "
          f"any hero Down {o['anyDown%']:5.1f}%  Dying {o['dying%']:4.1f}%"
          + (f"  by Objective {o['objective%']:5.1f}%" if o.get('objective%') else ""))
    if detail:
        print(f"   {'hero':<10}{'Harm':>6}{'Down%':>7}{'hit%':>6}{'Drive+':>8}{'Drive-':>8}{'Sigs':>6}{'Stress':>8}{'Fray%':>7}{'Brk%':>6}")
        for k, p in o["per"].items():
            print(f"   {k:<10}{p['harm']:6.2f}{p['down%']:7.1f}{p['hit%']:6.0f}{p['earned']:8.2f}"
                  f"{p['spent']:8.2f}{p['sigs']:6.2f}{p['stress']:8.2f}{p['fraying%']:7.1f}{p['break%']:6.1f}")

# ---------------------------------------------------------------- run_encounter (app entry point)
# Builds heroes and enemies from a plain dict, runs the fights and returns a plain
# dict. Used by the app's Encounter lab (Pyodide) and by --config. It only builds
# combatants; the fight itself is the same Fight class the command line uses.
_HERO_STATE = {"harm", "stress", "drive"}
_HERO_FIELDS = {f.name for f in fields(Hero)} - {"stats"}
_HERO_EXTRA = {"kit", "not_simulated"}
_BOSS_FIELDS = {"name", "force", "flow", "focus", "presence", "harm_max", "toughness_v", "drive", "weapon", "role"}
_MOOK_FIELDS = {"name", "count", "attack", "guard", "gunner", "harm_each"}
_WEAPONS = {"unarmed", "light", "heavy", "pistol", "knife"}

def _check_keys(what, d, allowed):
    extra = set(d) - allowed
    if extra: raise ValueError(f"{what}: unknown field(s) {', '.join(sorted(extra))}")

def _hero_from(rec):
    _check_keys(f"hero {rec.get('key', '?')}", rec, _HERO_FIELDS | _HERO_EXTRA)
    kw = {k: v for k, v in rec.items() if k in _HERO_FIELDS}
    kw["flairs"] = tuple(kw.get("flairs", ()))
    if kw.get("weapon", "unarmed") not in _WEAPONS: raise ValueError(f"hero {rec['key']}: weapon {kw['weapon']!r}")
    # Kit Armor is "Toughness 1 against guns for the Night" (rules.md): the same as
    # armor_guns, since nothing in the simulator attacks heroes with blades.
    if "armor" in rec.get("kit", ()): kw["armor_guns"] = max(kw.get("armor_guns", 0), 1)
    return Hero(**kw)

def _boss_from(rec, rules):
    _check_keys("villain", rec, _BOSS_FIELDS)
    if rec.get("weapon", "unarmed") not in _WEAPONS: raise ValueError(f"villain weapon {rec['weapon']!r}")
    if rec.get("role", "villain") not in ("villain", "lieutenant"): raise ValueError(f"villain role {rec['role']!r}")
    b = Boss(**rec)
    if rules.boss_harm: b.harm_max = rules.boss_harm
    b.defbonus = rules.boss_def
    return b

def _mooks_from(rec, rules):
    _check_keys(f"mook group {rec.get('name', '?')}", rec, _MOOK_FIELDS)
    kw = dict(rec); kw.setdefault("guard", rules.mook_guard)
    g = Mooks(**kw); g.start = g.count
    return g

def _rules_from_dict(over):
    r = Rules()
    known = {f.name for f in fields(Rules)}
    _check_keys("rules", over, known)
    for k, v in over.items(): setattr(r, k, v)
    return r

def run_encounter(config: dict, on_progress=None) -> dict:
    """Run one encounter many times. See SPEC.md "Encounter simulator" for the shapes.
    on_progress(done, runs), if given, is called about 20 times (the app's progress bar)."""
    _check_keys("config", config, {"runs", "seed", "heroes", "villain", "villains", "mook_groups", "rules"})
    rules = _rules_from_dict(config.get("rules") or {})
    runs = int(config.get("runs", 1000)); seed = config.get("seed")
    recs = config.get("heroes") or []
    if not recs: raise ValueError("config has no heroes")
    keys = [r["key"] for r in recs]
    if len(set(keys)) != len(keys): raise ValueError("hero keys must be unique")
    # Named enemies: "villains" (a list, each with a role) and/or the older single "villain".
    villains = ([config["villain"]] if config.get("villain") else []) + list(config.get("villains") or [])
    mooks = config.get("mook_groups") or []
    if not villains and not mooks: raise ValueError("config has no enemies")
    # Specialist Kit picks are a Rules field in the simulator (one list for the party).
    spec_kit = next((r.get("kit") for r in recs if r.get("arch") == "Specialist" and r.get("kit")), None)
    if spec_kit and "kit_items" not in (config.get("rules") or {}):
        rules.kit_items = ",".join(k for k in spec_kit if k != "armor")
    for r in recs: _hero_from(r)   # validate once up front
    for v in villains: _boss_from(v, rules)
    for m in mooks: _mooks_from(m, rules)

    dice = Dice(seed)
    res = []
    step = max(1, runs // 20)
    for i in range(runs):
        if on_progress and i % step == 0: on_progress(i, runs)
        party = [_hero_from(r) for r in recs]
        f = Fight(party, "custom", rules, dice)   # "custom": Fight adds no enemies of its own
        f.groups = [_mooks_from(m, rules) for m in mooks]
        f.bosses = [_boss_from(v, rules) for v in villains]
        res.append(f.run())

    n = len(res)
    r1 = lambda x: round(x, 1); r2 = lambda x: round(x, 2)
    heroes = {}
    for k in keys:
        hs = [r["heroes"][k] for r in res]
        heroes[k] = {
            "down_pct": r1(100 * sum(1 for x in hs if x["downs"]) / n),
            "harm": r2(statistics.mean(x["harm_taken"] for x in hs)),
            "hit_pct": r1(100 * (1 - sum(x["misses"] for x in hs) / max(1, sum(x["rolls"] for x in hs)))),
            "stress": r2(statistics.mean(x["max_stress"] for x in hs)),
            "fraying_pct": r1(100 * sum(1 for x in hs if x["max_stress"] >= 4) / n),
            "break_pct": r1(100 * sum(1 for x in hs if x["breaks"]) / n),
            "sigs": r2(statistics.mean(x["sigs"] for x in hs)),
            "drive_earned": r2(statistics.mean(x["drive_earned"] for x in hs)),
            "drive_spent": r2(statistics.mean(x["drive_spent"] for x in hs)),
        }
    not_sim = []
    for r in recs:
        for line in r.get("not_simulated", []):
            if line not in not_sim: not_sim.append(line)
        if r.get("arch") != "Specialist":
            for item in r.get("kit", []):
                if item != "armor":
                    line = f"{r.get('name', r['key'])}: {item} (only a Specialist's Kit is simulated)"
                    if line not in not_sim: not_sim.append(line)
    return {
        "win_pct": r1(100 * sum(r["win"] for r in res) / n),
        "rounds": r2(statistics.mean(r["rounds"] for r in res)),
        "any_down_pct": r1(100 * sum(r["any_down"] for r in res) / n),
        "dying_pct": r1(100 * sum(r["any_dying"] for r in res) / n),
        "heroes": heroes,
        "not_simulated": not_sim,
        "runs": n, "seed": seed, "sim_version": SIM_VERSION,
        **({"objective_pct": r1(100 * sum(r["by_objective"] for r in res) / n)} if rules.objective else {}),
    }

def rules_from(args, extra=None):
    r = Rules(sig_cost=args.sig_cost, stress_on_miss=args.stress_on_miss, graze=not args.no_graze,
              mook_cap=not args.no_mook_cap, second_wind=not args.no_second_wind, gear=not args.no_gear,
              boss_harm=args.boss_harm, dark=args.dark, mook_guard=args.mook_guard,
              spill=args.spill, boss_actions=args.boss_actions, boss_def=args.boss_def,
              gang_per_hero=not args.fixed_gang, groups=args.groups,
              down_stress=not args.no_down_stress, villain_presence=not args.no_villain_presence,
              strange_stress=not args.no_strange_stress, invuln_overflow=not args.no_invuln_overflow,
              presence_free=not args.threat_replaces_attack, heal_cost=args.heal_cost, heal_calm=args.heal_calm_only,
              bruisers=args.bruisers, bruisers_extra=args.bruisers_extra, bruiser_size=args.bruiser_size, objective=args.objective, obj_per_round=args.obj_per_round, hostage=args.hostage, grit=not args.no_grit, light_jab=not args.no_light_jab,
              villain_stress=not args.no_villain_stress, new_weapons=not args.old_weapons)
    if extra:
        k, _, v = extra.partition("=")
        k = k.replace("-", "_")
        if k == "no_graze": r.graze = False
        elif k == "no_gear": r.gear = False
        elif k == "no_mook_cap": r.mook_cap = False
        elif k == "spill": r.spill = v
        elif k == "fixed_gang": r.gang_per_hero = False
        elif k.startswith("no_") and hasattr(r, k[3:]): setattr(r, k[3:], False)
        else:
            cur = getattr(r, k)
            setattr(r, k, True if v == "" else type(cur)(int(v)) if cur is not None else int(v))
    return r

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--party", default="rook,nightjar,ledger")
    ap.add_argument("--scenario", default="cannery", choices=["gang", "boss", "cannery", "gunboss"])
    ap.add_argument("--all-combos", action="store_true", help="every 3-hero party from the 5 samples")
    ap.add_argument("--heroes", default="bulwark,rook,nightjar,patchwork,ledger",
                    help="pool for --all-combos (add jessica, luke, logan for strange-power tests, marshal for the Leader)")
    ap.add_argument("--runs", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--log", type=int, default=0, help="print N fights roll by roll instead of stats")
    ap.add_argument("--sig-cost", type=int, default=3)
    ap.add_argument("--stress-on-miss", action="store_true")
    ap.add_argument("--no-graze", action="store_true")
    ap.add_argument("--no-mook-cap", action="store_true")
    ap.add_argument("--no-second-wind", action="store_true")
    ap.add_argument("--no-gear", action="store_true")
    ap.add_argument("--boss-harm", type=int, default=None)
    ap.add_argument("--dark", action="store_true")
    ap.add_argument("--mook-guard", type=int, default=13)
    ap.add_argument("--spill", default="reduced", choices=["full", "reduced", "none"])
    ap.add_argument("--boss-actions", type=int, default=0, help="0 = one per two heroes, rounded up")
    ap.add_argument("--boss-def", type=int, default=0)
    ap.add_argument("--groups", type=int, default=0, help="force a number of mook groups")
    ap.add_argument("--no-down-stress", action="store_true")
    ap.add_argument("--threat-replaces-attack", action="store_true", help="old behavior: villain threats use up their attack")
    ap.add_argument("--heal-cost", action="store_true", help="every Healing Factor heal costs 1 Stress")
    ap.add_argument("--heal-calm-only", action="store_true", help="old rule: Healing Factor only heals if nobody hurt you since your last turn")
    ap.add_argument("--no-villain-presence", action="store_true")
    ap.add_argument("--no-strange-stress", action="store_true")
    ap.add_argument("--no-invuln-overflow", action="store_true")
    ap.add_argument("--fixed-gang", action="store_true", help="always 2 mook groups instead of one per hero")
    ap.add_argument("--objective", type=int, default=0, help="Objective steps (3 = the Cannery's Free the hostage)")
    ap.add_argument("--bruisers", type=int, default=0, help="swap N mook groups for a bruiser group (2 Harm each)")
    ap.add_argument("--bruisers-extra", type=int, default=0, help="add N bruiser groups on top of the usual gang")
    ap.add_argument("--bruiser-size", type=int, default=3, help="bruisers in a group (default 3)")
    ap.add_argument("--obj-per-round", type=int, default=0, help="at most N Objective steps finished per round (0 = no limit)")
    ap.add_argument("--hostage", type=int, default=0, help="a clock that ticks each round; full = 2 Stress to every hero")
    ap.add_argument("--no-grit", action="store_true")
    ap.add_argument("--no-light-jab", action="store_true")
    ap.add_argument("--no-villain-stress", action="store_true")
    ap.add_argument("--old-weapons", action="store_true")
    ap.add_argument("--config", default=None,
                    help="run an encounter from a JSON file (the app's format) and print the result as JSON; "
                         "the file's runs and seed are used, other flags are ignored")
    ap.add_argument("--compare", action="append", default=[],
                    help="rerun with one rule changed, e.g. sig-cost=2, stress-on-miss, no-gear")
    args = ap.parse_args()
    if args.config:
        with open(args.config, encoding="utf-8") as f:
            print(json.dumps(run_encounter(json.load(f)), indent=2))
        return
    party = args.party.split(",")
    if args.log:
        dice = Dice(args.seed)
        for i in range(args.log):
            H = make_heroes(rules_from(args))
            r = Fight([H[k] for k in party], args.scenario, rules_from(args), dice, log=True).run()
            print(f"=== {'HEROES WIN' if r['win'] else 'HEROES LOSE'} in {r['rounds']} rounds\n")
        return
    combos = list(itertools.combinations(args.heroes.split(","), 3)) \
        if args.all_combos else [tuple(party)]
    print(f"== Baseline rules (runs={args.runs})")
    for c in combos:
        print_result(batch(list(c), args.scenario, rules_from(args), args.runs, args.seed), detail=not args.all_combos)
    for ch in args.compare:
        print(f"\n== Changed: {ch}")
        for c in combos:
            print_result(batch(list(c), args.scenario, rules_from(args, ch), args.runs, args.seed), detail=not args.all_combos)

if __name__ == "__main__":
    main()

# LIMITS (what this does not model):
# - Zones are abstracted: everyone can reach everyone; engagement only matters for
#   guns-in-melee Disadvantage and who the mooks shoot at.
# - Hero tactics are simple fixed policies (gunners first, Detective Reads the boss),
#   not the best play. Treat results as comparisons between rule versions, not absolutes.
# - Kit is modeled for the Specialist (Taser, Flashbang, Smoke, Armor) with simple
#   priorities; Grapple, Tracker and Long gun are not. Powers beyond Toughness, Shadow
#   Manipulation, Mighty, Invulnerability and Healing Factor, and most Flairs, are not.
# - Several named enemies: villains get the usual villain turns, lieutenants one a round.
#   Hero tactics still focus the first one standing.
# - Already Broken is test-only (--broken rule field), not a sample hero.
# - Objectives (--objective N) are simple: non-fighters work the steps, the villain goes after
#   whoever is working them, and a hero has to break away before working a step. Zones are still
#   abstract, so "no step while an enemy is in that zone" is only the engagement rule.
# - Leader: Rally goes to the best fighter, On My Signal gives them a turn, Carry the weight takes
#   one villain threat. Trait perks other than Spite's Fraying Stress are not modeled.
# - GM moves on a Miss, Scheme and Dawn Stress, and anything outside one fight are not modeled.
