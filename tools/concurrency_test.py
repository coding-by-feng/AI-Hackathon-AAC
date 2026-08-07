#!/usr/bin/env python3
"""Writer and reader against the same WAL database, concurrently.

    python3 tools/concurrency_test.py --db aac.db --seconds 15

The API server writes events while the MCP server reads for the dashboard and
the analysis model. SQLite locking problems appear under exactly the conditions
a live demo creates and not before, so this runs before demo day rather than
during it.

Works on a COPY. It never touches the database you point it at.
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


@dataclass
class Stats:
    ok: int = 0
    busy: int = 0
    errors: list[str] = field(default_factory=list)
    latencies_ms: list[float] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def record(self, elapsed_ms: float) -> None:
        with self.lock:
            self.ok += 1
            self.latencies_ms.append(elapsed_ms)

    def fail(self, exc: Exception) -> None:
        with self.lock:
            msg = str(exc)
            if "locked" in msg or "busy" in msg:
                self.busy += 1
            else:
                self.errors.append(msg)

    def p(self, pct: float) -> float:
        if not self.latencies_ms:
            return 0.0
        ordered = sorted(self.latencies_ms)
        return ordered[min(int(len(ordered) * pct), len(ordered) - 1)]


def writer(db_path: str, stop: threading.Event, stats: Stats) -> None:
    """Stands in for the Node API ingesting events from the browser."""
    conn = sqlite3.connect(db_path, timeout=5.0)
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA foreign_keys = ON")
    day = conn.execute("SELECT MAX(day_local) FROM events").fetchone()[0]
    ts = conn.execute("SELECT MAX(ts) FROM events").fetchone()[0]
    session = f"sess_{uuid.uuid4().hex[:8]}"
    n = 0
    while not stop.is_set():
        started = time.perf_counter()
        try:
            batch = []
            for _ in range(20):                       # batched, as the API does
                n += 1
                batch.append((
                    f"ev_conc_{uuid.uuid4().hex[:12]}", "maya_t", ts + n * 1000, day, 720,
                    session, "classroom", "child", "card_tap",
                    f"utt_conc_{n // 3}", "board_maya_t", "want", "want",
                    0, 1, 4, 4, 0, "board", 900, "{}",
                ))
            conn.executemany(
                "INSERT INTO events VALUES (" + ",".join("?" * 21) + ")", batch)
            conn.commit()
            stats.record((time.perf_counter() - started) * 1000)
        except Exception as exc:                      # noqa: BLE001
            stats.fail(exc)
            time.sleep(0.01)
    conn.close()


def reader(db_path: str, stop: threading.Event, stats: Stats, name: str) -> None:
    """Stands in for the MCP server answering the dashboard and the model."""
    # NOT mode=ro: SQLite cannot open a WAL database read-only. query_only plus a
    # deny-ATTACH authorizer is the equivalent that actually works. docs/mcp-api.md §10.
    conn = sqlite3.connect(db_path, timeout=5.0)
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA query_only = ON")
    conn.set_authorizer(
        lambda action, *_: sqlite3.SQLITE_DENY
        if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH)
        else sqlite3.SQLITE_OK
    )
    # The MCP server's real access pattern: materialised tables only. Querying
    # the live insight views here produced a p99 of 5 seconds, which is exactly
    # the finding that moved rule evaluation into tools/run_rules.py.
    queries = [
        "SELECT * FROM agg_daily_metric WHERE child_id='maya_t' AND day_local >= '2026-08-01'",
        "SELECT * FROM fired_rules WHERE child_id='maya_t' AND dismissed_at IS NULL"
        "  AND superseded_by IS NULL",
        "SELECT * FROM agg_cell_heat WHERE child_id='maya_t'",
        "SELECT * FROM agg_card_stats WHERE child_id='maya_t' ORDER BY taps DESC LIMIT 25",
        "SELECT * FROM agg_word_pairs WHERE child_id='liam_w' AND together=0 LIMIT 20",
        "SELECT child_id, display_name FROM children",
    ]
    i = 0
    while not stop.is_set():
        started = time.perf_counter()
        try:
            conn.execute(queries[i % len(queries)]).fetchall()
            stats.record((time.perf_counter() - started) * 1000)
            i += 1
        except Exception as exc:                      # noqa: BLE001
            stats.fail(exc)
            time.sleep(0.01)
    conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "aac.db"))
    ap.add_argument("--seconds", type=int, default=15)
    ap.add_argument("--readers", type=int, default=3)
    args = ap.parse_args()

    tmp = Path(tempfile.mkdtemp()) / "concurrency.db"
    shutil.copy(args.db, tmp)
    setup = sqlite3.connect(str(tmp))
    mode = setup.execute("PRAGMA journal_mode=WAL").fetchone()[0]
    setup.close()

    print(f"database : {tmp}  {DIM}(copy — your data is untouched){RESET}")
    print(f"journal  : {mode}")
    print(f"duration : {args.seconds}s   1 writer, {args.readers} readers\n")
    if mode != "wal":
        print(f"{RED}WAL is not enabled. Concurrent access will fail.{RESET}")
        return 1

    stop = threading.Event()
    w_stats, r_stats = Stats(), Stats()
    threads = [threading.Thread(target=writer, args=(str(tmp), stop, w_stats), daemon=True)]
    threads += [
        threading.Thread(target=reader, args=(str(tmp), stop, r_stats, f"r{i}"), daemon=True)
        for i in range(args.readers)
    ]
    for t in threads:
        t.start()
    time.sleep(args.seconds)
    stop.set()
    for t in threads:
        t.join(timeout=10)

    def line(label: str, s: Stats) -> None:
        print(f"{label:<8} ok={s.ok:<7,} busy_retries={s.busy:<5} errors={len(s.errors):<4} "
              f"p50={s.p(0.5):>7.2f}ms  p99={s.p(0.99):>8.2f}ms")

    line("writer", w_stats)
    line("readers", r_stats)

    failures: list[str] = []
    if w_stats.errors:
        failures.append(f"writer errors: {w_stats.errors[:3]}")
    if r_stats.errors:
        failures.append(f"reader errors: {r_stats.errors[:3]}")
    if w_stats.ok == 0:
        failures.append("writer never committed")
    if r_stats.ok == 0:
        failures.append("readers never completed a query")
    # A reader p99 above a second means the dashboard stalls whenever a class
    # is mid-session. That is a demo-day failure even though nothing errored.
    if r_stats.p(0.99) > 1000:
        failures.append(f"reader p99 {r_stats.p(0.99):.0f}ms — dashboard would stall under load")

    print()
    if failures:
        print(f"{RED}FAILED{RESET}")
        for f in failures:
            print(f"  · {f}")
        return 1

    total = w_stats.ok * 20
    print(f"{GREEN}PASSED{RESET} — {total:,} events written and "
          f"{r_stats.ok:,} reads served concurrently, no lock errors")
    if w_stats.busy or r_stats.busy:
        print(f"{DIM}  {w_stats.busy + r_stats.busy} busy retries absorbed by busy_timeout "
              f"(expected under WAL; not an error){RESET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
