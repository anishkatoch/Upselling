from upsell_poc.pipeline import apply_speaker_edits
from upsell_poc.schemas import Segment, Transcript


def _t() -> Transcript:
    segs = [Segment(id=i, speaker="A", start=i, end=i + 1, text=str(i)) for i in range(3)]
    return Transcript(duration=3, segments=segs, provider="x")


def test_moves_relabel_lines_and_add_role():
    t, roles, titles = apply_speaker_edits(
        _t(), {"A": "salesperson"}, {"A": "Seller"}, {"moves": {"1": "Speaker 2"}, "roles": {"Speaker 2": "customer"}}
    )
    assert [s.speaker for s in t.segments] == ["A", "Speaker 2", "A"]
    assert roles == {"A": "salesperson", "Speaker 2": "customer"}
    assert "Speaker 2" in titles


def test_no_edits_is_identity_and_emptied_label_is_dropped():
    t0 = _t()
    assert apply_speaker_edits(t0, {"A": "salesperson"}, {}, {})[0] is t0
    t, roles, _ = apply_speaker_edits(t0, {"A": "salesperson"}, {}, {"moves": {"0": "B", "1": "B", "2": "B"}, "roles": {"B": "customer"}})
    assert roles == {"B": "customer"}


def test_repair_speakers_keeps_only_real_changes():
    from upsell_poc.analysis.structure import repair_speakers
    from upsell_poc.schemas import SpeakerFix, SpeakerRepair, Transcript, Segment

    class Chain:
        def generate(self, **kw):
            fixes = [
                SpeakerFix(segment_id=1, speaker="Speaker 2", role="customer", title="Buyer"),
                SpeakerFix(segment_id=0, speaker="A", role="salesperson", title=""),  # no change
                SpeakerFix(segment_id=99, speaker="B", role="customer", title=""),  # unknown id
            ]
            return SpeakerRepair(fixes=fixes), None

    segs = [Segment(id=i, speaker="A", start=i, end=i + 1, text="x") for i in range(4)]
    t = Transcript(duration=4, segments=segs, provider="p", model="m", chunks=1)
    out = repair_speakers(Chain(), t, {"A": "salesperson"})
    assert out == {"moves": {1: "Speaker 2"}, "roles": {"Speaker 2": "customer"}, "titles": {"Speaker 2": "Buyer"}}
