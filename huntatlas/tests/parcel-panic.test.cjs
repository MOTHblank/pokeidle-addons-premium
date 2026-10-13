'use strict';

// node --test tests/parcel-panic.test.cjs
// Runs the real self-contained userscript game functions, without a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const script = fs.readFileSync(
    path.join(__dirname, '..', 'hunt-atlas.user.js'), 'utf8'
);
const start = script.indexOf('    const ARCADE_WIDTH = 640;');
const end = script.indexOf(
    '    // ------------------------------------------------------------------\n    // UI\n', start
);
assert.ok(start >= 0 && end > start, 'Parcel Panic engine should be embedded');

function game(markers) {
    const storage = new Map();
    const state = {
        locationsBySlug: new Map(markers.map(row => [row.slug, row])),
        atlasEnabled: true,
        locationIndexStatus: 'ready'
    };
    const document = {hidden: false};
    let cancelled = 0;
    const sandbox = {
        state, document,
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value)
        },
        q: () => null,
        tr: key => key,
        requestAnimationFrame: () => 11,
        cancelAnimationFrame: () => { cancelled++; },
        isMapModalOpen: () => true
    };
    const api = vm.runInNewContext(
        script.slice(start, end) + '\n({arcade, arcadeRegions, ' +
        'arcadeProjectMarkers, arcadePrepare, arcadePickDestination, ' +
        'arcadeFrame, arcadeClose})',
        sandbox
    );
    return {api, state, storage, document, getCancelled: () => cancelled};
}

// Shape and coordinates copied from the published map-marker index.
const markers = [
    {slug: 'brave_blastoise', name: 'Brave Blastoise',
        area: 'outland', pixel: [175, 93]},
    {slug: 'tribal_feraligatr', name: 'Tribal Feraligatr',
        area: 'outland', pixel: [137, 54]},
    {slug: 'ancient_meganium', name: 'Ancient Meganium',
        area: 'outland', pixel: [211, 142]},
    {slug: 'cerulean', name: 'Cerulean',
        area: 'kanto', pixel: [589, 355]},
    {slug: 'pewter', name: 'Pewter',
        area: 'kanto', pixel: [785, 515]},
    {slug: 'viridian', name: 'Viridian',
        area: 'kanto', pixel: [215, 600]},
    {slug: 'test_orre_a', name: 'Orre A',
        area: 'orre', pixel: [30, 30]},
    {slug: 'test_orre_b', name: 'Orre B',
        area: 'orre', pixel: [200, 300]},
    {slug: 'test_orre_c', name: 'Orre C',
        area: 'orre', pixel: [400, 100]}
];

test('Outland takes priority; all indexed regions are independent', () => {
    const {api} = game(markers);
    assert.deepEqual(Array.from(api.arcadeRegions()), ['outland', 'kanto', 'orre']);
    for (const region of api.arcadeRegions()) {
        const projected = api.arcadeProjectMarkers(markers, region);
        assert.equal(projected.length, 3);
        assert.ok(projected.every(row =>
            row.x >= 32 && row.x <= 608 && row.y >= 32 && row.y <= 328));
        assert.ok(projected.every(row =>
            markers.find(source => source.slug === row.slug)?.area === region));
    }
});

test('unmapped data and collapsed coordinates do not break the projection', () => {
    const {api} = game(markers);
    assert.equal(api.arcadeProjectMarkers(markers, 'missing').length, 0);
    const allEqual = [
        {slug: 'a', name: 'A', area: 'tiny', pixel: [4, 4]},
        {slug: 'b', name: 'B', area: 'tiny', pixel: [4, 4]}
    ];
    assert.ok(api.arcadeProjectMarkers(allEqual, 'tiny').every(
        row => Number.isFinite(row.x) && Number.isFinite(row.y)));
});

test('a new delivery goes to a different hunt marker', () => {
    const {api} = game(markers);
    api.arcadePrepare('outland');
    assert.equal(api.arcade.ghosts.length, 2);
    assert.equal(api.arcade.hearts, 3);
    const first = api.arcade.destination.slug;
    assert.notEqual(api.arcadePickDestination().slug, first);
});

test('delivery awards time and persists a score for that region only', () => {
    const {api, storage} = game(markers);
    api.arcadePrepare('outland');
    api.arcade.open = true;
    api.arcade.canvas = {isConnected: true};
    api.arcade.context = null; // no DOM canvas needed to test model update
    api.arcade.ghosts = [];
    api.arcade.player.x = api.arcade.destination.x;
    api.arcade.player.y = api.arcade.destination.y;
    api.arcade.running = true;
    api.arcade.lastFrame = 1000;
    api.arcadeFrame(1100);
    assert.equal(api.arcade.score, 1);
    assert.ok(api.arcade.seconds > 60);
    assert.equal(storage.get('moth-hunt-atlas-parcel-panic-best-v1:outland'), '1');
    assert.equal(storage.has('moth-hunt-atlas-parcel-panic-best-v1:kanto'), false);
});

test('ghosts cost hearts and zero hearts stops the animation', () => {
    const {api, getCancelled} = game(markers);
    api.arcadePrepare('outland');
    api.arcade.open = true;
    api.arcade.canvas = {isConnected: true};
    api.arcade.hearts = 1;
    api.arcade.running = true;
    api.arcade.lastFrame = 1000;
    api.arcade.raf = 17;
    api.arcade.ghosts = [{
        x: api.arcade.player.x, y: api.arcade.player.y, phase: 0
    }];
    api.arcadeFrame(1100);
    assert.equal(api.arcade.hearts, 0);
    assert.equal(api.arcade.running, false);
    api.arcade.raf = 21;
    api.arcadeClose();
    assert.equal(api.arcade.open, false);
    assert.equal(api.arcade.raf, 0);
    assert.ok(getCancelled() > 0);
});

test('hidden tab pauses gameplay instead of consuming the timer', () => {
    const {api, document} = game(markers);
    api.arcadePrepare('outland');
    api.arcade.open = true;
    api.arcade.running = true;
    api.arcade.canvas = {isConnected: true};
    api.arcade.seconds = 38;
    document.hidden = true;
    api.arcadeFrame(1400);
    assert.equal(api.arcade.paused, true);
    assert.equal(api.arcade.running, false);
    assert.equal(api.arcade.seconds, 38);
});
