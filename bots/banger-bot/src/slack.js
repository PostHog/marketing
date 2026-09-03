// Slack transport for Banger Bot.
//
// The bot posts an image with each message, and an incoming webhook cannot
// upload a file. The bot therefore uses a Slack app token and the external
// upload endpoints. An upload takes 3 calls:
//
//   1. files.getUploadURLExternal    reserves a URL and a file id.
//   2. POST to that URL              sends the bytes.
//   3. files.completeUploadExternal  shares the file in the channel.
//
// The app needs the files:write and chat:write scopes. Invite the app to the
// channel first, or step 3 returns not_in_channel.

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const API_ROOT = 'https://slack.com/api'

async function callSlack(method, token, body, asJson = false) {
    const response = await fetch(`${API_ROOT}/${method}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': asJson
                ? 'application/json; charset=utf-8'
                : 'application/x-www-form-urlencoded; charset=utf-8',
        },
        body: asJson ? JSON.stringify(body) : new URLSearchParams(body),
    })

    if (!response.ok) {
        throw new Error(`Slack ${method} returned HTTP ${response.status}.`)
    }
    const payload = await response.json()
    if (!payload.ok) {
        throw new Error(`Slack ${method} failed: ${payload.error}`)
    }
    return payload
}

/**
 * Uploads one image to a Slack channel with a comment.
 *
 * @param {object} options
 * @param {string} options.token A Slack bot token.
 * @param {string} options.channelId The target channel id.
 * @param {string} options.imagePath The PNG file to upload.
 * @param {string} options.comment The message text above the image.
 * @param {string} options.title The file title.
 * @returns {Promise<void>}
 */
export async function postImageToSlack({ token, channelId, imagePath, comment, title }) {
    const bytes = await readFile(imagePath)
    const filename = basename(imagePath)

    const reserved = await callSlack('files.getUploadURLExternal', token, {
        filename,
        length: String(bytes.length),
    })

    const form = new FormData()
    form.append('file', new Blob([bytes], { type: 'image/png' }), filename)
    const upload = await fetch(reserved.upload_url, { method: 'POST', body: form })
    if (!upload.ok) {
        throw new Error(`The Slack upload returned HTTP ${upload.status}.`)
    }

    await callSlack(
        'files.completeUploadExternal',
        token,
        {
            files: [{ id: reserved.file_id, title }],
            channel_id: channelId,
            initial_comment: comment,
        },
        true
    )
}
