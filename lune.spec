# PyInstaller build spec for the downloadable Lune app.
#
# Build with:  ./build_app.sh
#
# music21 is the awkward dependency here: it ships a large bundled corpus of
# scores that Lune never reads, so the corpus is excluded to keep the download
# to a sane size.

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

music21_data = [
    (src, dest)
    for src, dest in collect_data_files("music21")
    if "/corpus/" not in src.replace("\\", "/")
]

hidden = (
    collect_submodules("music21")
    + collect_submodules("uvicorn")
    + [
        "anyio",
        "fastapi",
        "openai",
        "anthropic",
        "cryptography",
        "webview",
        "webview.platforms.cocoa",
        "sqlite3",
    ]
)

analysis = Analysis(
    ["desktop.py"],
    pathex=["."],
    binaries=[],
    datas=[
        ("frontend", "frontend"),
        ("samples", "samples"),
    ]
    + music21_data,
    hiddenimports=hidden,
    hookspath=[],
    runtime_hooks=[],
    # Never ship a developer's own API key inside the app.
    excludes=["tkinter", "matplotlib", "scipy", "PIL", "pytest"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(analysis.pure, analysis.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="Lune",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

collection = COLLECT(
    exe,
    analysis.binaries,
    analysis.zipfiles,
    analysis.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="Lune",
)

app = BUNDLE(
    collection,
    name="Lune.app",
    icon=None,
    bundle_identifier="com.lune.music",
    info_plist={
        "CFBundleName": "Lune",
        "CFBundleDisplayName": "Lune",
        "CFBundleShortVersionString": "3.0.0",
        "NSHighResolutionCapable": True,
        "LSMinimumSystemVersion": "11.0",
    },
)
