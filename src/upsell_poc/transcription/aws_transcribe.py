"""Amazon Transcribe batch job: whole file (up to 4 h), speaker labels, en-IN/hi-IN."""

from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any, cast

from upsell_poc import audio
from upsell_poc.config import Settings, TranscriberConfig
from upsell_poc.schemas import Segment, Transcript
from upsell_poc.transcription.base import merge_adjacent

log = logging.getLogger(__name__)

PAUSE_SPLIT_S = 1.5


class AWSTranscribeTranscriber:
    def __init__(self, cfg: TranscriberConfig, settings: Settings) -> None:
        import boto3

        self.cfg = cfg
        self.model = "amazon-transcribe"
        self.name = "aws:transcribe"
        self.bucket = settings.transcribe_s3_bucket or settings.s3_bucket
        self.prefix = settings.s3_prefix.strip("/")
        self.transcribe_client = boto3.client("transcribe", region_name=settings.aws_region)
        self.s3 = boto3.client("s3", region_name=settings.aws_region)

    def transcribe(self, wav: Path, workdir: Path) -> Transcript:
        if not self.bucket:
            raise RuntimeError("Amazon Transcribe needs S3_BUCKET or TRANSCRIBE_S3_BUCKET")
        duration = audio.probe_duration(wav)
        job_name = f"upsell-{uuid.uuid4().hex[:16]}"
        mp3 = audio.encode_for_asr(wav, workdir / "aws_input.mp3", "64k")
        in_key = f"{self.prefix}/transcribe/in/{job_name}.mp3"
        out_key = f"{self.prefix}/transcribe/out/{job_name}.json"
        self.s3.upload_file(str(mp3), self.bucket, in_key)

        self.transcribe_client.start_transcription_job(
            TranscriptionJobName=job_name,
            Media={"MediaFileUri": f"s3://{self.bucket}/{in_key}"},
            MediaFormat="mp3",
            IdentifyMultipleLanguages=True,
            LanguageOptions=cast(Any, self.cfg.languages),
            OutputBucketName=self.bucket,
            OutputKey=out_key,
            Settings={"ShowSpeakerLabels": True, "MaxSpeakerLabels": self.cfg.max_speakers},
        )
        deadline = time.monotonic() + self.cfg.timeout_minutes * 60
        while True:
            job = self.transcribe_client.get_transcription_job(TranscriptionJobName=job_name)
            status = job["TranscriptionJob"]["TranscriptionJobStatus"]
            if status == "COMPLETED":
                break
            if status == "FAILED":
                raise RuntimeError(job["TranscriptionJob"].get("FailureReason", "transcribe failed"))
            if time.monotonic() > deadline:
                raise TimeoutError(f"transcribe job {job_name} timed out")
            time.sleep(self.cfg.poll_seconds)

        body = self.s3.get_object(Bucket=self.bucket, Key=out_key)["Body"].read()
        segments = parse_transcribe_output(json.loads(body))
        return Transcript(duration=duration, segments=merge_adjacent(segments), provider=self.name, model=self.model)


def parse_transcribe_output(data: dict) -> list[Segment]:
    results = data["results"]
    # Map start time -> speaker for outputs where items lack speaker_label.
    speaker_at: dict[str, str] = {}
    for seg in results.get("speaker_labels", {}).get("segments", []):
        for item in seg.get("items", []):
            speaker_at[item["start_time"]] = item["speaker_label"]

    segments: list[Segment] = []
    current: dict | None = None
    for item in results.get("items", []):
        content = item["alternatives"][0]["content"]
        if item["type"] == "punctuation":
            if current:
                current["text"] += content
            continue
        start, end = float(item["start_time"]), float(item["end_time"])
        speaker = item.get("speaker_label") or speaker_at.get(item["start_time"], "spk_unknown")
        if current and current["speaker"] == speaker and start - current["end"] <= PAUSE_SPLIT_S:
            current["text"] += f" {content}"
            current["end"] = end
        else:
            if current:
                segments.append(Segment(id=len(segments), **current))
            current = {"speaker": speaker, "start": start, "end": end, "text": content}
    if current:
        segments.append(Segment(id=len(segments), **current))
    return segments
