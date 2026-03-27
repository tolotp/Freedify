"""
SoundCloud Search Service
Uses yt-dlp's built-in scsearch to find tracks on SoundCloud.
"""
import asyncio
import json
import logging

logger = logging.getLogger(__name__)


async def search_tracks(query: str, limit: int = 20) -> list:
    """Search SoundCloud for tracks using yt-dlp scsearch."""
    try:
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(None, _search_sync, query, limit)
        return results
    except Exception as e:
        logger.error(f"SoundCloud search error: {e}")
        return []


def _search_sync(query: str, limit: int) -> list:
    """Synchronous yt-dlp search (runs in executor)."""
    import subprocess
    import sys

    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        "--no-download",
        f"scsearch{limit}:{query}",
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            logger.warning(f"yt-dlp scsearch failed: {result.stderr[:200]}")
            return []

        tracks = []
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
                track = _parse_entry(entry)
                if track:
                    tracks.append(track)
            except json.JSONDecodeError:
                continue

        logger.info(f"SoundCloud search returned {len(tracks)} results for '{query}'")
        return tracks

    except subprocess.TimeoutExpired:
        logger.warning("SoundCloud search timed out")
        return []
    except FileNotFoundError:
        logger.error("yt-dlp not found — SoundCloud search unavailable")
        return []


def _parse_entry(entry: dict) -> dict | None:
    """Convert a yt-dlp flat-playlist entry to a Freedify track object."""
    title = entry.get("title")
    url = entry.get("url") or entry.get("webpage_url")
    if not title or not url:
        return None

    # yt-dlp uses 'uploader' for SoundCloud artist
    artist = entry.get("uploader") or entry.get("channel") or "Unknown Artist"
    duration = entry.get("duration")  # seconds (may be None for flat entries)

    # Build a display duration string
    duration_str = ""
    duration_ms = 0
    if duration:
        mins, secs = divmod(int(duration), 60)
        duration_str = f"{mins}:{secs:02d}"
        duration_ms = int(duration) * 1000

    # Build LINK: id (base64-encoded URL for the stream endpoint)
    import base64
    link_id = "LINK:" + base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")

    return {
        "id": link_id,
        "isrc": link_id,
        "type": "track",
        "name": title,
        "artists": artist,
        "album": "SoundCloud",
        "album_art": entry.get("thumbnail") or entry.get("thumbnails", [{}])[0].get("url") or "/static/icon.svg",
        "duration": duration_str,
        "duration_ms": duration_ms,
        "source": "soundcloud",
    }
