#!/usr/bin/env python3
"""Draws the Banger Bot image for one milestone.

The bot calls this script once for each message. The script reads one JSON
object on stdin and writes a PNG file.

Input:
    {"post": {...}, "milestone": 1000, "out": "/tmp/banger.png"}

The post object holds handle, name, text, likes, reposts, replies, and views.

The image is as tall as the post needs, and no taller. The meme for the
milestone sits on top of the post and covers part of it. The overlap is the
joke, so do not move the art clear of the text.

Run `python3 banger_image.py --samples <dir>` to draw one sample for each
milestone. Use the samples to review a design change before you ship it.
"""
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
FONTS = ASSETS / "fonts"

W = 1200
MARGIN = 36
PAD = 40
AVATAR = 76
LINE_H = 44
MAX_LINES = 4
ORANGE = (245, 78, 0)
CREAM = (249, 245, 239)
INK = (26, 26, 26)
GREY = (110, 116, 122)
BOMBA_RED = (227, 24, 24)

# Each milestone gets its own overlay. Add a milestone here and in config.json
# together, or the new milestone draws a plain post with no art.
TIERS = {
    250: "pointing",
    500: "pog",
    1000: "shaq",
    3000: "bomba",
}


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def compact(n):
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M".replace(".0M", "M")
    if n >= 1_000:
        return f"{n / 1_000:.0f}K"
    return f"{n:,}"


def fit_box(text, path, maxw, maxh, lo=10, hi=600):
    """Largest font size that fits inside both the width and the height."""
    best = lo
    while lo <= hi:
        mid = (lo + hi) // 2
        bb = ImageFont.truetype(path, mid).getbbox(text)
        if bb[2] - bb[0] <= maxw and bb[3] - bb[1] <= maxh:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    return ImageFont.truetype(path, best)


def wrap(draw, text, f, maxw):
    lines = []
    for para in text.split("\n"):
        cur = ""
        for word in para.split():
            trial = (cur + " " + word).strip()
            if draw.textlength(trial, font=f) <= maxw:
                cur = trial
            else:
                lines.append(cur)
                cur = word
        lines.append(cur)
    lines = [ln for ln in lines if ln]
    if len(lines) > MAX_LINES:
        lines = lines[:MAX_LINES]
        while lines[-1] and draw.textlength(lines[-1] + " ...", font=f) > maxw:
            lines[-1] = lines[-1].rsplit(" ", 1)[0]
        lines[-1] += " ..."
    return lines


def art(name, height, tilt=0):
    """Loads an asset, drops the transparent border, scales it, and tilts it."""
    img = Image.open(ASSETS / name).convert("RGBA")
    img = img.crop(img.getbbox())
    img = img.resize((max(1, round(img.width * height / img.height)), height), Image.LANCZOS)
    if tilt:
        img = img.rotate(tilt, expand=True, resample=Image.BICUBIC)
    return img


def initials(name, handle):
    source = name or handle
    caps = [c for c in source if c.isupper()]
    return "".join(caps[:2]) if len(caps) >= 2 else source[:2].upper()


def draw_avatar(base, post, box):
    """Draws the author avatar, or the initials when no avatar is reachable."""
    size = box[2] - box[0]
    url = post.get("avatar")
    if url:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "banger-bot"})
            data = urllib.request.urlopen(request, timeout=10).read()
            face = Image.open(io.BytesIO(data)).convert("RGBA").resize((size, size), Image.LANCZOS)
            mask = Image.new("L", (size, size), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
            base.paste(face, (box[0], box[1]), mask)
            return
        except Exception:
            pass

    d = ImageDraw.Draw(base)
    d.ellipse(box, fill=ORANGE)
    d.text(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2),
           initials(post["name"], post["handle"]),
           font=font("LiberationSans-Bold.ttf", 30), fill="white", anchor="mm")


def layout(post):
    """Measures the post, so the image is only as tall as the post needs."""
    body = font("LiberationSans-Regular.ttf", 32)
    ruler = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    lines = wrap(ruler, post["text"], body, W - 2 * MARGIN - 2 * PAD)

    text_top = MARGIN + PAD + AVATAR + 30
    stats_top = text_top + len(lines) * LINE_H + 18
    card_bottom = stats_top + 30 + PAD
    return lines, body, text_top, stats_top, card_bottom, card_bottom + MARGIN


def draw_post(base, post, lines, body, text_top, stats_top, card_bottom):
    d = ImageDraw.Draw(base)
    d.rounded_rectangle((MARGIN, MARGIN, W - MARGIN, card_bottom), radius=24,
                        fill=(255, 255, 255), outline=(226, 224, 220), width=2)

    left = MARGIN + PAD
    draw_avatar(base, post, (left, MARGIN + PAD, left + AVATAR, MARGIN + PAD + AVATAR))
    d.text((left + AVATAR + 24, MARGIN + PAD + 2), post["name"] or post["handle"],
           font=font("LiberationSans-Bold.ttf", 32), fill=INK)
    d.text((left + AVATAR + 24, MARGIN + PAD + 42), "@" + post["handle"],
           font=font("LiberationSans-Regular.ttf", 26), fill=GREY)

    y = text_top
    for line in lines:
        d.text((left, y), line, font=body, fill=INK)
        y += LINE_H

    stats = (f"{post['replies']:,} replies    {post['reposts']:,} reposts    "
             f"{post['likes']:,} likes    {compact(post['views'])} views")
    d.text((left, stats_top), stats, font=font("LiberationSans-Regular.ttf", 24), fill=GREY)


def render(post, milestone, out):
    tier = TIERS.get(milestone)
    lines, body, text_top, stats_top, card_bottom, H = layout(post)

    if tier == "bomba":
        bg = Image.open(ASSETS / "nuclear-blast.jpg").convert("RGB")
        s = max(W / bg.width, H / bg.height)
        bg = bg.resize((round(bg.width * s), round(bg.height * s)), Image.LANCZOS)
        x, y = (bg.width - W) // 2, (bg.height - H) // 2
        base = ImageEnhance.Brightness(bg.crop((x, y, x + W, y + H))).enhance(.82).convert("RGBA")
    else:
        base = Image.new("RGBA", (W, H), CREAM + (255,))

    draw_post(base, post, lines, body, text_top, stats_top, card_bottom)

    # The art sits on top of the post and runs off the edge of the frame.
    if tier == "pointing":
        pair = art("soyjaks-pointing.png", round(H * 1.18), tilt=-5)
        base.alpha_composite(pair, (W - pair.width + 96, H - pair.height + 78))

    elif tier == "pog":
        mouth = art("pog-mouth.png", round(H * 1.02), tilt=8)
        base.alpha_composite(mouth, (round(W * 0.42), H - mouth.height + 70))

    elif tier == "shaq":
        shaq = art("shaq-glowing.png", round(H * 1.35), tilt=-9)
        px, py = W - shaq.width + 110, H - shaq.height + 66
        glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse(
            (px, py + shaq.height * .18, px + shaq.width, py + shaq.height * .62),
            fill=(255, 160, 20, 190))
        base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(55)))
        base.alpha_composite(shaq, (px, py))

    elif tier == "bomba":
        d = ImageDraw.Draw(base)
        f = fit_box("BOMBA", str(FONTS / "Impact.ttf"), W - 24, round(H * 0.74))
        d.text((W // 2, H // 2 + 14), "BOMBA", font=f, fill=BOMBA_RED,
               stroke_width=10, stroke_fill="black", anchor="mm")

    Path(out).parent.mkdir(parents=True, exist_ok=True)
    base.convert("RGB").save(out, format="PNG", optimize=True)
    return out


SAMPLE = {
    "handle": "posthog", "name": "PostHog",
    "text": ("we built a product analytics tool nobody asked for. "
             "100,000 companies later, here is every mistake we made."),
}


def main():
    if "--samples" in sys.argv:
        out_dir = Path(sys.argv[sys.argv.index("--samples") + 1])
        for milestone, likes, rt, rp, vw in [
            (250, 268, 41, 12, 38_400),
            (500, 512, 96, 27, 91_200),
            (1000, 1043, 214, 63, 402_000),
            (3000, 3184, 702, 188, 1_640_000),
        ]:
            post = {**SAMPLE, "likes": likes, "reposts": rt, "replies": rp, "views": vw}
            print(render(post, milestone, out_dir / f"banger-{milestone}.png"))
        return

    job = json.load(sys.stdin)
    print(render(job["post"], job["milestone"], job["out"]))


if __name__ == "__main__":
    main()
