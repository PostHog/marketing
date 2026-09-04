// State for Banger Bot.
//
// The bot must announce each milestone one time only. It keeps the posts that
// it watches, and the milestones that it announced, in a small JSON file.
//
// GitHub Actions holds this file in the Actions cache between runs. A cache
// miss is safe. When the bot finds no previous state, it records the current
// like counts and it announces nothing. See the seed step in index.js.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const STATE_VERSION = 2

export function emptyState() {
    return { version: STATE_VERSION, seeded: false, posts: {} }
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
        state.posts = state.posts || {}
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
 * Removes posts that are older than the tracking window.
 *
 * Engagement on a post is almost flat after a few days. The bot stops watching
 * an old post to keep the request count per run low.
 *
 * @param {object} state The state.
 * @param {number} windowHours Length of the tracking window in hours.
 * @param {number} now Current time in milliseconds.
 * @returns {number} The count of removed posts.
 */
export function prunePosts(state, windowHours, now = Date.now()) {
    const oldest = now - windowHours * 3_600_000
    let removed = 0
    for (const [id, post] of Object.entries(state.posts)) {
        const createdAt = Date.parse(post.createdAt)
        if (Number.isNaN(createdAt) || createdAt < oldest) {
            delete state.posts[id]
            removed += 1
        }
    }
    return removed
}
