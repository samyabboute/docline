"""Injecte les scripts Sentry dans toutes les pages HTML."""
import os, re, glob

SENTRY_SCRIPTS = """\
  <!-- Sentry monitoring -->
  <script src="https://browser.sentry-cdn.com/8.28.0/bundle.tracing.replay.min.js" crossorigin="anonymous"></script>
  <script src="/js/sentry-config.js"></script>
  <script src="/js/sentry-init.js"></script>"""

pages_dir = r"C:\Users\user\Downloads\prospeo_v17_qa\prospeo\src\pages"
files = glob.glob(os.path.join(pages_dir, "*.html"))

patched = 0
skipped = 0

for fpath in files:
    with open(fpath, encoding="utf-8") as f:
        content = f.read()

    if "sentry-cdn.com" in content:
        skipped += 1
        continue

    # Injecter juste avant </head>
    if "</head>" not in content:
        print(f"  SKIP (no </head>): {os.path.basename(fpath)}")
        skipped += 1
        continue

    new_content = content.replace("</head>", SENTRY_SCRIPTS + "\n</head>", 1)
    with open(fpath, "w", encoding="utf-8") as f:
        f.write(new_content)
    patched += 1
    print(f"  OK: {os.path.basename(fpath)}")

print(f"\nDone: {patched} patched, {skipped} skipped.")
