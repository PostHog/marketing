#!/usr/bin/env node
//
// Banger Bot.
//
// The bot watches the X accounts in config.json. It posts to #team-editorial
// when a tweet passes a like milestone. Read the README for the setup steps.
//
// One run does this:
//   1. Removes tweets that are outside the tracking window.
//   2. Searches for tweets that the accounts posted after the last run.
//   3. Refreshes the like counts of the tweets that it already tracks.
//   4. Posts one Slack message for each tweet that passed a new milestone.
//   5. Writes the state file.

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { highestOf, newlyCrossedThresholds } from './milestones.js'
import { renderBangerMessage } from './message.js'
import { postToSlack } from './slack.js'
import { loadState, newestId, pruneTweets, saveState } from './state.js'
import { buildSearchQueries, lookupTweets, RateLimitError, searchRecentTweets } from './x-api.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CONFIG = resolve(HERE, '..', 'config.json')
const DEFAULT_STATE = resolve(HERE, '..', '..', '..', '.banger-bot-state', 'state.json')

const log = {
    info: (message) => console.log(message),
    warn: (message) => console.log(`::warning::${message}`),
    error: (message) => console.log(`::error::${message}`),
}

/**
 * Converts an X API tweet into the record that the state file holds.
 *
 * @param {object} tweet A tweet from the X API.
 * @param {Map<string, object>} users The authors from the same response.
 * @returns {object} The tracked tweet record.
 */
function toTrackedTweet(tweet, users) {
    const author = users.get(tweet.author_id)
    const metrics = tweet.public_metrics || {}
    return {
        id: tweet.id,
        handle: author?.username || 'unknown',
        name: author?.name || '',
        text: tweet.text || '',
        createdAt: tweet.created_at,
        likes: metrics.like_count || 0,
        reposts: metrics.retweet_count || 0,
        replies: metrics.reply_count || 0,
        announced: [],
    }
}

async function main() {
    const token = process.env.X_BEARER_TOKEN
    const webhookUrl = process.env.SLACK_WEBHOOK_TEAM_EDITORIAL
    const dryRun = process.env.DRY_RUN === 'true'
    const configPath = process.env.BANGER_BOT_CONFIG || DEFAULT_CONFIG
    const statePath = process.env.BANGER_BOT_STATE || DEFAULT_STATE

    if (!token) {
        throw new Error('X_BEARER_TOKEN is not set.')
    }
    if (!webhookUrl && !dryRun) {
        throw new Error('SLACK_WEBHOOK_TEAM_EDITORIAL is not set. Set DRY_RUN to true to run without Slack.')
    }

    const config = JSON.parse(await readFile(configPath, 'utf8'))
    const state = await loadState(statePath)
    const now = Date.now()

    // A run without previous state must not post old tweets to Slack. The bot
    // records the current like counts, and it announces nothing.
    const isFirstRun = state.lastSearchId === undefined
    if (isFirstRun) {
        log.info('No previous state found. This run records the current like counts and posts nothing.')
    }

    const pruned = pruneTweets(state, config.trackWindowHours, now)
    if (pruned > 0) {
        log.info(`Removed ${pruned} tweet(s) from outside the ${config.trackWindowHours} hour window.`)
    }

    // ── 1. Find new tweets ────────────────────────────────────────────────
    const queries = buildSearchQueries(config.accounts, config.maxQueryLength)
    const discovered = []
    let searchFailed = false

    for (const query of queries) {
        try {
            const { tweets, users } = await searchRecentTweets({
                query,
                sinceId: state.lastSearchId,
                maxResults: config.maxNewTweetsPerRun,
                token,
            })
            for (const tweet of tweets) {
                discovered.push(toTrackedTweet(tweet, users))
            }
        } catch (error) {
            // One failed query must not stop the run. The bot does not move
            // lastSearchId, so the next run reads the same range again.
            searchFailed = true
            log.warn(`Search failed: ${error.message}`)
        }
    }
    log.info(`Found ${discovered.length} new tweet(s).`)

    for (const tweet of discovered) {
        const known = state.tweets[tweet.id]
        state.tweets[tweet.id] = known ? { ...known, ...tweet, announced: known.announced } : tweet
    }

    if (!searchFailed) {
        const newest = newestId(discovered.map((tweet) => tweet.id))
        if (newest) {
            state.lastSearchId = newest
        }
    }

    // ── 2. Refresh the tweets that the bot already tracks ─────────────────
    const discoveredIds = new Set(discovered.map((tweet) => tweet.id))
    const staleIds = Object.keys(state.tweets).filter((id) => !discoveredIds.has(id))

    if (staleIds.length > 0) {
        const refreshed = await lookupTweets(staleIds, token)
        const seen = new Set()
        for (const tweet of refreshed) {
            const tracked = state.tweets[tweet.id]
            if (!tracked) {
                continue
            }
            seen.add(tweet.id)
            const metrics = tweet.public_metrics || {}
            tracked.likes = metrics.like_count || 0
            tracked.reposts = metrics.retweet_count || 0
            tracked.replies = metrics.reply_count || 0
        }
        // The X API omits a tweet that the author deleted or made private.
        for (const id of staleIds) {
            if (!seen.has(id)) {
                delete state.tweets[id]
            }
        }
        log.info(`Refreshed ${seen.size} tracked tweet(s).`)
    }

    // ── 3. Announce the new milestones ────────────────────────────────────
    let posted = 0
    for (const tweet of Object.values(state.tweets)) {
        const crossed = newlyCrossedThresholds(tweet.likes, config.thresholds, tweet.announced)
        if (crossed.length === 0) {
            continue
        }

        // Mark every new milestone, and announce the largest one. A tweet that
        // passes two thresholds between runs gets one message, not two.
        tweet.announced = [...tweet.announced, ...crossed].sort((a, b) => a - b)
        const milestone = highestOf(crossed)

        if (isFirstRun) {
            continue
        }

        const payload = renderBangerMessage({ tweet, milestone })
        if (dryRun) {
            log.info(`Dry run. Payload for @${tweet.handle} at ${milestone} likes:`)
            log.info(JSON.stringify(payload, null, 2))
            continue
        }

        try {
            await postToSlack(webhookUrl, payload)
            posted += 1
            log.info(`Posted @${tweet.handle} ${tweet.id} at ${milestone} likes.`)
        } catch (error) {
            // Keep the milestone unannounced, so the next run tries again.
            tweet.announced = tweet.announced.filter((value) => !crossed.includes(value))
            log.warn(`Slack post failed for ${tweet.id}: ${error.message}`)
        }
    }

    log.info(`Tracking ${Object.keys(state.tweets).length} tweet(s). Posted ${posted} message(s).`)

    // A dry run must not record milestones. If it did, the next real run would
    // skip them, and the message would never reach Slack.
    if (dryRun) {
        log.info('Dry run. The bot did not write the state file.')
        return
    }
    await saveState(statePath, state)
}

main().catch((error) => {
    if (error instanceof RateLimitError) {
        // A rate limit is temporary. The next run reads the same range again.
        log.warn(error.message)
        process.exit(0)
    }
    log.error(error.stack || error.message)
    process.exit(1)
})
