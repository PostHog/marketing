#!/usr/bin/env python3
"""Draws the Banger Bot image for one milestone.

The bot calls this script once for each message. The script reads one JSON
object on stdin and writes a PNG file.

Input:
    {"post": {...}, "milestone": 1000, "out": "/tmp/banger.png"}

The post object holds handle, name, text, likes, reposts, replies, and views.

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

W, H = 1200, 820
CARD_TOP, CARD_BOT = 124, 404
BAND_TOP = CARD_BOT
ORANGE = (245, 78, 0)
CREAM = (249, 245, 239)
INK = (26, 26, 26)
GREY = (110, 116, 122)
BOMBA_RED = (227, 24, 24)

# Each milestone gets its own foreground treatment. Add a milestone here and in
# config.json together, or the new milestone draws a plain card.
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


def wrap(draw, text, f, maxw, max_lines=3):
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
    lines = [ln for ln in lines if ln][:max_lines]
    if lines and len(lines) == max_lines:
        while lines[-1] and draw.textlength(lines[-1] + " ...", font=f) > maxw:
            lines[-1] = lines[-1].rsplit(" ", 1)[0]
    return lines


def art(name, height):
    """Loads an asset, removes the transparent border, and scales it."""
    img = Image.open(ASSETS / name).convert("RGBA")
    img = img.crop(img.getbbox())
    return img.resize((max(1, round(img.width * height / img.height)), height), Image.LANCZOS)


def cover(name, w, h):
    """Scales an asset to fill a box, and crops the overflow from the center."""
    img = Image.open(ASSETS / name).convert("RGBA")
    img = img.crop(img.getbbox())
    s = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    x, y = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((x, y, x + w, y + h))


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


def draw_card(base, post, milestone, stats_fill):
    d = ImageDraw.Draw(base)

    label = f"{milestone:,} LIKES"
    bf = font("Impact.ttf", 46)
    bw = d.textlength(label, font=bf)
    d.rounded_rectangle((60, 38, 60 + bw + 48, 108), radius=14, fill=ORANGE)
    d.text((84 + bw / 2, 73), label, font=bf, fill="white", anchor="mm")

    stats = (f"{post['reposts']:,} reposts    {post['replies']:,} replies    "
             f"{compact(post['views'])} views")
    d.text((1140, 73), stats, font=font("LiberationSans-Bold.ttf", 24),
           fill=stats_fill, anchor="rm")

    d.rounded_rectangle((60, CARD_TOP, 1140, CARD_BOT), radius=22,
                        fill=(255, 255, 255), outline=(228, 226, 222), width=2)
    draw_avatar(base, post, (96, 156, 168, 228))
    d.text((188, 162), post["name"] or post["handle"],
           font=font("LiberationSans-Bold.ttf", 30), fill=INK)
    d.text((188, 200), "@" + post["handle"],
           font=font("LiberationSans-Regular.ttf", 25), fill=GREY)

    body = font("LiberationSans-Regular.ttf", 31)
    y = 258
    for line in wrap(d, post["text"], body, 980):
        d.text((96, y), line, font=body, fill=INK)
        y += 42


def render(post, milestone, out):
    tier = TIERS.get(milestone)

    if tier == "bomba":
        bg = Image.open(ASSETS / "nuclear-blast.jpg").convert("RGB")
        s = max(W / bg.width, H / bg.height)
        bg = bg.resize((round(bg.width * s), round(bg.height * s)), Image.LANCZOS)
        x, y = (bg.width - W) // 2, (bg.height - H) // 2
        base = ImageEnhance.Brightness(bg.crop((x, y, x + W, y + H))).enhance(.8).convert("RGBA")
    else:
        base = Image.new("RGBA", (W, H), CREAM + (255,))

    draw_card(base, post, milestone, (255, 255, 255) if tier == "bomba" else GREY)

    if tier == "pointing":
        pair = art("soyjaks-pointing.png", H - BAND_TOP)
        base.alpha_composite(pair, ((W - pair.width) // 2, BAND_TOP))

    elif tier == "pog":
        # An oval mask keeps the mouth readable and drops the damaged corner of
        # the source. Filling the whole band instead reads as an abstract blur.
        mouth = art("pog-mouth.png", 404)
        mask = Image.new("L", mouth.size, 0)
        ImageDraw.Draw(mask).ellipse((0, 0, mouth.width, mouth.height), fill=255)
        mouth.putalpha(mask.filter(ImageFilter.GaussianBlur(mouth.width * .045)))
        base.alpha_composite(mouth, ((W - mouth.width) // 2, H - mouth.height - 6))

    elif tier == "shaq":
        shaq = art("shaq-glowing.png", 404)
        px, py = W - shaq.width - 96, H - shaq.height - 8
        glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse(
            (px - 60, py + shaq.height * .16, px + shaq.width + 60, py + shaq.height * .62),
            fill=(255, 160, 20, 195))
        base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(55)))
        base.alpha_composite(shaq, (px, py))

    elif tier == "bomba":
        d = ImageDraw.Draw(base)
        top, bot = BAND_TOP + 16, H - 16
        f = fit_box("BOMBA", str(FONTS / "Impact.ttf"), W - 28, bot - top - 24)
        d.text((W // 2, (top + bot) // 2), "BOMBA", font=f, fill=BOMBA_RED,
               stroke_width=10, stroke_fill="black", anchor="mm")

    Path(out).parent.mkdir(parents=True, exist_ok=True)
    base.convert("RGB").save(out, format="PNG", optimize=True)
    return out


SAMPLE = {
    "handle": "posthog", "name": "PostHog",
    "text": ("we built a product analytics tool nobody asked for. "
             "100,000 companies later, here is every mistake we made."),
    "reposts": 214, "replies": 63, "views": 402_000,
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
