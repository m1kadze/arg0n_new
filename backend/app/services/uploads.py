from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile


def detect_media_kind(content_type: str | None) -> str:
    if not content_type:
        return "file"
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("video/"):
        return "video"
    if content_type.startswith("audio/"):
        return "audio"
    return "file"


def sanitize_filename(name: str) -> str:
    return name.replace("/", "_").replace("\\", "_")


async def save_upload_file(
    upload_dir: Path, upload: UploadFile, prefix: str
) -> tuple[str, int]:
    safe_name = sanitize_filename(upload.filename or "file")
    file_id = uuid4().hex
    relative_path = f"{prefix}/{file_id}_{safe_name}"
    full_path = upload_dir / relative_path
    full_path.parent.mkdir(parents=True, exist_ok=True)

    size = 0
    with full_path.open("wb") as target:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            target.write(chunk)
            size += len(chunk)

    await upload.close()
    return relative_path, size