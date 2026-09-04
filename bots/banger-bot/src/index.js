#!/usr/bin/env node
//
// Banger Bot.
//
// The bot watches the X accounts in config.json. It posts to #team-editorial
// when a post passes a like milestone. Read the README for the setup steps.
//
// The bot reads the engagement counters from Octolens, not from the X API.
// Octolens collects by keyword, so it does not hold every post from these
// accounts. Each run logs a coverage line, so the gap stays visible.
//
// One run does this:
//   1. Reads the recent posts of each account from Octolens.
//   2. Keeps the posts that are inside the tracking window.
//   3. Posts one Slack message for each post that passed a new milestone.
//   4. Logs the coverage and the age of the engagement data.
//   5. Writes the state file.

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { gutCheck } from './gutcheck.js'
import { renderPostImage } from './image.js'
import { highestOf, newlyCrossedThresholds } from './milestones.js'
import { bangerTitle, renderBangerComment } from './message.js'
import { listPostsByAuthor, RateLimitError, toTrackedPost } from './octolens-api.js'
import { loadState, prunePosts, saveState } from './state.js'
import { postImageToSlack } from './slack.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CONFIG = resolve(HERE, '..', 'config.json')
const DEFAULT_STATE = resolve(HERE, '..', '..', '..', '.banger-bot-state', 'state.json')

const log = {
    info: (message) => console.log(message),
    warn: (message) => console.log(`::warning::${message}`),
    error: (message) => console.log(`::error::${message}`),
}

const minutesSince = (timestamp, now) => Math.round((now - Date.parse(timestamp)) / 60_000)

/**
 * Reports how much of our own output Octolens actually holds.
 *
 * Octolens collects by keyword. A post that does not match a keyword never
 * reaches the bot, and the bot cannot see that the post exists. These lines
 * make the gap visible, so the team can judge whether Octolens is enough.
 *
 * @param {object[]} posts The posts inside the tracking window.
 * @param {string[]} accounts The configured accounts.
 * @param {number} windowHours Length of the tracking window in hours.
 * @param {number} now Current time in milliseconds.
 */
function logCoverage(posts, accounts, windowHours, now) {
    const handles = new Set(posts.map((post) => post.handle.toLowerCase()))
    log.info(
        `Coverage: ${posts.length} post(s) inside the ${windowHours} hour window, ` +
            `from ${handles.size} of ${accounts.length} account(s).`
    )

    const silent = accounts.filter((handle) => !handles.has(handle.toLowerCase()))
    if (silent.length > 0) {
        log.info(`No posts in the window from: ${silent.map((handle) => `@${handle}`).join(', ')}.`)
    }

    // Octolens does not document how often it refreshes the counters. This line
    // shows whether the 2 hour schedule reads fresh numbers or repeats old ones.
    const ages = posts.map((post) => post.observedAt).filter(Boolean).map((at) => minutesSince(at, now))
    if (ages.length > 0) {
        log.info(`Engagement observed between ${Math.min(...ages)} and ${Math.max(...ages)} minute(s) ago.`)
    } else if (posts.length > 0) {
        log.warn('Octolens returned no engagement timestamps. The like counts may be stale.')
    }
}

async function main() {
    const apiKey = process.env.OCTOLENS_API_KEY
    const slackToken = process.env.BANGER_BOT_SLACK_TOKEN
    const channelId = process.env.BANGER_BOT_SLACK_CHANNEL_ID
    const anthropicKey = process.env.BANGER_BOT_ANTHROPIC_API_KEY
    const dryRun = process.env.DRY_RUN === 'true'
    const configPath = process.env.BANGER_BOT_CONFIG || DEFAULT_CONFIG
    const statePath = process.env.BANGER_BOT_STATE || DEFAULT_STATE
    const imageDir = process.env.BANGER_BOT_IMAGE_DIR

    if (!apiKey) {
        throw new Error('OCTOLENS_API_KEY is not set.')
    }
    if (!dryRun && !(slackToken && channelId)) {
        throw new Error(
            'BANGER_BOT_SLACK_TOKEN and BANGER_BOT_SLACK_CHANNEL_ID must both be set. ' +
                'Set DRY_RUN to true to run without Slack.'
        )
    }

    const config = JSON.parse(await readFile(configPath, 'utf8'))
    const state = await loadState(statePath)
    const now = Date.now()
    const oldest = now - config.trackWindowHours * 3_600_000

    // A run without previous state must not post old milestones to Slack. The
    // bot records the current like counts, and it announces nothing.
    const isFirstRun = state.seeded !== true
    if (isFirstRun) {
        log.info('No previous state found. This run records the current like counts and posts nothing.')
    }

    // ── 1. Read the recent posts of each account ──────────────────────────
    const current = []
    const truncated = []
    let failures = 0

    for (const handle of config.accounts) {
        try {
            const mentions = await listPostsByAuthor({
                handle,
                source: config.source,
                limit: config.maxPostsPerAccount,
                apiKey,
            })
            const posts = mentions.map(toTrackedPost).filter((post) => Date.parse(post.createdAt) >= oldest)
            current.push(...posts)

            // Octolens returns the newest posts first. A full page of posts that
            // all sit inside the window means that the bot may miss older ones.
            if (mentions.length >= config.maxPostsPerAccount && posts.length === mentions.length) {
                truncated.push(handle)
            }
        } catch (error) {
            if (error instanceof RateLimitError) {
                throw error
            }
            // One failed account must not stop the run.
            failures += 1
            log.warn(`Could not read @${handle}: ${error.message}`)
        }
    }

    // Every account failing is one problem, not many: the key is dead, or
    // Octolens is down. Fail the job so the run goes red. A warning on its own
    // leaves a green tick on a bot that read nothing, and nobody looks.
    if (failures > 0 && failures === config.accounts.length) {
        throw new Error(
            `Could not read any of the ${failures} account(s). Check that OCTOLENS_API_KEY ` +
                'is set, is valid, and has not passed its expiry date.'
        )
    }

    if (truncated.length > 0) {
        log.warn(
            `Reached the page limit for: ${truncated.map((handle) => `@${handle}`).join(', ')}. ` +
                'Raise maxPostsPerAccount or lower trackWindowHours in config.json.'
        )
    }

    // ── 2. Merge the posts into the state ─────────────────────────────────
    for (const post of current) {
        const known = state.posts[post.id]
        state.posts[post.id] = known ? { ...known, ...post, announced: known.announced } : post
    }
    prunePosts(state, config.trackWindowHours, now)

    logCoverage(current, config.accounts, config.trackWindowHours, now)

    // ── 3. Announce the new milestones ────────────────────────────────────
    if (!anthropicKey) {
        log.warn('BANGER_BOT_ANTHROPIC_API_KEY is not set. The gut check runs on the phrase list only.')
    }

    let posted = 0
    let held = 0
    for (const post of Object.values(state.posts)) {
        const crossed = newlyCrossedThresholds(post.likes, config.thresholds, post.announced)
        if (crossed.length === 0) {
            continue
        }

        if (isFirstRun) {
            post.announced = [...post.announced, ...crossed].sort((a, b) => a - b)
            continue
        }

        // A post can pass a milestone and still be wrong to celebrate.
        const check = await gutCheck({ post, phrases: config.blockedPhrases, apiKey: anthropicKey })
        if (check.status === 'error') {
            // An error is not permission. Nothing is marked, so the next run
            // asks again.
            log.warn(`No verdict for ${post.id}, so the bot held it back. ${check.reason}`)
            continue
        }
        if (check.status === 'block') {
            // Mark every milestone, so the bot never asks about this post again.
            post.blocked = check.reason
            post.announced = [...config.thresholds]
            held += 1
            log.warn(`Held back @${post.handle} ${post.id}. ${check.reason}`)
            continue
        }

        // Mark every new milestone, and announce the largest one. A post that
        // passes two thresholds between runs gets one message, not two.
        post.announced = [...post.announced, ...crossed].sort((a, b) => a - b)
        const milestone = highestOf(crossed)

        try {
            const imagePath = await renderPostImage({ post, milestone, directory: imageDir })
            const comment = renderBangerComment({ post, milestone })

            if (dryRun) {
                log.info(`Dry run. @${post.handle} at ${milestone} likes: ${imagePath}`)
                log.info(`Comment: ${comment}`)
                continue
            }

            await postImageToSlack({
                token: slackToken,
                channelId,
                imagePath,
                comment,
                title: bangerTitle({ post, milestone }),
            })
            posted += 1
            log.info(`Posted @${post.handle} ${post.id} at ${milestone} likes.`)
        } catch (error) {
            // Keep the milestone unannounced, so the next run tries again.
            post.announced = post.announced.filter((value) => !crossed.includes(value))
            log.warn(`Could not post ${post.id}: ${error.message}`)
        }
    }

    log.info(
        `Tracking ${Object.keys(state.posts).length} post(s). ` +
            `Posted ${posted} message(s). The gut check held back ${held} post(s).`
    )
    if (failures > 0) {
        log.warn(`${failures} account(s) could not be read.`)
    }

    // A dry run must not record milestones. If it did, the next real run would
    // skip them, and the message would never reach Slack.
    if (dryRun) {
        log.info('Dry run. The bot did not write the state file.')
        return
    }

    state.seeded = true
    await saveState(statePath, state)
}

main().catch((error) => {
    if (error instanceof RateLimitError) {
        // A rate limit is temporary. The next run reads the same accounts again.
        log.warn(error.message)
        process.exit(0)
    }
    log.error(error.stack || error.message)
    process.exit(1)
})
