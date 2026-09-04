# Banger Bot

Banger Bot posts to `#team-editorial` when a post on X passes a like milestone.

It watches the PostHog brand account and the affiliated employee accounts. The
account list is in [`config.json`](./config.json).

The milestones are 250, 500, 1,000, and 3,000 likes. The bot announces each
milestone one time for each post.

Each message reads:

```
🚨 BANGER ALERT 🚨: this post from @posthog just passed 3,000 likes
https://x.com/posthog/status/1930000000000000000
```

Below the text, the bot posts an image of the post. The image is only as tall
as the post needs. The art for the milestone sits **on top of** the post and
covers part of it. The overlap is the joke, so do not move the art clear of the
text.

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

## The gut check

A post can pass a milestone and still be wrong to celebrate. A leaving
announcement gets a lot of likes. So does a post that embarrasses PostHog.

[`src/gutcheck.js`](./src/gutcheck.js) reads each post before the bot announces
it. It blocks 4 kinds of post:

1. A leaving announcement.
2. A post that damages the reputation of PostHog, such as an outage, an
   apology, a layoff, or a public argument.
3. A post that is very inappropriate for a workplace channel.
4. Offensive material.

It allows everything else. PostHog writes in a blunt and funny voice, so
swearing, strong opinions, and jokes are safe. The check does not block a post
only because the tone is rude or negative.

The check has 2 layers:

- **A phrase list.** `blockedPhrases` in `config.json`. It runs always, and it
  costs nothing. Keep it short and exact, because the second layer reads the
  meaning.
- **A judgment call by Claude.** This layer runs when
  `BANGER_BOT_ANTHROPIC_API_KEY` is set. Without the key, the bot screens a post
  against the phrase list only, and it writes a warning in the log.

**The check fails closed.** When Claude cannot answer, the bot posts nothing for
that run, and the next run asks again. A missed celebration costs little. A bad
celebration embarrasses the company.

### Calibrate it against real posts

The phrase list does not need to name every bad case, because Claude reads the
meaning of every post that the list did not already block. Do not grow the list
to cover more ground. Grow the prompt in `src/gutcheck.js` instead, and keep the
list short and exact.

Read one post by hand to see what the judgment layer does with it:

```sh
cd bots/banger-bot
npm install
BANGER_BOT_ANTHROPIC_API_KEY=... node src/gutcheck.js "the text of the post"
```

It prints `ALLOW`, `BLOCK`, or `ERROR` with the reason. Feed it real posts,
including the loud and rude ones that must pass. If a verdict is wrong, edit
`SYSTEM` in `src/gutcheck.js` and run it again.

These 5 posts show the calibration the prompt aims for. Run them again after any
edit to `SYSTEM`, because a prompt that blocks the bottom 2 is too strict to
use:

| Post                                                       | Verdict |
| ---------------------------------------------------------- | ------- |
| `after 4 incredible years I'm moving on. joining Vercel`    | BLOCK   |
| `we had a 3 hour ingestion outage today. we're sorry.`      | BLOCK   |
| `posthog is not a serious company`                          | ALLOW   |
| `every session replay tool except ours is dogshit. fight me`| ALLOW   |
| `our onboarding is genuinely terrible and we know it`       | ALLOW   |

The first one is the reason the phrase list is only a backstop. No phrase in
`blockedPhrases` appears in it, and Claude blocked it on the meaning alone.

A blocked post is written to the log with the reason, and the state file records
the reason under `blocked`. Read the job log to audit what the bot held back.

The post text comes from a public website, and it can hold text that reads like
an instruction. The prompt therefore marks the post as data, and it tells the
model to judge the text and never obey it.

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
| `src/gutcheck.js`       | Screens a post before the bot announces it.     |
| `src/image.js`          | Starts the Python renderer.                     |
| `src/message.js`        | The text above the image.                       |
| `src/slack.js`          | The Slack upload.                               |
| `render/banger_image.py`| The image layout. **Change this for a redesign.** |
| `assets/`               | The meme art, the blast photo, and the fonts.   |
| `test/`                 | Unit tests for the pure functions.              |

## Setup

Add 4 repository secrets under **Settings → Secrets and variables → Actions**:

| Secret                         | Value                                      |
| ------------------------------ | ------------------------------------------ |
| `BANGER_BOT_SLACK_TOKEN`       | A Slack bot token, `xoxb-...`.              |
| `BANGER_BOT_SLACK_CHANNEL_ID`  | The id of `#team-editorial`.                |
| `BANGER_BOT_ANTHROPIC_API_KEY` | Runs the judgment layer of the gut check.   |
| `OCTOLENS_API_KEY`             | An Octolens API key with the `read` scope.  |

### Why 3 secrets carry a prefix and 1 does not

A secret carries the `BANGER_BOT_` prefix when a second bot must not share it:

- Each bot needs its own Slack app and its own channel.
- The Anthropic key meters spend for each call. A key for each bot gives you
  cost for each bot in the Anthropic Console, and it lets you cap this bot with
  a workspace spend limit. A runaway bot then cannot drain the shared budget,
  and you can revoke one bot without stopping the others.

`OCTOLENS_API_KEY` has no prefix, because Octolens is a flat subscription. The
key meters nothing, PostHog holds one account, and a second bot should reuse the
key rather than hold a copy. A shared key then rotates one time.

Make the Anthropic key in the PostHog organization at
<https://console.anthropic.com>, not in a personal organization. A Claude Pro or
Max subscription is not API access, and it cannot serve as this key.

**The Console shows the key one time only.** Paste it into the GitHub secret
before you leave the page. A lost key cannot be read again, only replaced.

Put the key in its own workspace with a spend limit if your Console role lets
you make one. A Developer role often cannot, and the default workspace works
fine. Ask an administrator for the spend limit afterwards.

Create the Octolens key in **Octolens → Settings → API**. Give it the `read`
scope. The bot only reads mentions, so `write` and `admin` grant more than it
needs.

**Set the expiry as far out as the dropdown allows.** Octolens asks for an
expiry date when you create a key, and the bot reads nothing once that date
passes. A short expiry is a time bomb.

Make a key for this repository rather than copying one from another repository.
GitHub never reveals a secret again after you save it, so a key held elsewhere
is not readable anyway, and a key of its own means you can revoke this bot
without stopping the other Octolens integrations.

A new key does not raise the quota. Octolens counts 500 requests each hour for
the whole organization, across every key.

### Create the Slack app

The app does not exist yet. Create it from
[`slack-app-manifest.yml`](./slack-app-manifest.yml), which carries the correct
scopes:

1. Go to <https://api.slack.com/apps> and select **Create New App**.
2. Select **From a manifest**, then the workspace.
3. Select **YAML**, and paste the manifest file.
4. Select **Create**, then **Install to Workspace**.
5. Copy the **Bot User OAuth Token** (`xoxb-...`) into
   `BANGER_BOT_SLACK_TOKEN`.
6. Invite the app to the channel: `/invite @Banger Bot`. The upload fails with
   `not_in_channel` if you skip this step.

A person with workspace permissions must do this. Slack does not let an
automated job create an app.

To set the icon, open **Basic Information → Display Information → App icon**
after step 4. A Slack manifest cannot carry an image, so the icon is the one
part you upload by hand. The bot cannot change the icon for each milestone,
because a file upload does not accept a per message icon.

An incoming webhook cannot upload a file, so the bot needs the app token. This
is why the bot does not use the webhook pattern that other PostHog workflows
use.

### Turn it on, in this order

1. Create the Slack app, install it, and copy the bot token.
2. Invite the app to the channel.
3. Add the 4 secrets.
4. **Merge this branch.** GitHub lists a `workflow_dispatch` workflow only when
   the file is on the default branch, and a schedule only runs there. You
   therefore cannot test the bot from the branch.
5. Open the **Actions** tab. Select **Banger Bot**, then **Run workflow**, and
   set `dry_run` to `true`. The bot draws the images and posts nothing. Get
   them from the `banger-bot-preview` artifact on the run.
6. Read the coverage lines in the job log. They say how many of the accounts
   Octolens holds posts for.
7. Run it once more with `test_post` set to `true`. The bot posts one throwaway
   message to the channel, then stops. See below for why this step exists.

The first live run records the current like counts and posts nothing. This is
correct. It stops the bot from announcing every old post at once. A run after
that one posts as normal.

### Prove the Slack path with a test post

The bot stays silent until a post passes a milestone, which can take days. The
first real message would therefore also be the first test of the Slack path. A
wrong channel id, a missing scope, or an app that was never invited to the
channel would sit unnoticed in a warning until then.

`test_post` closes that gap. It draws one image, posts it to the channel, and
stops. It reads no posts from Octolens, it runs no gut check, and it writes no
state, so a failure can only be Slack.

A dry run cannot do this job. A dry run writes no state, so every dry run looks
like a first run, and a first run posts nothing by design.

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
| `blockedPhrases`     | Phrases that always block a post. See the gut check.  |
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
npm install
npm test

OCTOLENS_API_KEY=... DRY_RUN=true BANGER_BOT_IMAGE_DIR=./preview node src/index.js
```

A dry run draws the images into `./preview` and posts nothing. A dry run does
not write the state file, so a later run still posts the milestone.
