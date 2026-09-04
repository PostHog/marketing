// Slack message text for Banger Bot.
//
// The image carries the design. This file writes the short line above it.
// Change this file to change the wording. The picture itself is drawn in
// render/banger_image.py.

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
 * Writes the comment that sits above the image.
 *
 * @param {object} options
 * @param {object} options.post The tracked post.
 * @param {number} options.milestone The milestone that the post passed.
 * @returns {string}
 */
export function renderBangerComment({ post, milestone }) {
    const likes = milestone.toLocaleString('en-US')
    return `🚨 BANGER ALERT 🚨: this post from @${post.handle} just passed ${likes} likes\n${postUrl(post)}`
}

/**
 * Writes the file title that Slack shows on the image.
 *
 * @param {object} options
 * @param {object} options.post The tracked post.
 * @param {number} options.milestone The milestone that the post passed.
 * @returns {string}
 */
export function bangerTitle({ post, milestone }) {
    return `@${post.handle} at ${milestone.toLocaleString('en-US')} likes`
}
