"""Object storage for uploads, job status, stage checkpoints and reports.

Local filesystem for development, S3 for AWS (shared between API and worker tasks).
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from typing import Any, Protocol

from upsell_poc.config import Settings, get_settings


class Storage(Protocol):
    def put_file(self, local_path: Path, key: str) -> None: ...
    def get_file(self, key: str, local_path: Path) -> Path: ...
    def put_json(self, key: str, data: Any) -> None: ...
    def get_json(self, key: str) -> Any | None: ...
    def exists(self, key: str) -> bool: ...
    def list_children(self, prefix: str) -> list[str]:
        """Names of the immediate sub-folders under `prefix` (e.g. every job id under 'jobs')."""
        ...

    def media_location(self, key: str) -> Path | str:
        """Local path to stream, or a temporary URL to redirect the browser to."""
        ...


def _retry(action, attempts: int = 12, pause: float = 0.025):  # type: ignore[no-untyped-def]
    """Run a file operation, retrying briefly when Windows says the file is busy (another thread is replacing it).

    A status file is rewritten often while the page reads it; on Windows that can collide for a few milliseconds and
    must not fail a job. Linux never raises here, so nothing changes there."""
    for i in range(attempts):
        try:
            return action()
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(pause)


class LocalStorage:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError(f"invalid key: {key}")
        return path

    def put_file(self, local_path: Path, key: str) -> None:
        dst = self._path(key)
        dst.parent.mkdir(parents=True, exist_ok=True)
        if local_path.resolve() != dst:
            shutil.copyfile(local_path, dst)

    def get_file(self, key: str, local_path: Path) -> Path:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self._path(key), local_path)
        return local_path

    def put_json(self, key: str, data: Any) -> None:
        dst = self._path(key)
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(dst.suffix + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        _retry(lambda: tmp.replace(dst))

    def get_json(self, key: str) -> Any | None:
        path = self._path(key)
        if not path.exists():
            return None
        return json.loads(_retry(lambda: path.read_text(encoding="utf-8")))

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def list_children(self, prefix: str) -> list[str]:
        base = self._path(prefix)
        return [p.name for p in base.iterdir() if p.is_dir()] if base.is_dir() else []

    def media_location(self, key: str) -> Path | str:
        return self._path(key)


class S3Storage:
    def __init__(self, bucket: str, prefix: str, region: str) -> None:
        import boto3

        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.s3 = boto3.client("s3", region_name=region)

    def _key(self, key: str) -> str:
        return f"{self.prefix}/{key}" if self.prefix else key

    def put_file(self, local_path: Path, key: str) -> None:
        self.s3.upload_file(str(local_path), self.bucket, self._key(key))

    def get_file(self, key: str, local_path: Path) -> Path:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        self.s3.download_file(self.bucket, self._key(key), str(local_path))
        return local_path

    def put_json(self, key: str, data: Any) -> None:
        self.s3.put_object(
            Bucket=self.bucket,
            Key=self._key(key),
            Body=json.dumps(data, ensure_ascii=False).encode(),
            ContentType="application/json",
        )

    def get_json(self, key: str) -> Any | None:
        try:
            obj = self.s3.get_object(Bucket=self.bucket, Key=self._key(key))
        except self.s3.exceptions.NoSuchKey:
            return None
        return json.loads(obj["Body"].read())

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self.s3.head_object(Bucket=self.bucket, Key=self._key(key))
            return True
        except ClientError:
            return False

    def list_children(self, prefix: str) -> list[str]:
        names: list[str] = []
        full = self._key(prefix.strip("/")) + "/"
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=full, Delimiter="/"):
            names += [c["Prefix"][len(full) :].strip("/") for c in page.get("CommonPrefixes", [])]
        return names

    def media_location(self, key: str) -> Path | str:
        return self.s3.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": self._key(key)}, ExpiresIn=3600
        )


def get_storage(settings: Settings | None = None) -> Storage:
    settings = settings or get_settings()
    if settings.storage_backend == "s3":
        if not settings.s3_bucket:
            raise RuntimeError("STORAGE_BACKEND=s3 requires S3_BUCKET")
        return S3Storage(settings.s3_bucket, settings.s3_prefix, settings.aws_region)
    return LocalStorage(settings.local_storage_dir)
