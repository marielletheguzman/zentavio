-- Attempt spacing (ADR-0030's anti-gaming follow-up).
--
-- ## What this actually defends against, and what it does not
--
-- The answer key never leaves the server, so a taker cannot read it. **They can still learn it by
-- attempting repeatedly**: ten items of four options, taken without limit, gives up the whole key in
-- a handful of sittings. That is the real hole in an unproctored instrument, and spacing does not
-- close it — it makes the cost of closing it time rather than effort, which is worth something and
-- is not a solution.
--
-- Stated on the instrument rather than as a constant, because how long is a judgement about the
-- material: a ten-item recall test and a two-hour practical do not deserve the same cooldown.
--
-- **The honest limit is in `does_not_evidence` already**: unproctored and unattributed. Nothing here
-- changes what a pass claims, and nothing here should be read as making a pass stronger evidence
-- than that sentence says it is.

ALTER TABLE skill_assessments
  ADD COLUMN retry_interval interval NOT NULL DEFAULT '24 hours';

COMMENT ON COLUMN skill_assessments.retry_interval IS
  'How long after an attempt before the same person may start another. Slows key extraction by repetition; does not prevent it.';
