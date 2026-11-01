"""Read-only backend for the DeepAgents skills middleware.

The Flask process is an HTTP service; the deepagents docs warn against giving
an agent a writable FilesystemBackend. This backend exposes only ``/skills/``
and rejects every write, delete and upload.
"""

from __future__ import annotations

from pathlib import Path

from deepagents.backends import FilesystemBackend


class SkillsBackend(FilesystemBackend):
    """A virtual filesystem rooted at ``agent/`` that only serves ``/skills``."""

    def __init__(self, root: Path):
        super().__init__(root_dir=str(root), virtual_mode=True)

    def _resolve_path(self, key: str) -> Path:
        path = super()._resolve_path(key)
        relative = path.relative_to(self.cwd).as_posix()
        if relative != "skills" and not relative.startswith("skills/"):
            raise ValueError("只允许读取 skills 目录")
        return path

    @staticmethod
    def _read_only(*_args, **_kwargs):
        raise PermissionError("技能目录是只读的")

    write = _read_only
    edit = _read_only
    delete = _read_only
    upload_files = _read_only
