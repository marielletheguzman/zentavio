"""What the gap needs from the outside world.

**Everything arrives in the request.** The requirements, the profile, and the graph edges are all
supplied by the caller rather than read from anywhere, which is what keeps `ai/` free of a
persistent store (ADR-0003) and makes every gap a pure function of its inputs. It is also what
makes the determinism M1b requires testable: same inputs, same gap, with nothing hidden behind a
query.

Nothing here is a claim about a person. A `HeldSkill` is what the profile said, a `RequiredSkill` is
what the track needs, and the arithmetic between them is `compute.py`'s.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class RequiredSkill:
    """One requirement of the target, from `career_skills`.

    ``weight`` is importance for this target, and it comes from knowledge — never from a constant
    in code. A hardcoded weight freezes a market fact at the moment someone typed it
    (``docs/database/entities/skill.md``).

    ``weight`` is ``None`` when the requirement is known but its importance is not. That is listed
    as unweighted rather than defaulted, because a default weight is an invented market fact
    (``docs/features/skill-gap-analysis.md``).
    """

    skill_id: str
    weight: float | None
    #: 'core' | 'supporting' | 'differentiating' | 'peripheral'
    cluster: str
    #: None is global. A market-specific requirement wins over a global one for the same skill.
    market_scope: str | None = None
    #: Where the weight came from, carried through so an item can state why it is a gap.
    basis: str = "curated"
    #: Observations behind the weight, when it was derived from postings.
    support: int | None = None


@dataclass(frozen=True)
class HeldSkill:
    """One skill the profile says the person has.

    ``status`` carries through from the parse because the two are not equal evidence: a skill
    described in a role is not the same claim as one listed under a heading, and collapsing them is
    what lets a padded skills section close a gap it has not closed.
    """

    skill_id: str
    #: 'evidenced' | 'claimed'
    status: str
    #: 'high' | 'medium' | 'low'
    confidence: str = "medium"


@dataclass(frozen=True)
class Edge:
    """One typed, weighted edge of the skill graph.

    Only three types change a gap, and each does something different:

    * ``requires`` orders it — you cannot sensibly start with the thing that needs the other.
    * ``transfers_to`` gives partial credit — competence carries over, ``weight`` says how much.
    * ``subsumes`` collapses it — holding the broader skill covers the narrower one.

    ``adjacent_to`` and ``tooling_of`` are read elsewhere and deliberately ignored here. Adjacency
    is not evidence of competence, and treating it as partial credit would close gaps nobody has
    closed.
    """

    from_skill_id: str
    to_skill_id: str
    edge_type: str
    weight: float
    source_url: str | None = None
    source_tier: int = 3


@dataclass(frozen=True)
class GapRequest:
    """Everything one gap computation reads."""

    target_id: str
    #: 'career' — the only target M1b supports. A posting target reads the same shape from
    #: `job_posting_skills`, which does not exist yet.
    target_kind: str
    requirements: tuple[RequiredSkill, ...] = ()
    held: tuple[HeldSkill, ...] = ()
    edges: tuple[Edge, ...] = ()
    #: The market the gap is scoped to. None asks for the global requirement set.
    market: str | None = None
    #: When the supplied knowledge was current. Recorded on the result so a gap stays reproducible.
    knowledge_as_of: str | None = None
    #: Skills the caller could not resolve — carried through so the answer can say what it did not
    #: know rather than quietly omitting it.
    unresolved: tuple[str, ...] = field(default_factory=tuple)
