'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const script = name => fs.readFileSync(path.join(root, 'addons', name), 'utf8');
const quiet = { info() {}, warn() {}, error() {} };

class Clock {
    constructor() {
        this.now = 100000;
        this.tasks = [];
        this.nextId = 0;
    }
    setTimeout(fn, delay = 0, interval = 0) {
        const task = {
            id: ++this.nextId, at: this.now + delay,
            fn, interval, cancelled: false
        };
        this.tasks.push(task);
        return task.id;
    }
    clearTimeout(id) {
        const task = this.tasks.find(item => item.id === id);
        if (task) task.cancelled = true;
    }
    async advance(ms) {
        const end = this.now + ms;
        let iterations = 0;
        while (true) {
            const next = this.tasks
                .filter(item => !item.cancelled && item.at <= end)
                .sort((a, b) => a.at - b.at)[0];
            if (!next) break;
            if (++iterations > 4000) throw new Error('timer runaway');
            this.now = next.at;
            if (next.interval) next.at += next.interval;
            else next.cancelled = true;
            next.fn();
            for (let i = 0; i < 20; i++) await Promise.resolve();
        }
        this.now = end;
        for (let i = 0; i < 20; i++) await Promise.resolve();
    }
    dateClass() {
        const clock = this;
        return class extends Date {
            static now() { return clock.now; }
        };
    }
}

function fakeWindow(clock) {
    const events = new Map();
    const window = {
        setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
        setInterval: (fn, ms) => clock.setTimeout(fn, ms, ms),
        clearTimeout: id => clock.clearTimeout(id),
        clearInterval: id => clock.clearTimeout(id),
        addEventListener(name, listener) {
            events.set(name, [...(events.get(name) || []), listener]);
        },
        dispatchEvent(event) {
            for (const fn of events.get(event.type) || []) fn(event);
        }
    };
    return window;
}

const FakeEvent = class {
    constructor(type, properties = {}) {
        this.type = type;
        Object.assign(this, properties);
    }
};

test('Twitch retains persistent rooms, JOINs and PARTs only deltas, keeps IRC control events', async () => {
    const clock = new Clock();
    const attrs = new Map();
    const window = fakeWindow(clock);
    const sent = [];
    class Socket {
        static OPEN = 1;
        constructor(url) {
            this.url = url;
            this.readyState = Socket.OPEN;
            this.listeners = new Map();
        }
        send(data) { sent.push({ data, at: clock.now }); }
        addEventListener(type, listener) {
            this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
        }
        removeEventListener() {}
        emit(type, event) {
            for (const listener of this.listeners.get(type) || []) listener(event);
        }
    }
    window.WebSocket = Socket;
    const document = {
        readyState: 'complete',
        documentElement: {
            getAttribute: name => attrs.get(name) ?? null,
            setAttribute: (name, value) => attrs.set(name, String(value)),
            appendChild() {}
        },
        head: { appendChild() {} },
        createElement: () => ({ style: {} }),
        getElementById: () => null,
        addEventListener() {}
    };
    const location = {
        hostname: 'www.twitch.tv',
        pathname: '/popout/alpha/chat',
        search: '?moth-generation=one&moth-channels=alpha,beta',
        href: 'https://www.twitch.tv/popout/alpha/chat?moth-generation=one&moth-channels=alpha,beta'
    };
    vm.runInNewContext(script('twitch-low-resource.user.js'), {
        window, document, location, URL, URLSearchParams,
        console: quiet, Date: clock.dateClass(),
        Event: FakeEvent, MessageEvent: FakeEvent
    });

    const socket = new window.WebSocket('wss://irc-ws.chat.twitch.tv:443');
    socket.send('PASS oauth:fake\r\nNICK test\r\nJOIN #alpha\r\n');
    await clock.advance(2500);
    assert.equal(sent.filter(x => x.data === 'JOIN #alpha').length, 1);
    assert.equal(sent.filter(x => x.data === 'JOIN #beta').length, 1);

    attrs.set('data-moth-twitch-desired', JSON.stringify(['beta', 'gamma']));
    window.dispatchEvent(new FakeEvent('moth-twitch-desired-changed'));
    await clock.advance(2000);
    assert.equal(sent.filter(x => x.data === 'PART #alpha').length, 1);
    assert.equal(sent.filter(x => x.data === 'JOIN #beta').length, 1);
    assert.equal(sent.filter(x => x.data === 'JOIN #gamma').length, 1);
    assert.equal(attrs.get('data-moth-twitch-irc-status'), 'ready');

    let received = '';
    socket.addEventListener('message', event => { received = event.data; });
    socket.emit('message', {
        data: ':alice PRIVMSG #beta :hello\r\nPING :tmi.twitch.tv\r\n:tmi.twitch.tv ROOMSTATE #beta\r\n'
    });
    assert.doesNotMatch(received, /PRIVMSG/);
    assert.match(received, /PING/);
    assert.match(received, /ROOMSTATE/);
    const times = sent.filter(x => x.data.startsWith('JOIN #')).map(x => x.at);
    for (let i = 1; i < times.length; i++) {
        assert.ok(times[i] - times[i - 1] >= 600, 'JOINs must respect Twitch pacing');
    }
});

test('game scans reuse a healthy tab across scans/reload and safely restart after stop', async () => {
    const clock = new Clock();
    const stored = new Map();
    const listeners = new Map();
    const opened = [];
    let live = ['alpha', 'beta'];
    const get = (key, fallback) => stored.has(key) ? stored.get(key) : fallback;
    const set = (key, value) => {
        const old = get(key, '');
        stored.set(key, value);
        if (old !== value)
            for (const fn of listeners.get(key) || []) fn(key, old, value);
    };
    const watch = (key, fn) => {
        listeners.set(key, [...(listeners.get(key) || []), fn]);
    };
    function load(hostname, query = '') {
        const window = fakeWindow(clock);
        let closed = false;
        window.close = () => { closed = true; };
        const attributes = new Map();
        const isApp = hostname === 'pokeidle.io';
        const document = {
            body: {},
            readyState: 'complete',
            documentElement: {
                getAttribute: key => attributes.get(key) ?? null,
                setAttribute: (key, val) => attributes.set(key, String(val))
            },
            getElementById: () => null,
            querySelector: selector => isApp && selector === '.menu-topo' ? {} : null,
            addEventListener() {}
        };
        const location = isApp
            ? { hostname, pathname: '/app', href: 'https://pokeidle.io/app', search: '' }
            : {
                hostname, pathname: '/popout/alpha/chat',
                href: 'https://www.twitch.tv/popout/alpha/chat' + query, search: query
            };
        const bridge = {
            streamStateSnapshot: () => ({
                twitch: { lives: live.map(login => ({ login })) },
                kick: { oficiais: [] }
            }),
            snapshot: () => ({ state: { twitch: { assistindoEm: [] } } })
        };
        vm.runInNewContext(script('stream-auto-open.user.js'), {
            window, document, location, console: quiet, URL, URLSearchParams,
            Event: FakeEvent, Date: clock.dateClass(),
            GM_getValue: get, GM_setValue: set, GM_addValueChangeListener: watch,
            GM_openInTab: url => {
                const tab = { url, closed: false, close() { this.closed = true; } };
                opened.push(tab);
                return tab;
            },
            unsafeWindow: { __mothControllerBridgeV1: bridge }
        });
        return { window, attributes, isClosed: () => closed };
    }

    load('pokeidle.io');
    await clock.advance(31000);
    assert.equal(opened.length, 1);
    const first = get('moth-twitch-chat-target-v2', '');
    set('moth-twitch-chat-active-v2', first);
    set('moth-twitch-chat-heartbeat-v3', JSON.stringify({
        generation: first, status: 'ready', updatedAt: clock.now
    }));
    await clock.advance(61000);
    assert.equal(opened.length, 1, 'healthy tab must not rotate');

    live = ['beta', 'gamma'];
    await clock.advance(61000);
    assert.equal(opened.length, 1, 'channel change must not open a tab');
    assert.equal(get('moth-twitch-chat-desired-v3'), '["beta","gamma"]');

    load('pokeidle.io');
    await clock.advance(31000);
    assert.equal(opened.length, 1, 'reload must reuse existing owner');

    live = [];
    await clock.advance(61000);
    assert.equal(opened.length, 1, 'transient empty list must not retire chat');
    await clock.advance(121000);
    assert.match(get('moth-twitch-chat-active-v2', ''), /^stop-/);

    live = ['alpha'];
    await clock.advance(61000);
    assert.equal(opened.length, 2);
    const second = get('moth-twitch-chat-target-v2', '');
    const popout = load('www.twitch.tv',
        '?moth-generation=' + second + '&moth-channels=alpha');
    assert.equal(popout.isClosed(), false, 'previous stop must not close candidate');
    popout.attributes.set('data-moth-twitch-irc-status', 'ready');
    popout.window.dispatchEvent(new FakeEvent('moth-twitch-irc-status'));
    assert.equal(get('moth-twitch-chat-active-v2'), second);
    assert.equal(JSON.parse(get('moth-twitch-chat-heartbeat-v3')).status, 'ready');
});
