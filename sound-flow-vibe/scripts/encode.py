#!/usr/bin/env python3
"""Sound Flow share codec (spec 8.1) - config JSON <-> #sfa= URL.

Identical transform to src/lib/codec.mjs: base64url(raw-deflate(minified JSON)),
'=' padding stripped. The minified JSON byte-matches JSON.stringify exactly
(no spaces, ensure_ascii=False, insertion key order); the deflate bytes MAY
differ from a given JS runtime's (zlib builds differ — Node bundles a Chromium
zlib fork) but every code is mutually decodable and decode(encode(x)) == x
holds across both languages (verified by scripts/verify.mjs suite d).
No third-party deps.
"""
import argparse
import base64
import json
import sys
import zlib
from pathlib import Path

DEFAULT_FILE_BASE = 'https://sound-flow.netlify.app/{studio}/'  # published default: the live studios
LIVE_BASE = 'https://sound-flow.netlify.app/{studio}/'


def minify(obj):
    return json.dumps(obj, separators=(',', ':'), ensure_ascii=False)


def encode(envelope):
    raw = minify(envelope).encode('utf-8')
    co = zlib.compressobj(zlib.Z_DEFAULT_COMPRESSION, zlib.DEFLATED, -15)
    packed = co.compress(raw) + co.flush()
    return base64.urlsafe_b64encode(packed).decode('ascii').rstrip('=')


def decode(code_or_url):
    s = code_or_url
    if '#sfa=' in s:
        s = s.split('#sfa=', 1)[1]
    s = s.split('&')[0]  # tolerate trailing hash params like &auto=render
    pad = '=' * (-len(s) % 4)
    packed = base64.urlsafe_b64decode(s + pad)
    env = json.loads(zlib.decompress(packed, -15).decode('utf-8'))
    if env.get('v') != 1 or 'studio' not in env or 'cfg' not in env:
        raise SystemExit('error: decoded payload is not a v1 sfa envelope')
    return env


def main():
    p = argparse.ArgumentParser(description='config JSON <-> #sfa= share URL (codec.mjs-compatible)')
    p.add_argument('file', nargs='?', help='config JSON file, or - for stdin')
    p.add_argument('--studio', help='wrap a bare cfg into the v1 envelope for this studio')
    p.add_argument('--live', action='store_true', help='base https://sound-flow.netlify.app/<studio>/')
    p.add_argument('--base', help='base URL override')
    p.add_argument('--code', action='store_true', help='print just the sfa code')
    p.add_argument('--json', action='store_true', help='print the minified envelope JSON (the exact compressed bytes)')
    p.add_argument('--decode', metavar='URL_OR_CODE', help='decode a share URL or code, print pretty JSON')
    args = p.parse_args()

    if args.decode is not None:
        print(json.dumps(decode(args.decode), indent=2, ensure_ascii=False))
        return

    if not args.file:
        p.error('a config file (or -) is required unless --decode is used')
    text = sys.stdin.read() if args.file == '-' else open(args.file, encoding='utf-8').read()
    obj = json.loads(text)

    if isinstance(obj, dict) and 'v' in obj and 'studio' in obj and 'cfg' in obj:
        env = obj  # already an envelope; --studio ignored
    elif args.studio:
        env = {'v': 1, 'studio': args.studio, 'cfg': obj}
    else:
        raise SystemExit('error: bare cfg needs --studio <id> to build the envelope')

    if args.json:
        print(minify(env))
        return
    code = encode(env)
    if args.code:
        print(code)
        return

    studio = env['studio']
    base = args.base or (LIVE_BASE if args.live else DEFAULT_FILE_BASE).format(studio=studio)
    base = base.split('#', 1)[0]  # shareUrl() law: strip any existing fragment
    print(f'{base}#sfa={code}')


if __name__ == '__main__':
    main()
