// Client for the Octolens API v2.
//
// Octolens already collects mentions for PostHog, and it refreshes the public
// engagement counters on the posts that it holds. The bot reads those counters
// instead of the X API, so it needs no X API subscription.
//
// Octolens collects by keyword, and it matches the keyword against the post
// text. It has no author feed. A post therefore reaches the bot only when the
// post text matches a tracked keyword. Read the coverage section of the README.

const API_ROOT = 'https://app.octolens.com/api/v2'

export class RateLimitError extends Error {
    constructor(retryAfter) {
        super(`Octolens rate limit reached. Retry after ${retryAfter || 'an unknown number of'} seconds.`)
        this.name = 'RateLimitError'
        this.retryAfter = retryAfter
    }
}

async function request(path, params, apiKey) {
    const url = new URL(API_ROOT + path)
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value))
        }
    }

    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })

    if (response.status === 429) {
        throw new RateLimitError(response.headers.get('retry-after'))
    }
    if (!response.ok) {
        const body = await response.text()
        throw new Error(`Octolens returned ${response.status} for ${path}: ${body.slice(0, 300)}`)
    }
    return response.json()
}

/**
 * Converts an Octolens mention into the record that the state file holds.
 *
 * Octolens returns the engagement counters in an open map. The counter names
 * change with the platform, and Octolens omits a counter that it cannot read.
 * The function therefore defaults each counter to 0.
 *
 * @param {object} mention A mention from the Octolens API.
 * @returns {object} The tracked post record.
 */
export function toTrackedPost(mention) {
    const metrics = mention.engagementMetrics || {}
    return {
        id: mention.sourceId,
        handle: mention.author,
        name: mention.authorName || '',
        avatar: mention.authorAvatar || null,
        text: mention.body || '',
        url: mention.url,
        createdAt: mention.timestamp,
        likes: metrics.likes || 0,
        reposts: metrics.reposts || 0,
        replies: metrics.replies || 0,
        views: metrics.views || 0,
        observedAt: mention.engagementObservedAt || null,
        announced: [],
    }
}

/**
 * Reads the recent posts of one account.
 *
 * The endpoint returns the posts of that author that Octolens holds. It does
 * not read X directly, so it returns keyword matches only.
 *
 * @param {object} options
 * @param {string} options.handle The account handle, without the "@" character.
 * @param {string} options.source The platform name. Use "twitter" for X.
 * @param {number} options.limit Maximum posts to return, from 1 to 50.
 * @param {string} options.apiKey The Octolens API key.
 * @returns {Promise<object[]>} The mentions, newest first.
 */
export async function listPostsByAuthor({ handle, source, limit, apiKey }) {
    const payload = await request(
        '/mentions/by-author',
        {
            source,
            handle,
            limit: Math.min(Math.max(limit, 1), 50),
            includeEngagementMetrics: 'true',
        },
        apiKey
    )
    return payload.data || []
}
