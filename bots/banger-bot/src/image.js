// Image rendering for Banger Bot.
//
// The drawing runs in Python, because Pillow does the compositing that the
// meme overlays need. This module starts that script and returns the file path.
//
// The layout lives in render/banger_image.py. Change that file to change the
// image. Run it with --samples to review a change before you ship it.

import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(HERE, '..', 'render', 'banger_image.py')

function runRenderer(payload) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn('python3', [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] })
        let out = ''
        let err = ''
        child.stdout.on('data', (chunk) => (out += chunk))
        child.stderr.on('data', (chunk) => (err += chunk))
        child.on('error', reject)
        child.on('close', (code) => {
            if (code === 0) {
                resolvePromise(out.trim())
            } else {
                reject(new Error(`The renderer exited with code ${code}: ${err.trim().slice(0, 500)}`))
            }
        })
        child.stdin.end(payload)
    })
}

/**
 * Draws the image for one milestone.
 *
 * @param {object} options
 * @param {object} options.post The tracked post.
 * @param {number} options.milestone The milestone that the post passed.
 * @param {string} [options.directory] Where to write the file.
 * @returns {Promise<string>} The path of the PNG file.
 */
export async function renderPostImage({ post, milestone, directory }) {
    const out = join(directory || tmpdir(), `banger-${post.id}-${milestone}.png`)
    await runRenderer(JSON.stringify({ post, milestone, out }))
    return out
}
