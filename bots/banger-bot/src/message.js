// Slack message for Banger Bot.
//
// PLACEHOLDER. The editorial team designs the final message next.
//
// This file is the only place that decides how the message looks. Change this
// file to change the message. Do not put message text in the other files.
//
// To try a new design, run the workflow with the dry_run input set to true. The
// job log then prints the Block Kit payload, and the bot posts nothing. Paste
// the payload into https://app.slack.com/block-kit-builder to see it.

/**
 * Returns the public URL of a tweet.
 *
 * @param {string} handle The author handle, without the "@" character.
 * @param {string} tweetId The tweet id.
 * @returns {string}
 */
export function tweetUrl(handle, tweetId) {
    return `https://x.com/${handle}/status/${tweetId}`
}

/**
 * Builds the Slack payload for one milestone.
 *
 * @param {object} options
 * @param {object} options.tweet The tracked tweet. It holds handle, name,
 *   text, likes, reposts, replies, and createdAt.
 * @param {number} options.milestone The milestone that the tweet passed.
 * @returns {object} A Slack incoming webhook payload.
 */
export function renderBangerMessage({ tweet, milestone }) {
    const url = tweetUrl(tweet.handle, tweet.id)
    const author = tweet.name ? `${tweet.name} (@${tweet.handle})` : `@${tweet.handle}`
    const fallback = `${author} passed ${milestone.toLocaleString('en-US')} likes: ${url}`

    return {
        text: fallback,
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*${milestone.toLocaleString('en-US')} likes* for ${author}\n<${url}|View the post on X>`,
                },
            },
        ],
    }
}
