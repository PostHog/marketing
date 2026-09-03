# Banger Bot

Banger Bot posts to `#team-editorial` when a post on X passes a like milestone.

It watches the PostHog brand account and the affiliated employee accounts. The
account list is in [`config.json`](./config.json).

The default milestones are 250, 500, 1,000, and 3,000 likes. The bot announces
each milestone one time for each post.

> **Status: scaffolding.** The pipeline works end to end. The Slack message is a
> placeholder. See [Design the message](#design-the-message).

## Where the numbers come from

The bot reads the like counts from **Octolens**, not from the X API. PostHog
already pays for Octolens, and Octolens already feeds `#brand-mentions`. The bot
therefore adds no vendor cost.

Octolens refreshes the public engagement counters on the posts that it holds.
Each post carries an `engagementMetrics` map and an `engagementObservedAt` time.
The bot reads `likes` from that map.

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
No posts in the window from: @minchev, @yo_puaaa, ...
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
3. It posts one Slack message for each post that passed a new milestone.
4. It logs the coverage and the age of the engagement data.
5. It writes the state file.

A post can pass two milestones between two runs. The bot then posts one message
for the largest milestone. It marks the smaller milestones as announced.

One run makes one request for each account. The Octolens limit is 500 requests
each hour for the whole organization, and the bot uses about 72 each day. Other
PostHog automations share that limit.

## Files

| File                   | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `config.json`          | Accounts, milestones, and the tracking window.    |
| `src/index.js`         | The run order. It calls the other modules.        |
| `src/octolens-api.js`  | The Octolens client and the mention mapping.      |
| `src/state.js`         | The state file and the prune step.                |
| `src/milestones.js`    | The threshold logic. The unit tests cover it.     |
| `src/message.js`       | The Slack message. **Change this file only.**     |
| `src/slack.js`         | The webhook transport.                            |
| `test/`                | Unit tests for the pure functions.                |

## Setup

Add 2 repository secrets under **Settings → Secrets and variables → Actions**:

| Secret                         | Value                                          |
| ------------------------------ | ---------------------------------------------- |
| `OCTOLENS_API_KEY`             | An Octolens API key with the `read` scope.      |
| `SLACK_WEBHOOK_TEAM_EDITORIAL` | An incoming webhook that posts to the channel.  |

Create the Octolens key in **Octolens → Settings → API keys**. The webhook
decides the Slack channel, so the bot code does not name a channel.

Then open the **Actions** tab. Select **Banger Bot**. Select **Run workflow**,
and set `dry_run` to `true`. The job log then prints the Slack payload.

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

The bot needs Node 22 or later. It has no dependencies.

```sh
cd bots/banger-bot
npm test

OCTOLENS_API_KEY=... DRY_RUN=true node src/index.js
```

A dry run prints the payload, and it posts nothing. A dry run does not write the
state file, so a later run still posts the milestone.

## Design the message

`src/message.js` builds the Slack payload. It is the only file that decides how
the message looks.

To try a design:

1. Edit `renderBangerMessage` in `src/message.js`.
2. Run the workflow with `dry_run` set to `true`.
3. Copy the payload from the job log.
4. Paste the payload into the [Block Kit Builder](https://app.slack.com/block-kit-builder).

The tracked post gives the message these fields: `id`, `handle`, `name`, `text`,
`url`, `createdAt`, `likes`, `reposts`, `replies`, and `views`.
