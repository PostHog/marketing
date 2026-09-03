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
 * Returns the public URL of a post.
 *
 * Octolens gives a canonical URL for each post. This function builds the URL
 * for the rare record that has none.
 *
 * @param {object} post The tracked post.
 * @returns {string}
 */
export function postUrl(post) {
    return post.url || `https://x.com/${post.handle}/status/${post.id}`
}

/**
 * Builds the Slack payload for one milestone.
 *
 * @param {object} options
 * @param {object} options.post The tracked post. It holds id, handle, name,
 *   text, url, createdAt, likes, reposts, replies, and views.
 * @param {number} options.milestone The milestone that the post passed.
 * @returns {object} A Slack incoming webhook payload.
 */
export function renderBangerMessage({ post, milestone }) {
    const url = postUrl(post)
    const author = post.name ? `${post.name} (@${post.handle})` : `@${post.handle}`
    const likes = milestone.toLocaleString('en-US')
    const fallback = `${author} passed ${likes} likes: ${url}`

    return {
        text: fallback,
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*${likes} likes* for ${author}\n<${url}|View the post on X>`,
                },
            },
        ],
    }
}
