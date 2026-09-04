// Milestone logic for Banger Bot.
//
// These functions are pure. They do no network calls and no disk writes.
// Keep them pure, because the unit tests cover this file.

/**
 * Finds the thresholds that a tweet passed but the bot did not announce yet.
 *
 * @param {number} likes Current like count of the tweet.
 * @param {number[]} thresholds Milestones from the config file.
 * @param {number[]} announced Milestones that the bot announced before.
 * @returns {number[]} New milestones, in ascending order.
 */
export function newlyCrossedThresholds(likes, thresholds, announced = []) {
    const done = new Set(announced)
    return thresholds
        .filter((threshold) => likes >= threshold && !done.has(threshold))
        .sort((a, b) => a - b)
}

/**
 * Returns the largest number in a list.
 *
 * The bot announces one milestone for each tweet in each run. A tweet can pass
 * more than one threshold between two runs. In that case the bot announces the
 * largest threshold, and it marks the smaller ones as announced.
 *
 * @param {number[]} values
 * @returns {number|null} The largest value, or null if the list is empty.
 */
export function highestOf(values) {
    if (values.length === 0) {
        return null
    }
    return values.reduce((best, value) => (value > best ? value : best))
}
