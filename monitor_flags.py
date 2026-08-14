import json
import statistics
from collections import defaultdict
from datetime import datetime, timedelta


def aggregate_events(events):
    """Events: iterable of dicts with keys: ts (ISO str), emotion_probs (dict)
    Returns day-bucketed metrics: {date: {total, counts, sadness_ratio, swings}}
    """
    by_day = defaultdict(list)
    for e in events:
        ts = e.get("ts")
        if isinstance(ts, str):
            try:
                ts_dt = datetime.fromisoformat(ts)
            except Exception:
                # fallback: ignore malformed
                continue
        elif isinstance(ts, datetime):
            ts_dt = ts
        else:
            continue
        d = ts_dt.date()
        by_day[d].append(e)

    day_metrics = {}
    for d, evs in by_day.items():
        total = len(evs)
        counts = defaultdict(int)
        top_list = []
        for ev in evs:
            probs = ev.get("emotion_probs") or {}
            if not probs:
                continue
            top = max(probs.items(), key=lambda kv: kv[1])[0]
            top_list.append(top)
            counts[top] += 1
        sadness_ratio = (counts.get("sad", 0) + counts.get("neutral", 0)) / total if total else 0
        swings = sum(1 for i in range(1, len(top_list)) if top_list[i] != top_list[i - 1])
        day_metrics[d] = {"total": total, "counts": dict(counts), "sadness_ratio": sadness_ratio, "swings": swings}
    return day_metrics


def should_flag_weekly(day_metrics, required_days=4, sadness_threshold=0.55):
    days = sorted(day_metrics.keys(), reverse=True)[:7]
    sad_days = sum(1 for d in days if day_metrics[d]["sadness_ratio"] >= sadness_threshold)
    return sad_days >= required_days, sad_days


def compute_instability(day_metrics):
    inst = []
    for d, m in day_metrics.items():
        total = m.get("total", 1)
        swings = m.get("swings", 0)
        inst.append(swings / max(1, total))
    avg_inst = statistics.mean(inst) if inst else 0
    return avg_inst


def evaluate_user_events(events, since_days=7, sadness_threshold=0.55, required_days=4, instability_threshold=0.05):
    """High-level evaluation returning metrics and a flag decision."""
    if not events:
        return {"flag": False, "reason": "no_data", "metrics": {}}
    now = datetime.utcnow()
    cutoff = now - timedelta(days=since_days)
    recent = [e for e in events if _parse_iso(e.get("ts")) and _parse_iso(e.get("ts")) >= cutoff]
    day_metrics = aggregate_events(recent)
    weekly_flag, sad_days = should_flag_weekly(day_metrics, required_days=required_days, sadness_threshold=sadness_threshold)
    instability = compute_instability(day_metrics)
    instability_flag = instability >= instability_threshold
    flag = weekly_flag or instability_flag

    reason = []
    if weekly_flag:
        reason.append(f"persistence_of_sadness: {sad_days} days >= {required_days}")
    if instability_flag:
        reason.append(f"instability_avg: {instability:.3f} >= {instability_threshold}")

    return {"flag": flag, "reason": "; ".join(reason) if reason else "none", "metrics": {"sad_days": sad_days, "instability": instability, "day_metrics": {str(k): v for k, v in day_metrics.items()}}}


def _parse_iso(ts):
    if not ts:
        return None
    if isinstance(ts, datetime):
        return ts
    try:
        return datetime.fromisoformat(ts)
    except Exception:
        return None
