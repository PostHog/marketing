// State for Banger Bot.
//
// The bot must announce each milestone one time only. It keeps the tweets that
// it watches, and the milestones that it announced, in a small JSON file.
//
// GitHub Actions holds this file in the Actions cache between runs. A cache
// miss is safe. When the bot finds no previous state, it records the current
// like counts and it announces nothing. See seedTweet in index.js.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const STATE_VERSION = 1

export function emptyState() {
    return { version: STATE_VERSION, lastSearchId: undefined, tweets: {} }
}

/**
 * Reads the state file.
 *
 * The function returns an empty state when the file is absent, when the file is
 * not valid JSON, or when the file uses an older version. This makes a cache
 * miss and a format change safe.
 *
 * @param {string} path Path of the state file.
 * @returns {Promise<object>} The state.
 */
export async function loadState(path) {
    let raw
    try {
        raw = await readFile(path, 'utf8')
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error
        }
        return emptyState()
    }

    try {
        const state = JSON.parse(raw)
        if (state.version !== STATE_VERSION) {
            return emptyState()
        }
        state.tweets = state.tweets || {}
        return state
    } catch {
        return emptyState()
    }
}

export async function saveState(path, state) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/**
 * Removes tweets that are older than the tracking window.
 *
 * Engagement on a tweet is almost flat after a few days. The bot stops watching
 * old tweets to keep the API cost per run low.
 *
 * @param {object} state The state.
 * @param {number} windowHours Length of the tracking window in hours.
 * @param {number} now Current time in milliseconds.
 * @returns {number} The count of removed tweets.
 */
export function pruneTweets(state, windowHours, now = Date.now()) {
    const oldest = now - windowHours * 3_600_000
    let removed = 0
    for (const [id, tweet] of Object.entries(state.tweets)) {
        const createdAt = Date.parse(tweet.createdAt)
        if (Number.isNaN(createdAt) || createdAt < oldest) {
            delete state.tweets[id]
            removed += 1
        }
    }
    return removed
}

/**
 * Returns the largest tweet id.
 *
 * Tweet ids are numbers that are too large for the Number type. The function
 * compares them as BigInt values.
 *
 * @param {string[]} ids Tweet ids.
 * @returns {string|undefined} The largest id, or undefined for an empty list.
 */
export function newestId(ids) {
    let best
    for (const id of ids) {
        if (best === undefined || BigInt(id) > BigInt(best)) {
            best = id
        }
    }
    return best
}
