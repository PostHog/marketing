// Slack transport for Banger Bot.
//
// The bot posts through an incoming webhook. The webhook decides the channel,
// so the channel is not in this code. The webhook for this bot points to
// #team-editorial.

/**
 * Posts one payload to a Slack incoming webhook.
 *
 * @param {string} webhookUrl The webhook URL.
 * @param {object} payload The message payload.
 * @returns {Promise<void>}
 */
export async function postToSlack(webhookUrl, payload) {
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })

    if (!response.ok) {
        const body = await response.text()
        throw new Error(`Slack returned ${response.status}: ${body.slice(0, 200)}`)
    }
}
