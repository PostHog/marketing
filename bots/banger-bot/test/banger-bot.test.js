import assert from 'node:assert/strict'
import test from 'node:test'

import { blockedPhrase, gutCheck } from '../src/gutcheck.js'
import { highestOf, newlyCrossedThresholds } from '../src/milestones.js'
import { toTrackedPost } from '../src/octolens-api.js'
import { prunePosts } from '../src/state.js'

const THRESHOLDS = [250, 500, 1000, 3000]

test('a post below the first threshold crosses nothing', () => {
    assert.deepEqual(newlyCrossedThresholds(249, THRESHOLDS, []), [])
})

test('a post at a threshold crosses that threshold', () => {
    assert.deepEqual(newlyCrossedThresholds(250, THRESHOLDS, []), [250])
})

test('an announced threshold does not cross again', () => {
    assert.deepEqual(newlyCrossedThresholds(300, THRESHOLDS, [250]), [])
})

test('a large jump crosses every threshold that it passed', () => {
    assert.deepEqual(newlyCrossedThresholds(1200, THRESHOLDS, [250]), [500, 1000])
})

test('the bot announces the largest new threshold', () => {
    assert.equal(highestOf(newlyCrossedThresholds(1200, THRESHOLDS, [250])), 1000)
    assert.equal(highestOf([]), null)
})

test('an Octolens mention becomes a tracked post', () => {
    const post = toTrackedPost({
        id: 'octolens-1',
        sourceId: '1930000000000000000',
        url: 'https://x.com/posthog/status/1930000000000000000',
        body: 'we shipped a thing',
        author: 'posthog',
        authorName: 'PostHog',
        authorAvatar: 'https://example.test/avatar.png',
        timestamp: '2026-09-03T09:00:00Z',
        engagementMetrics: { likes: 412, reposts: 12, views: 90_000 },
        engagementObservedAt: '2026-09-03T11:00:00Z',
    })

    assert.equal(post.id, '1930000000000000000')
    assert.equal(post.handle, 'posthog')
    assert.equal(post.avatar, 'https://example.test/avatar.png')
    assert.equal(post.likes, 412)
    assert.equal(post.reposts, 12)
    assert.equal(post.views, 90_000)
    // Octolens omits a counter that it cannot read. It does not send a zero.
    assert.equal(post.replies, 0)
    assert.deepEqual(post.announced, [])
})

test('a mention without engagement metrics reads as zero likes', () => {
    const post = toTrackedPost({ sourceId: '1', author: 'posthog', timestamp: '2026-09-03T09:00:00Z' })
    assert.equal(post.likes, 0)
    assert.equal(post.observedAt, null)
})

const PHRASES = ['last day at posthog', 'leaving posthog']

test('the phrase list catches a leaving announcement', () => {
    const post = { text: 'Today is my Last Day At PostHog. Thanks for everything.' }
    assert.equal(blockedPhrase(post, PHRASES), 'last day at posthog')
})

test('the phrase list passes a normal post', () => {
    assert.equal(blockedPhrase({ text: 'we shipped a thing' }, PHRASES), null)
})

test('the gut check falls back to the phrase list without an API key', async () => {
    const clean = await gutCheck({ post: { text: 'we shipped a thing' }, phrases: PHRASES })
    assert.equal(clean.status, 'allow')

    const leaving = await gutCheck({ post: { text: 'leaving PostHog today' }, phrases: PHRASES })
    assert.equal(leaving.status, 'block')
})

test('pruning removes posts from outside the window', () => {
    const now = Date.parse('2026-09-03T12:00:00Z')
    const state = {
        posts: {
            fresh: { createdAt: '2026-09-03T09:00:00Z' },
            old: { createdAt: '2026-08-20T09:00:00Z' },
            broken: { createdAt: 'not a date' },
        },
    }
    assert.equal(prunePosts(state, 96, now), 2)
    assert.deepEqual(Object.keys(state.posts), ['fresh'])
})
