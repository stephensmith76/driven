"""Build the two-page reference sheets from the HTML in this folder.

Usage: python rules/reference_sheets/build.py
Writes the Player Reference, GM Reference and Example Walkthroughs PDFs into rules/.
Needs Chrome or Edge installed. The rules version comes from rules/data/core.json.
"""
import json, pathlib, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parent
RULES = HERE.parent
VERSION = json.loads((RULES / 'data' / 'core.json').read_text(encoding='utf-8'))['rules_version']
SHEETS = {'player.html': 'Driven - Player Reference.pdf', 'gm.html': 'Driven - GM Reference.pdf',
          'walkthroughs.html': 'Driven - Example Walkthroughs.pdf'}
BROWSERS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'google-chrome', 'chromium', 'msedge',
]


def browser():
    for b in BROWSERS:
        if pathlib.Path(b).exists():
            return b
    for b in BROWSERS[-3:]:
        try:
            subprocess.run([b, '--version'], capture_output=True, check=True)
            return b
        except (OSError, subprocess.CalledProcessError):
            pass
    sys.exit('Chrome or Edge not found.')


def main():
    exe = browser()
    css = (HERE / 'sheet.css').read_text(encoding='utf-8')
    with tempfile.TemporaryDirectory() as tmp:
        for src, out in SHEETS.items():
            html = (HERE / src).read_text(encoding='utf-8').replace('{{VERSION}}', VERSION)
            html = html.replace('<link rel="stylesheet" href="sheet.css">', '<style>' + css + '</style>')
            page = pathlib.Path(tmp) / src
            page.write_text(html, encoding='utf-8')
            target = RULES / out
            subprocess.run([exe, '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
                            '--user-data-dir=' + str(pathlib.Path(tmp) / 'profile'),
                            '--print-to-pdf=' + str(target), page.as_uri()],
                           check=True, capture_output=True)
            print('wrote', target.name, '(rules', VERSION + ')')


if __name__ == '__main__':
    main()
