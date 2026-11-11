"""pytest for run_encounter (SPEC.md "Encounter simulator", M5).

Run from the repo root:  python -m pytest sim/tests -q
"""
import copy, json, subprocess, sys
from pathlib import Path

import pytest

SIM_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIM_DIR))
import street_level_sim as S  # noqa: E402

CHECK = json.loads((SIM_DIR / "tests" / "encounter_check.json").read_text(encoding="utf-8"))


def cfg(**over):
    c = copy.deepcopy(CHECK)
    c.update(over)
    return c


def test_spec_check_wins_95_to_99():
    """Rook, Nightjar and the Ledger vs the Butcher and one Saints group, 2,000 runs."""
    r = S.run_encounter(cfg())
    assert r["runs"] == 2000
    assert 95 <= r["win_pct"] <= 99, r["win_pct"]
    assert set(r["heroes"]) == {"rook", "nightjar", "ledger"}
    assert r["sim_version"] == S.SIM_VERSION


def test_same_numbers_as_the_old_command_line_path():
    """run_encounter only builds combatants: with the same seed it matches batch() exactly."""
    r = S.run_encounter(cfg(runs=500, seed=11))
    b = S.batch(["rook", "nightjar", "ledger"], "cannery", S.Rules(), 500, 11)
    assert r["win_pct"] == round(b["win%"], 1)
    assert r["any_down_pct"] == round(b["anyDown%"], 1)
    assert r["rounds"] == round(b["rounds"], 2)
    for k in ("rook", "nightjar", "ledger"):
        assert r["heroes"][k]["down_pct"] == round(b["per"][k]["down%"], 1)
        assert r["heroes"][k]["harm"] == round(b["per"][k]["harm"], 2)


def test_result_shape():
    r = S.run_encounter(cfg(runs=50))
    assert set(r) == {"win_pct", "rounds", "any_down_pct", "dying_pct", "heroes", "not_simulated",
                      "runs", "seed", "sim_version"}
    assert set(r["heroes"]["rook"]) == {"down_pct", "harm", "hit_pct", "stress", "fraying_pct",
                                        "break_pct", "sigs", "drive_earned", "drive_spent"}
    json.dumps(r)  # plain data only


def test_seed_repeats():
    assert S.run_encounter(cfg(runs=200, seed=3)) == S.run_encounter(cfg(runs=200, seed=3))


def test_unmodeled_power_is_listed():
    c = cfg(runs=20)
    c["heroes"][1]["not_simulated"] = ["Nightjar: Weather Control"]
    c["heroes"][2]["not_simulated"] = ["The Ledger: Grapple line", "Nightjar: Weather Control"]
    assert S.run_encounter(c)["not_simulated"] == ["Nightjar: Weather Control", "The Ledger: Grapple line"]


def test_non_specialist_kit_is_listed():
    c = cfg(runs=20)
    c["heroes"][0]["kit"] = ["taser"]
    assert S.run_encounter(c)["not_simulated"] == ["Rook: taser (only a Specialist's Kit is simulated)"]


def test_starting_state_matters():
    """A party that starts beaten up does worse than a fresh one."""
    hurt = cfg(runs=1000)
    for h in hurt["heroes"]:
        h["harm"] = h["boxes"] - 1; h["stress"] = 5; h["drive"] = 0
    assert S.run_encounter(hurt)["win_pct"] < S.run_encounter(cfg(runs=1000))["win_pct"] - 10


def test_rules_override():
    dark = S.run_encounter(cfg(runs=300, rules={"dark": True}))
    assert dark["runs"] == 300
    with pytest.raises(ValueError, match="unknown"):
        S.run_encounter(cfg(rules={"darkk": True}))


def test_unknown_fields_are_errors():
    c = cfg(); c["heroes"][0]["forcee"] = 3
    with pytest.raises(ValueError, match="forcee"):
        S.run_encounter(c)
    c = cfg(); c["villain"]["armor"] = 1
    with pytest.raises(ValueError, match="armor"):
        S.run_encounter(c)


def test_mooks_only_and_villain_only():
    gang = cfg(runs=200, villain=None, mook_groups=[{"name": "Saints", "count": 3, "attack": 2, "guard": 13, "gunner": True}] * 3)
    assert 0 <= S.run_encounter(gang)["win_pct"] <= 100
    alone = cfg(runs=200, mook_groups=[])
    assert 0 <= S.run_encounter(alone)["win_pct"] <= 100
    with pytest.raises(ValueError, match="no enemies"):
        S.run_encounter(cfg(villain=None, mook_groups=[]))


# ---- Toughness (rules.md table: armor works against guns, natural Force Toughness does not)

def hero(**kw):
    base = dict(key="x", name="X", arch="Brawler", trait="Spite", force=0, flow=0, focus=0, presence=0)
    base.update(kw)
    return S.Hero(**base)


@pytest.mark.parametrize("kw, blunt, blade, gun", [
    (dict(force=3), 1, 1, 0),             # Force +3 or higher
    (dict(armor_guns=1), 0, 1, 1),        # Kevlar vest
    (dict(armor_all=1), 1, 1, 1),         # Tactical armor, Armored power
    (dict(tough_blunt=1), 1, 0, 0),       # Toughness (street power)
    (dict(force=4, armor_guns=1), 1, 1, 1),  # highest row, never added together
])
def test_toughness_table(kw, blunt, blade, gun):
    h = hero(**kw)
    assert (h.toughness(False, False), h.toughness(False, True), h.toughness(True, False)) == (blunt, blade, gun)


def test_kit_armor_counts_against_guns():
    c = cfg(runs=1)
    rec = dict(c["heroes"][2], key="pw", name="Patchwork", arch="Specialist", armor_guns=0, kit=["armor", "smoke"])
    h = S._hero_from(rec)
    assert h.toughness(True, False) == 1 and h.toughness(False, False) == 0


def test_cli_config_flag(tmp_path):
    p = tmp_path / "enc.json"
    p.write_text(json.dumps(cfg(runs=300, seed=5)), encoding="utf-8")
    out = subprocess.run([sys.executable, str(SIM_DIR / "street_level_sim.py"), "--config", str(p)],
                         capture_output=True, text=True, check=True).stdout
    assert json.loads(out) == S.run_encounter(cfg(runs=300, seed=5))


def test_cli_still_runs_scenarios():
    out = subprocess.run([sys.executable, str(SIM_DIR / "street_level_sim.py"), "--runs", "50", "--seed", "1"],
                         capture_output=True, text=True, check=True).stdout
    assert "cannery" in out and "win" in out


def test_expected_file_is_current():
    """encounter_check.expected.json is what the browser self-check compares against.
    If this fails after a sim change, regenerate it:
      python sim/street_level_sim.py --config sim/tests/encounter_check.json > sim/tests/encounter_check.expected.json"""
    expected = json.loads((SIM_DIR / "tests" / "encounter_check.expected.json").read_text(encoding="utf-8"))
    assert S.run_encounter(cfg()) == expected


def test_progress_callback_does_not_change_results():
    seen = []
    with_cb = S.run_encounter(cfg(runs=200, seed=9), on_progress=lambda d, n: seen.append((d, n)))
    assert with_cb == S.run_encounter(cfg(runs=200, seed=9))
    assert seen[0] == (0, 200) and len(seen) == 20


# ---- several named enemies (Stephen, Nov 11: villains get the usual turns, lieutenants one a round)

LT = {"name": "Lieutenant", "force": 2, "flow": 1, "focus": 0, "presence": 1, "harm_max": 5,
      "toughness_v": 0, "drive": 2, "weapon": "unarmed", "role": "lieutenant"}


def test_villain_and_villains_list_are_the_same():
    one = cfg(runs=300, seed=4)
    listed = cfg(runs=300, seed=4); listed["villains"] = [listed.pop("villain")]
    assert S.run_encounter(one) == S.run_encounter(listed)


def first_round_turns(heroes, villains, mooks):
    """Who gets a turn in round 1 (no dice rolled; turns are only counted)."""
    rules = S.Rules()
    f = S.Fight([S._hero_from(h) for h in heroes], "custom", rules, S.Dice(1))
    f.bosses = [S._boss_from(v, rules) for v in villains]
    f.groups = [S._mooks_from(m, rules) for m in mooks]
    seen = []
    f.hero_turn = lambda h: None
    f.mook_turn = lambda g: seen.append(g.name)
    f.boss_turn = lambda b=None: seen.append(b.name)
    f.rules.max_rounds = 1
    f.run()
    return seen


def test_turns_per_role():
    four = CHECK["heroes"] + [dict(CHECK["heroes"][0], key="rook2")]
    butcher = CHECK["villain"]; saints = CHECK["mook_groups"]
    # one villain with mooks, 4 heroes: 2 turns (unchanged rule)
    assert first_round_turns(four, [butcher], saints).count("The Butcher") == 2
    # one villain alone, 4 heroes: one per hero
    assert first_round_turns(four, [butcher], []).count("The Butcher") == 4
    # a lieutenant always gets 1
    assert first_round_turns(four, [LT], saints).count("Lieutenant") == 1
    assert first_round_turns(four, [LT], []).count("Lieutenant") == 1
    # villain + lieutenant: 2 + 1; two named enemies is never "alone"
    t = first_round_turns(four, [butcher, LT], [])
    assert t.count("The Butcher") == 2 and t.count("Lieutenant") == 1
    # two villains: each gets the usual 2
    t = first_round_turns(four, [butcher, dict(butcher, name="Voss")], saints)
    assert t.count("The Butcher") == 2 and t.count("Voss") == 2


def test_a_second_named_enemy_makes_it_harder():
    base = S.run_encounter(cfg(runs=1500, seed=8))
    more = cfg(runs=1500, seed=8); more["villains"] = [LT]
    assert S.run_encounter(more)["win_pct"] < base["win_pct"]


def test_bad_role():
    c = cfg(); c["villains"] = [dict(LT, role="boss")]
    with pytest.raises(ValueError, match="role"):
        S.run_encounter(c)
