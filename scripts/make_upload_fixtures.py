"""Upload fixtures for the Playwright suites: two scores that should open and
five files that should be turned away with a clear message.

    python3 scripts/make_upload_fixtures.py [dir]      (default: /tmp/up)
"""
import shutil
import sys
import zipfile
import zlib
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples" / "library"


def tiny_png() -> bytes:
    """A 4×4 white PNG: a real image with no staff on it."""
    raw = b"".join(b"\x00" + b"\xff\xff\xff" * 4 for _ in range(4))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def build(out: Path) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SAMPLES / "twinkle.musicxml", out / "valid.musicxml")
    elise = (SAMPLES / "beethoven_-_bagatelle_no._25_fur_elise.musicxml").read_bytes()
    with zipfile.ZipFile(out / "elise.mxl", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>'
            '<rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>'
            "</rootfiles></container>",
        )
        z.writestr("score.musicxml", elise)
    (out / "bad.musicxml").write_text('<?xml version="1.0"?><score-partwise><part id="P1"><measure', encoding="utf-8")
    (out / "notes.txt").write_text("Bar 12: keep the left hand quiet.\n", encoding="utf-8")
    (out / "broken.pdf").write_bytes(b"%PDF-1.4\n%this is not really a pdf\n")
    (out / "photo.png").write_bytes(tiny_png())
    (out / "empty.musicxml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="3.1"><part-list>'
        '<score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
        '<part id="P1"></part></score-partwise>\n',
        encoding="utf-8",
    )
    return out


if __name__ == "__main__":
    print(build(Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/up")))
