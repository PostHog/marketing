# Banger Bot

Banger Bot posts to `#team-editorial` when a post on X passes a like milestone.

It watches the PostHog brand account and the affiliated employee accounts. The
account list is in [`config.json`](./config.json).

The milestones are 250, 500, 1,000, and 3,000 likes. The bot announces each
milestone one time for each post.

Each message carries an image of the post. The image gets a different meme
overlay for each milestone.

## The images

| Milestone | Overlay                                                    |
| --------- | ---------------------------------------------------------- |
| 250       | The pointing soyjaks, in the foreground.                    |
| 500       | The pog mouth, centered in the foreground.                  |
| 1,000     | The glowing-eyes Shaq cutout, with a glow behind it.         |
| 3,000     | A nuclear blast, and "BOMBA" in red Impact across the width. |

[`render/banger_image.py`](./render/banger_image.py) draws every image. It is
the only file that decides how an image looks.

To review a design change, draw one sample for each milestone:

```sh
python3 render/banger_image.py --samples ./samples
```

The workflow runs the same command on each run. A missing asset, a missing
font, or a broken layout therefore fails the job before the bot posts anything.

To add a milestone, add it to `thresholds` in `config.json` and to `TIERS` in
`render/banger_image.py`. A milestone with no tier draws a plain card.

## Where the numbers come from

The bot reads the like counts from **Octolens**, not from the X API. PostHog
already pays for Octolens, and Octolens already feeds `#brand-mentions`. The bot
therefore adds no vendor cost.

Octolens refreshes the public engagement counters on the posts that it holds.
Each post carries an `engagementMetrics` map and an `engagementObservedAt` time.

### Coverage: read this before you trust the bot

**Octolens collects by keyword, and it matches the keyword against the post
text. It has no author feed.**

A post therefore reaches the bot only when the post text matches a tracked
keyword. A post from `@posthog` that never says "PostHog" does not reach the
bot. Employee posts match a keyword even less often.

The bot cannot see a post that Octolens does not hold, so a gap is silent. Each
run therefore logs a coverage line:

```
Coverage: 14 post(s) inside the 96 hour window, from 5 of 12 account(s).
No posts in the window from: @example, @example2
Engagement observed between 12 and 47 minute(s) ago.
```

Read these lines in the job log after a week. They answer 2 questions:

1. **Is the coverage good enough?** If most accounts never appear, Octolens is
   the wrong source. The X API v2 covers every account, and it costs about $200
   each month.
2. **Is the data fresh enough?** Octolens does not document how often it
   refreshes the counters. If the observed age is many hours, the 2 hour
   schedule is too frequent, and an alert arrives late.

## How it works

[`.github/workflows/banger-bot.yml`](../../.github/workflows/banger-bot.yml)
runs the bot every 2 hours. One run does 5 steps:

1. It reads the recent posts of each account from Octolens.
2. It keeps the posts that are inside `trackWindowHours`.
3. It draws an image for each post that passed a new milestone, and it uploads
   the image to Slack.
4. It logs the coverage and the age of the engagement data.
5. It writes the state file.

A post can pass two milestones between two runs. The bot then posts one message
for the largest milestone. It marks the smaller milestones as announced.

One run makes one Octolens request for each account. The Octolens limit is 500
requests each hour for the whole organization, and the bot uses about 72 each
day. Other PostHog automations share that limit.

## Files

| File                    | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| `config.json`           | Accounts, milestones, and the tracking window.  |
| `src/index.js`          | The run order. It calls the other modules.      |
| `src/octolens-api.js`   | The Octolens client and the mention mapping.    |
| `src/state.js`          | The state file and the prune step.              |
| `src/milestones.js`     | The threshold logic. The unit tests cover it.   |
| `src/image.js`          | Starts the Python renderer.                     |
| `src/message.js`        | The text above the image.                       |
| `src/slack.js`          | The Slack upload.                               |
| `render/banger_image.py`| The image layout. **Change this for a redesign.** |
| `assets/`               | The meme art, the blast photo, and the fonts.   |
| `test/`                 | Unit tests for the pure functions.              |

## Setup

Add 3 repository secrets under **Settings → Secrets and variables → Actions**:

| Secret              | Value                                              |
| ------------------- | -------------------------------------------------- |
| `OCTOLENS_API_KEY`  | An Octolens API key with the `read` scope.          |
| `SLACK_BOT_TOKEN`   | A Slack bot token, `xoxb-...`.                      |
| `SLACK_CHANNEL_ID`  | The id of `#team-editorial`.                        |

Create the Octolens key in **Octolens → Settings → API keys**.

The Slack app needs the `files:write` and `chat:write` scopes. **Invite the app
to the channel.** The upload fails with `not_in_channel` if you do not.

An incoming webhook cannot upload a file, so the bot needs the app token. This
is why the bot does not use the webhook pattern that other PostHog workflows
use.

Then open the **Actions** tab. Select **Banger Bot**. Select **Run workflow**,
and set `dry_run` to `true`. The bot draws the images and posts nothing. Get
them from the `banger-bot-preview` artifact on the run.

### Check the account handles

The bot finds posts by handle. A wrong handle returns no posts, and Octolens
reports no error. Check each handle in `config.json` against the live account
before you trust the bot. Update `config.json` when a person changes handle.

The brand account in `config.json` is `posthog`. Correct it if the brand account
uses a different handle.

## Configuration

`config.json` holds these keys:

| Key                  | Meaning                                              |
| -------------------- | ---------------------------------------------------- |
| `thresholds`         | The like milestones, in ascending order.              |
| `trackWindowHours`   | How long the bot watches a post. The default is 96.   |
| `maxPostsPerAccount` | Posts to read for each account, from 1 to 50.         |
| `source`             | The Octolens platform name. Use `twitter` for X.      |
| `accounts`           | The handles to watch, without the `@` character.      |

## State

The bot keeps the announced milestones in `.banger-bot-state/state.json`. GitHub
Actions holds this file in the Actions cache between runs.

A cache miss is safe. The bot then records the current like counts, and it posts
nothing for that run. The next run posts as normal. A cache miss costs at most
one missed announcement. It never causes a flood of old posts.

## Run it on your machine

The bot needs Node 22 or later, Python 3, and Pillow.

```sh
cd bots/banger-bot
python3 -m pip install pillow
npm test

OCTOLENS_API_KEY=... DRY_RUN=true BANGER_BOT_IMAGE_DIR=./preview node src/index.js
```

A dry run draws the images into `./preview` and posts nothing. A dry run does
not write the state file, so a later run still posts the milestone.
