# Banger Bot

Banger Bot posts to `#team-editorial` when a tweet passes a like milestone.

It watches the PostHog brand account and the affiliated employee accounts. The
account list is in [`config.json`](./config.json).

The default milestones are 250, 500, 1,000, and 3,000 likes. The bot announces
each milestone one time for each tweet.

> **Status: scaffolding.** The pipeline works end to end. The Slack message is a
> placeholder. See [Design the message](#design-the-message).

## How it works

[`.github/workflows/banger-bot.yml`](../../.github/workflows/banger-bot.yml)
runs the bot every 2 hours. One run does 5 steps:

1. It removes tweets that are older than `trackWindowHours`.
2. It searches the X API for tweets that the accounts posted after the last run.
3. It reads the current like count of every tweet that it tracks.
4. It posts one Slack message for each tweet that passed a new milestone.
5. It writes the state file.

A tweet can pass two milestones between two runs. The bot then posts one message
for the largest milestone. It marks the smaller milestones as announced.

## Files

| File                 | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `config.json`        | Accounts, milestones, and the tracking window.    |
| `src/index.js`       | The run order. It calls the other modules.        |
| `src/x-api.js`       | The X API client and the search query builder.    |
| `src/state.js`       | The state file, the prune step, and the id order. |
| `src/milestones.js`  | The threshold logic. The unit tests cover it.     |
| `src/message.js`     | The Slack message. **Change this file only.**     |
| `src/slack.js`       | The webhook transport.                            |
| `test/`              | Unit tests for the pure functions.                |

## Setup

Add 2 repository secrets under **Settings → Secrets and variables → Actions**:

| Secret                         | Value                                        |
| ------------------------------ | -------------------------------------------- |
| `X_BEARER_TOKEN`               | A bearer token for the X API v2.              |
| `SLACK_WEBHOOK_TEAM_EDITORIAL` | An incoming webhook that posts to the channel. |

The webhook decides the channel. The bot code does not name a channel.

Then open the **Actions** tab. Select **Banger Bot**. Select **Run workflow**,
and set `dry_run` to `true`. The job log then prints the Slack payload.

### Check the account handles

The bot finds tweets by handle. A wrong handle returns no tweets, and the X API
reports no error. Check each handle in `config.json` against the live account
before you trust the bot. Update `config.json` when a person changes handle.

The brand account in `config.json` is `posthog`. Correct it if the brand account
uses a different handle.

## Cost

The X API charges for reads. The free tier cannot read tweets. The bot needs a
paid tier.

The design keeps the cost low:

- One search request covers every account, because the query uses `from:` for
  each handle. The bot does not use one request for each account.
- The search uses `since_id`, so it returns new tweets only.
- The bot stops watching a tweet after `trackWindowHours`. Engagement on a tweet
  is almost flat after a few days.

A run therefore makes 2 or 3 requests. The read cost of a run is close to the
count of tweets that the bot tracks.

Raise `trackWindowHours` or make the schedule more frequent only after you check
the read quota of your X API tier. Both changes raise the monthly read count.

## Configuration

`config.json` holds these keys:

| Key                  | Meaning                                              |
| -------------------- | ---------------------------------------------------- |
| `thresholds`         | The like milestones, in ascending order.              |
| `trackWindowHours`   | How long the bot watches a tweet. The default is 96.  |
| `maxNewTweetsPerRun` | The search page size, from 10 to 100.                 |
| `maxQueryLength`     | The query length limit of your X API tier.            |
| `accounts`           | The handles to watch, without the `@` character.      |

## State

The bot keeps the announced milestones in `.banger-bot-state/state.json`. GitHub
Actions holds this file in the Actions cache between runs.

A cache miss is safe. The bot then records the current like counts, and it posts
nothing for that run. The next run posts as normal. A cache miss costs at most
one missed announcement. It never causes a flood of old tweets.

## Run it on your machine

The bot needs Node 22 or later. It has no dependencies.

```sh
cd bots/banger-bot
npm test

X_BEARER_TOKEN=... DRY_RUN=true node src/index.js
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

The tracked tweet gives the message these fields: `id`, `handle`, `name`, `text`,
`createdAt`, `likes`, `reposts`, and `replies`.
