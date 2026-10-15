from __future__ import annotations

from types import SimpleNamespace

from conftest import requires_ffmpeg
from fakes import make_wav

from upsell_poc import audio
from upsell_poc.config import TranscriberConfig
from upsell_poc.schemas import Segment
from upsell_poc.transcription.aws_transcribe import parse_transcribe_output
from upsell_poc.transcription.base import keep_chunk_segments, merge_adjacent
from upsell_poc.transcription.openai_diarize import OpenAIDiarizeTranscriber


def test_single_chunk_for_short_audio():
    chunks = audio.plan_chunks(600, [], chunk_seconds=1200, overlap_seconds=2)
    assert len(chunks) == 1 and chunks[0].end == 600


def test_chunks_cut_at_longest_nearby_silence():
    silences = [(1180.0, 1181.0), (1210.0, 1214.0), (2500.0, 2500.5)]
    chunks = audio.plan_chunks(3600, silences, chunk_seconds=1200, overlap_seconds=2)
    assert chunks[0].keep_to == 1212.0  # midpoint of the longer silence
    assert chunks[1].start == 1210.0  # overlap
    assert chunks[1].keep_from == 1212.0
    # every second is owned by exactly one chunk
    for left, right in zip(chunks, chunks[1:], strict=False):
        assert left.keep_to == right.keep_from
    assert chunks[-1].keep_to > 3600


def test_overlap_dedupe_by_midpoint():
    chunk = audio.Chunk(index=1, start=98, end=200, keep_from=100, keep_to=200)
    segs = [
        Segment(id=0, speaker="A", start=97, end=101, text="dup"),
        Segment(id=1, speaker="A", start=99, end=103, text="keep"),
    ]
    assert [s.text for s in keep_chunk_segments(segs, chunk)] == ["keep"]


def test_merge_adjacent_same_speaker():
    segs = [
        Segment(id=0, speaker="A", start=0, end=1, text="hello"),
        Segment(id=1, speaker="A", start=1.3, end=2, text="sir"),
        Segment(id=2, speaker="B", start=2.1, end=3, text="haan"),
    ]
    merged = merge_adjacent(segs)
    assert [(s.speaker, s.text) for s in merged] == [("A", "hello sir"), ("B", "haan")]
    assert [s.id for s in merged] == [0, 1]


def test_parse_aws_transcribe_output():
    data = {
        "results": {
            "items": [
                {
                    "type": "pronunciation",
                    "start_time": "0.0",
                    "end_time": "0.4",
                    "speaker_label": "spk_0",
                    "alternatives": [{"content": "Namaste"}],
                },
                {"type": "punctuation", "alternatives": [{"content": ","}]},
                {
                    "type": "pronunciation",
                    "start_time": "0.5",
                    "end_time": "0.9",
                    "speaker_label": "spk_0",
                    "alternatives": [{"content": "sir"}],
                },
                {
                    "type": "pronunciation",
                    "start_time": "1.2",
                    "end_time": "1.6",
                    "speaker_label": "spk_1",
                    "alternatives": [{"content": "haan"}],
                },
            ]
        }
    }
    segs = parse_transcribe_output(data)
    assert [(s.speaker, s.text) for s in segs] == [("spk_0", "Namaste, sir"), ("spk_1", "haan")]


class FakeOpenAIAudio:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.audio = SimpleNamespace(transcriptions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append(kwargs)
        n = len(self.calls)
        speaker = "A" if n == 1 else "X"  # later chunk: unknown voice
        return SimpleNamespace(
            segments=[
                SimpleNamespace(speaker=speaker, start=0.5, end=3.5, text=f"chunk {n} first"),
                SimpleNamespace(speaker="B", start=4.0, end=6.0, text=f"chunk {n} second"),
            ]
        )


@requires_ffmpeg
def test_openai_diarize_chunks_and_speaker_refs(tmp_path):
    wav = make_wav(tmp_path / "a.wav", seconds=20)
    client = FakeOpenAIAudio()
    cfg = TranscriberConfig(provider="openai_diarize", chunk_minutes=10 / 60, overlap_seconds=1)
    transcript = OpenAIDiarizeTranscriber(cfg, client=client).transcribe(wav, tmp_path / "work")  # type: ignore[arg-type]

    assert transcript.chunks == len(client.calls) >= 2
    assert client.calls[0]["response_format"] == "diarized_json"
    assert "known_speaker_names" not in client.calls[0]
    later = client.calls[1]
    assert later["known_speaker_names"] == ["A", "B"]
    assert later["known_speaker_references"][0].startswith("data:audio/wav;base64,")
    speakers = set(transcript.speakers)
    assert "A" in speakers and "B" in speakers
    assert any(s.startswith("c1_") for s in speakers)  # unmatched voice in chunk 1 kept separate


@requires_ffmpeg
def test_audio_helpers_create_missing_output_folders(tmp_path):
    wav = make_wav(tmp_path / "a.wav", seconds=4)
    mp3 = audio.encode_for_asr(wav, tmp_path / "new" / "deeper" / "x.mp3", start=0, end=2)
    clip = audio.cut_wav(wav, tmp_path / "other" / "y.wav", 0, 2)
    assert mp3.exists() and clip.exists()
