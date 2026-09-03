// Client for the X API v2.
//
// The bot uses two endpoints:
//   1. GET /2/tweets/search/recent  finds new tweets from the watched accounts.
//   2. GET /2/tweets                refreshes the metrics of tracked tweets.
//
// One search request covers every watched account. This keeps the request count
// per run at two or three. See the README for the quota notes.

const API_ROOT = 'https://api.x.com/2'
const TWEET_FIELDS = 'created_at,public_metrics,author_id'
const LOOKUP_BATCH_SIZE = 100

export class RateLimitError extends Error {
    constructor(path, resetAt) {
        super(`X API rate limit reached on ${path}. The limit resets at ${resetAt || 'an unknown time'}.`)
        this.name = 'RateLimitError'
        this.resetAt = resetAt
    }
}

async function request(path, params, token) {
    const url = new URL(API_ROOT + path)
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value))
        }
    }

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })

    if (response.status === 429) {
        const reset = response.headers.get('x-rate-limit-reset')
        const resetAt = reset ? new Date(Number(reset) * 1000).toISOString() : null
        throw new RateLimitError(path, resetAt)
    }
    if (!response.ok) {
        const body = await response.text()
        throw new Error(`X API returned ${response.status} for ${path}: ${body.slice(0, 500)}`)
    }
    return response.json()
}

/**
 * Builds the search queries for the watched accounts.
 *
 * The X API limits the length of a query. This function splits the accounts
 * over more than one query when they do not fit in a single query.
 *
 * @param {string[]} handles Account handles, without the "@" character.
 * @param {number} maxLength Maximum length of one query.
 * @returns {string[]} One or more query strings.
 */
export function buildSearchQueries(handles, maxLength = 480) {
    const suffix = ' -is:retweet -is:reply'
    const queries = []
    let group = []

    const render = (items) => `(${items.map((handle) => `from:${handle}`).join(' OR ')})${suffix}`

    for (const handle of handles) {
        const candidate = [...group, handle]
        if (group.length > 0 && render(candidate).length > maxLength) {
            queries.push(render(group))
            group = [handle]
        } else {
            group = candidate
        }
    }
    if (group.length > 0) {
        queries.push(render(group))
    }
    return queries
}

/**
 * Reads the tweets that the watched accounts posted after sinceId.
 *
 * @param {object} options
 * @param {string} options.query One query from buildSearchQueries.
 * @param {string|undefined} options.sinceId Newest tweet id from the last run.
 * @param {number} options.maxResults Maximum tweets to return, from 10 to 100.
 * @param {string} options.token X API bearer token.
 * @returns {Promise<{tweets: object[], users: Map<string, object>}>}
 */
export async function searchRecentTweets({ query, sinceId, maxResults, token }) {
    const payload = await request(
        '/tweets/search/recent',
        {
            query,
            since_id: sinceId,
            max_results: Math.min(Math.max(maxResults, 10), 100),
            'tweet.fields': TWEET_FIELDS,
            expansions: 'author_id',
            'user.fields': 'username,name',
        },
        token
    )

    const users = new Map()
    for (const user of payload.includes?.users || []) {
        users.set(user.id, user)
    }
    return { tweets: payload.data || [], users }
}

/**
 * Reads the current metrics of tweets that the bot already tracks.
 *
 * @param {string[]} ids Tweet ids.
 * @param {string} token X API bearer token.
 * @returns {Promise<object[]>} Tweets. Deleted tweets are absent.
 */
export async function lookupTweets(ids, token) {
    const tweets = []
    for (let start = 0; start < ids.length; start += LOOKUP_BATCH_SIZE) {
        const batch = ids.slice(start, start + LOOKUP_BATCH_SIZE)
        const payload = await request('/tweets', { ids: batch.join(','), 'tweet.fields': TWEET_FIELDS }, token)
        tweets.push(...(payload.data || []))
    }
    return tweets
}
