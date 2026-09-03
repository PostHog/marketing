import assert from 'node:assert/strict'
import test from 'node:test'

import { highestOf, newlyCrossedThresholds } from '../src/milestones.js'
import { newestId, pruneTweets } from '../src/state.js'
import { buildSearchQueries } from '../src/x-api.js'

const THRESHOLDS = [250, 500, 1000, 3000]

test('a tweet below the first threshold crosses nothing', () => {
    assert.deepEqual(newlyCrossedThresholds(249, THRESHOLDS, []), [])
})

test('a tweet at a threshold crosses that threshold', () => {
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

test('one query holds every account when the accounts fit', () => {
    const queries = buildSearchQueries(['posthog', 'andyvan'], 480)
    assert.equal(queries.length, 1)
    assert.equal(queries[0], '(from:posthog OR from:andyvan) -is:retweet -is:reply')
})

test('a long account list splits over more than one query', () => {
    const handles = Array.from({ length: 40 }, (_, index) => `account${index}`)
    const queries = buildSearchQueries(handles, 200)
    assert.ok(queries.length > 1)
    for (const query of queries) {
        assert.ok(query.length <= 200, `query is too long: ${query.length}`)
    }
    const covered = queries.join(' ').match(/from:(\w+)/g).map((part) => part.slice(5))
    assert.deepEqual(covered, handles)
})

test('pruning removes tweets from outside the window', () => {
    const now = Date.parse('2026-09-03T12:00:00Z')
    const state = {
        tweets: {
            fresh: { createdAt: '2026-09-03T09:00:00Z' },
            old: { createdAt: '2026-08-20T09:00:00Z' },
            broken: { createdAt: 'not a date' },
        },
    }
    assert.equal(pruneTweets(state, 96, now), 2)
    assert.deepEqual(Object.keys(state.tweets), ['fresh'])
})

test('the newest id compares ids as large numbers', () => {
    assert.equal(newestId(['1929999999999999999', '1930000000000000000']), '1930000000000000000')
    assert.equal(newestId([]), undefined)
})
