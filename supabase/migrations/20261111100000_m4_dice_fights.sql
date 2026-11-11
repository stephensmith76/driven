-- M4: dice and fights.
-- The roller checks dice in the page, but the database is the one that keeps the
-- log honest: every die is 1 to 10 and a roll has two or three dice.
alter table public.rolls
  add constraint rolls_dice_range check (dice <@ array[1,2,3,4,5,6,7,8,9,10]),
  add constraint rolls_dice_count check (cardinality(dice) between 0 and 3),
  add constraint rolls_kept_count check (cardinality(kept) <= 2);
