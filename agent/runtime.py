"""Checkpoint and latest-calculation store on disk under output/runtime.

Both survive process restart. The page agent and MCP read the same store file.
"""

from __future__ import annotations

import json
import pickle
import sqlite3
import threading
from collections import defaultdict
from pathlib import Path

from langgraph.checkpoint.memory import InMemorySaver

from agent.paths import REPO

RUNTIME = REPO / "output" / "runtime"
CALCULATION = ("rwa", "calculation")
LATEST = "latest"

_LOCK = threading.Lock()


class Record:
    def __init__(self, value: dict):
        self.value = value


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


class SharedStore:
    """One row per namespace and key. get and put hit the file each time."""

    def __init__(self, path: Path):
        self.path = path
        with _connect(path) as db:
            db.execute(
                """CREATE TABLE IF NOT EXISTS item (
                    namespace TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    PRIMARY KEY (namespace, key)
                )"""
            )

    def get(self, namespace, key, *, refresh_ttl=None):
        ns = "/".join(namespace)
        with _LOCK, _connect(self.path) as db:
            row = db.execute(
                "SELECT value FROM item WHERE namespace = ? AND key = ?",
                (ns, key),
            ).fetchone()
        if row is None:
            return None
        try:
            value = json.loads(row[0])
        except (ValueError, TypeError):
            return None
        if not isinstance(value, dict):
            return None
        return Record(value)

    def put(self, namespace, key, value, index=None, *, ttl=None):
        if not isinstance(value, dict):
            raise TypeError("value 必须是对象")
        ns = "/".join(namespace)
        body = json.dumps(value, ensure_ascii=False)
        with _LOCK, _connect(self.path) as db:
            db.execute(
                """INSERT INTO item (namespace, key, value) VALUES (?, ?, ?)
                   ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value""",
                (ns, key, body),
            )


class FileSaver(InMemorySaver):
    """In-memory saver that reloads and flushes its tables to one sqlite blob."""

    def __init__(self, path: Path):
        super().__init__()
        self.path = path
        self._file_lock = threading.RLock()
        with _connect(path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY, payload BLOB)")
        self._load()

    def _load(self) -> None:
        with self._file_lock, _connect(self.path) as db:
            row = db.execute("SELECT payload FROM snapshot WHERE id = 1").fetchone()
        if not row or not row[0]:
            return
        try:
            raw = pickle.loads(row[0])
        except (pickle.UnpicklingError, EOFError, ValueError, TypeError):
            return
        if not isinstance(raw, dict):
            return
        storage = defaultdict(lambda: defaultdict(dict))
        for thread, namespaces in (raw.get("storage") or {}).items():
            bucket = defaultdict(dict)
            if isinstance(namespaces, dict):
                bucket.update(namespaces)
            storage[thread] = bucket
        writes = defaultdict(dict)
        for key, value in (raw.get("writes") or {}).items():
            if isinstance(value, dict):
                writes[key] = dict(value)
        blobs = defaultdict()
        loaded = raw.get("blobs")
        if isinstance(loaded, dict):
            blobs.update(loaded)
        self.storage = storage
        self.writes = writes
        self.blobs = blobs

    def _flush(self) -> None:
        storage = {
            thread: {ns: dict(checkpoints) for ns, checkpoints in namespaces.items()}
            for thread, namespaces in self.storage.items()
        }
        writes = {key: dict(value) for key, value in self.writes.items()}
        payload = pickle.dumps(
            {"storage": storage, "writes": writes, "blobs": dict(self.blobs)},
            protocol=pickle.HIGHEST_PROTOCOL,
        )
        with self._file_lock, _connect(self.path) as db:
            db.execute(
                "INSERT INTO snapshot (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
                (payload,),
            )

    def put(self, config, checkpoint, metadata, new_versions):
        with self._file_lock:
            result = super().put(config, checkpoint, metadata, new_versions)
            self._flush()
            return result

    def put_writes(self, config, writes, task_id, task_path=""):
        with self._file_lock:
            super().put_writes(config, writes, task_id, task_path)
            self._flush()

    def delete_thread(self, thread_id):
        with self._file_lock:
            super().delete_thread(thread_id)
            self._flush()

    def delete_for_runs(self, run_ids):
        with self._file_lock:
            super().delete_for_runs(run_ids)
            self._flush()

    def prune(self, thread_ids, *, strategy="keep_latest"):
        with self._file_lock:
            super().prune(thread_ids, strategy=strategy)
            self._flush()

    def copy_thread(self, source_thread_id, target_thread_id):
        with self._file_lock:
            super().copy_thread(source_thread_id, target_thread_id)
            self._flush()


checkpointer = FileSaver(RUNTIME / "checkpoints.sqlite")
store = SharedStore(RUNTIME / "store.sqlite")
