from upsell_poc import romanize
from upsell_poc.romanize import WordMap, WordPair, romanize_document, romanize_obj, romanize_text, romanize_transcript
from upsell_poc.schemas import Segment, Transcript

LOOKUP = {"तीन": "teen", "सौ": "sau", "नहीं": "nahi"}


class FakeChain:
    def __init__(self) -> None:
        self.calls = 0

    def generate(self, *, step, system, user, schema, **kw):
        self.calls += 1
        words = user.splitlines()[1:]
        return WordMap(items=[WordPair(word=w, hinglish="x" + str(i)) for i, w in enumerate(words)]), "fake"


def test_text_becomes_english_letters_and_danda_becomes_a_full_stop():
    assert romanize_text("तीन सौ रुपये नहीं।", {**LOOKUP, "रुपये": "rupaye"}) == "teen sau rupaye nahi."
    assert romanize_text("Plain English stays.", LOOKUP) == "Plain English stays."


def test_nested_documents_keep_their_shape():
    doc = {"a": ["तीन", {"b": "सौ"}], "n": 3, "ok": True}
    assert romanize_obj(doc, LOOKUP) == {"a": ["teen", {"b": "sau"}], "n": 3, "ok": True}


def test_unknown_words_are_looked_up_once_and_remembered(tmp_path, monkeypatch):
    monkeypatch.setattr(romanize, "LOOKUP_FILE", tmp_path / "words.json")
    chain = FakeChain()
    doc = {"q": "ऐऐऐ ओओओ"}  # not in the shipped word list
    first = romanize_document(doc, chain)
    assert first["q"].isascii() and chain.calls == 1
    assert romanize_document(doc, chain) == first and chain.calls == 1  # second time: from the saved lookup


def test_transcript_without_hindi_script_is_untouched_and_needs_no_model():
    t = Transcript(duration=1, segments=[Segment(id=0, start=0, end=1, speaker="A", text="hello sir")], provider="p")
    assert romanize_transcript(t, None) is t


def test_a_failing_model_leaves_the_words_alone_instead_of_failing_the_job(tmp_path, monkeypatch):
    monkeypatch.setattr(romanize, "LOOKUP_FILE", tmp_path / "words.json")

    class Down:
        def generate(self, **kw):
            raise RuntimeError("model unavailable")

    doc = {"q": "ऐऐऐ ओओओ"}
    assert romanize_document(doc, Down()) == doc
