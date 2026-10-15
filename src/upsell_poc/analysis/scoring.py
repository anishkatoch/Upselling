"""Deterministic, explainable scores computed from the LLM's upsell findings."""

from __future__ import annotations

from upsell_poc.schemas import ConversationResult, SalespersonMetrics, Segment, UpsellAnalysis


def effort_score(upsell: UpsellAnalysis, salesperson: str | None = None) -> float:
    """0-10. Attempts (max 6) + technique variety (max 2) + persistence (1) + objection handling (1)."""
    attempts = [a for a in upsell.upsell_attempts if salesperson is None or a.salesperson == salesperson]
    if not attempts:
        return 0.0
    score = min(len(attempts), 4) * 1.5
    score += min(len({a.technique for a in attempts}), 3) * (2 / 3)
    score += 1.0 if any(a.after_customer_rejection for a in attempts) else 0.0
    score += 1.0 if any(a.handled_objection for a in attempts) else 0.0
    return round(min(score, 10.0), 1)


def salesperson_metrics(conversations: list[ConversationResult], segments: list[Segment]) -> list[SalespersonMetrics]:
    by_id = {s.id: s for s in segments}
    names = sorted({sp for c in conversations if c.is_sales_interaction for sp in c.salespeople})
    metrics: list[SalespersonMetrics] = []
    for name in names:
        convs = [c for c in conversations if c.is_sales_interaction and name in c.salespeople]
        attempts = [a for c in convs if c.upsell for a in c.upsell.upsell_attempts if a.salesperson == name]
        with_upsell = [c for c in convs if c.upsell and any(a.salesperson == name for a in c.upsell.upsell_attempts)]

        talk = sum(
            s.duration for s in segments if s.speaker == name and any(c.start <= s.start <= c.end for c in convs)
        )
        upsell_talk = sum(by_id[i].duration for i in {a.segment_id for a in attempts} if i in by_id)
        decided = [a for a in attempts if a.customer_response in ("accepted", "rejected")]

        metrics.append(
            SalespersonMetrics(
                speaker=name,
                conversations=len(convs),
                conversations_with_upsell=len(with_upsell),
                upsell_rate=round(len(with_upsell) / len(convs), 3) if convs else 0.0,
                attempts_total=len(attempts),
                attempts_per_conversation=round(len(attempts) / len(convs), 2) if convs else 0.0,
                avg_effort_score=round(sum(effort_score(c.upsell, name) for c in convs if c.upsell) / len(convs), 1)
                if convs
                else 0.0,
                upsell_talk_time_share=round(upsell_talk / talk, 3) if talk else 0.0,
                acceptance_rate=round(sum(a.customer_response == "accepted" for a in decided) / len(decided), 3)
                if decided
                else None,
                pushy_conversations=sum(1 for c in convs if c.upsell and c.upsell.pushy_upsell),
                techniques_used=sorted({a.technique for a in attempts}),
            )
        )
    return metrics
