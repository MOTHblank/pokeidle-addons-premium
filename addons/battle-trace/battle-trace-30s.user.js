// ==UserScript==
// @name         PokéIdle Battle Trace (30s, diagnostic)
// @namespace    moth.pokeidle.diagnostics
// @author       MOTHblank
// @version      0.1.0
// @description  Read-only 30-second battle timing/XP capture; local JSON export for Hunt Atlas diagnostics.
// @match        https://pokeidle.io/app*
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const DURATION_MS = 30000;
    const MAX_EVENTS = 5000;
    const MAX_STATES = 90;
    const NUM_KEYS = ['dano','ef','hpAlvo','hpAntes','hp','maxHp','hpMax',
        'level','nivel','speciesId','pokeId','xpTreinador','xpPokemon','xp',
        'power','cooldownMs','cd','tempo','duracao','velocidade','raio'];
    const EVENT_KINDS = new Set(['spawn','ataque','morte','despawn','corpoExpirado',
        'cura','revive','troca','bossMorto']);
    const model = {
        phase: 'idle', started: 0, timer: null, clock: null,
        rows: [], stateRows: [], report: null, warning: '', status: '',
        packets: 0, battlePackets: 0, statePackets: 0, welcomePackets: 0,
        droppedRows: 0, counts: {}, keys: {}, sockets: 0, gameSockets: 0,
        pokemon: new Map(), huntCatalog: new Map(), activeId: null,
        activeConfirmed: false, lastActiveId: null, huntSlug: null,
        previousStateKey: '', leadRefs: new Map(), slotRefs: new Map(),
        castRefs: new Map(), pending: [], playerLevel: null,
        packetNo: 0, wrapped: false, eventSources: new Set(), bonuses: {}
    };
    const own = (obj, key) => Boolean(obj && Object.prototype.hasOwnProperty.call(obj, key));
    const finite = value => typeof value === 'number' && Number.isFinite(value)
        ? value : null;
    const id = value => {
        const v = Number(value);
        return Number.isSafeInteger(v) && v >= 0 ? v : null;
    };
    const safeEnum = (v, choices) => typeof v === 'string' && choices.includes(v)
        ? v : null;
    const relative = at => Math.max(0, Math.round(at - model.started));
    const compact = (data, keys = NUM_KEYS) => {
        const out = {};
        if (!data || typeof data !== 'object') return out;
        for (const key of keys) {
            const number = finite(data[key]);
            if (number !== null) out[key] = number;
        }
        return out;
    };
    function recordKeyCounts(target, obj) {
        if (!obj || typeof obj !== 'object') return;
        for (const key of Object.keys(obj).slice(0, 80)) {
            // Field *names* only. No raw packet values, user text or tokens.
            if (!/^[\w-]{1,48}$/.test(key)) continue;
            target[key] = (target[key] || 0) + 1;
        }
    }
    function token(refs, value, prefix, max = 500) {
        if (value === null || value === undefined) return null;
        const key = String(value);
        if (!key.length || key.length > 80) return null;
        if (!refs.has(key)) {
            if (refs.size >= max) return null;
            refs.set(key, prefix + String(refs.size + 1));
        }
        return refs.get(key);
    }
    function abilityName(value) {
        if (typeof value !== 'string' || value.length > 65 ||
            !/^[\p{L}\p{M}\p{N} .'+-]+$/u.test(value)) return null;
        return value.trim() || null;
    }
    function moveName(event) {
        const fields = [event?.golpe?.name,event?.golpe?.nome,
            event?.movimento?.name,event?.movimento?.nome,
            event?.golpe,event?.nomeGolpe,event?.golpeNome,
            event?.moveName,event?.move,event?.ataqueNome,
            event?.ataque?.name,event?.ataque?.nome,
            typeof event?.ataque === 'string' ? event.ataque : null];
        for (const f of fields) {
            const value = abilityName(f);
            if (value) return value;
        }
        return null; // event.nome can be a Pokémon nickname; never export it.
    }
    function castRef(event) {
        const keys = [event?.castId,event?.castID,event?.cast_id,
            event?.attackCastId,event?.execucaoId,event?.execucaoGolpeId,
            event?.idExecucao,event?.ataque?.castId,event?.golpe?.castId];
        for (const value of keys) {
            if (value !== undefined && value !== null)
                return token(model.castRefs, value, 'C');
        }
        return null;
    }
    function sanitizeMove(move) {
        if (!move || typeof move !== 'object') return null;
        return {
            name: abilityName(move.name ?? move.nome),
            type: safeEnum(String(move.type ?? move.tipo ?? '').toUpperCase(),
                ['NORMAL','FIRE','WATER','GRASS','ELECTRIC','ICE','FIGHTING',
                    'POISON','GROUND','FLYING','PSYCHIC','BUG','ROCK','GHOST',
                    'DRAGON','DARK','STEEL','FAIRY']),
            category: safeEnum(String(move.category ?? move.categoria ?? '').toUpperCase(),
                ['PHYSICAL','SPECIAL','FISICO','ESPECIAL','FÍSICO']),
            ...compact(move, ['power','cooldownMs','learnLevel']),
            cdFixo: move.cdFixo === true,
            tmElemental: move.tmElemental === true
        };
    }
    function sanitizePokemon(pk) {
        if (!pk || typeof pk !== 'object') return null;
        const iv = pk.ivs || pk.iv || {};
        const attacks = Array.isArray(pk.attacks) ? pk.attacks.slice(0, 12)
            .map(sanitizeMove).filter(Boolean) : [];
        return {
            speciesId: id(pk.speciesId), level: finite(pk.level),
            stats: compact(pk.stats, ['hp','atk','def','spAtk','spDef','speed']),
            ivs: compact(iv, ['hp','atk','def','spAtk','spDef','speed','spd']),
            speedIV: finite(pk.speedIV ?? pk.speedIv ?? iv.speed ?? iv.spd),
            types: Array.isArray(pk.tipos) ? pk.tipos.slice(0, 2)
                .filter(x => typeof x === 'string' && /^[A-Z]+$/.test(x)) : [],
            tmElemental: pk.tmElemental === true ||
                (typeof pk.tmElemental === 'string' ? abilityName(pk.tmElemental) : false),
            tmAoe: pk.tmAoe === true,
            mega: Boolean(pk.megaId || pk.mega),
            attacks
        };
    }
    function sanitizeHunt(hunt) {
        if (!hunt || typeof hunt !== 'object') return null;
        const species = Array.isArray(hunt.especies) ? hunt.especies
            : Array.isArray(hunt.species) ? hunt.species : [];
        return {
            slug: typeof hunt.slug === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(hunt.slug)
                ? hunt.slug : null,
            level: finite(hunt.nivel ?? hunt.level),
            spawns: species.slice(0, 35).map(x => ({
                speciesId: id(x.pokeId ?? x.id),
                weight: finite(x.pontos ?? x.weight) ?? null
            }))
        };
    }
    function safeBonuses(state) {
        if (!state || typeof state !== 'object') return {};
        const out = compact(state,['guildBonusPct','xpBoost','pokemonXpBoost',
            'streamBonusPct','twitchBonusPct','kickBonusPct','catchupTarget']);
        if (state.twitch && typeof state.twitch === 'object')
            out.twitch = compact(state.twitch,['pct','watching']);
        if (state.evento && typeof state.evento === 'object')
            out.event = compact(state.evento,['trainer','pokemon','xpTreinador','xpPokemon']);
        if (state.loja && typeof state.loja === 'object') {
            out.shop = {
                vipActive: finite(state.loja.vipAte ?? state.loja.vipUntil) > Date.now(),
                trainerBoostActive: finite(state.loja.boosts?.xp) > Date.now(),
                pokemonBoostActive: finite(state.loja.boosts?.pokexp) > Date.now(),
                catchup: compact(state.loja.catchup,['target','multiplier','targetLevel'])
            };
        }
        if (state.guild && typeof state.guild === 'object')
            out.guildBankBoostActive = finite(state.guild.boostAte ??
                state.guild.boostUntil) > Date.now();
        return out;
    }
    function activeSnapshot() {
        const active = model.activeId;
        const candidate = active === null ? model.lastActiveId : active;
        const pokemon = candidate === null ? null : model.pokemon.get(candidate);
        return {
            activeKnown: model.activeConfirmed && candidate !== null,
            activeInCurrentState: active !== null,
            lead: sanitizePokemon(pokemon || null),
            hunt: sanitizeHunt(model.huntCatalog.get(model.huntSlug)),
            huntSlug: model.huntSlug,
            trainerLevel: model.playerLevel,
            bonuses: model.bonuses
        };
    }
    function readBridge() {
        try {
            const bridge = page.__mothControllerBridgeV1;
            if (!bridge || typeof bridge.gameSnapshot !== 'function') return;
            const snapshot = bridge.gameSnapshot();
            if (Array.isArray(snapshot?.hunts))
                for (const hunt of snapshot.hunts.slice(0, 800))
                    if (typeof hunt?.slug === 'string')
                        model.huntCatalog.set(hunt.slug, hunt);
            observeState(snapshot?.state, performance.now(), false);
        } catch { /* diagnostic must never affect the game */ }
    }
    function readAtlas() {
        try {
            const api = page.__mothHuntAtlasExperimentV1;
            if (!api || typeof api.snapshot !== 'function') return null;
            const p = api.snapshot()?.prediction;
            if (!p || typeof p !== 'object') return null;
            return {
                source: typeof p.source === 'string' ? p.source.slice(0, 60) : null,
                modeledXpH: finite(p.measured ? null : p.trainerXpH),
                estimatedKillsH: finite(p.killsH),
                observed: p.measured === true,
                measuredXpH: finite(p.measured ? p.trainerXpH : null),
                measuredKillMs: finite(p.measuredKillMs),
                idealKillMs: finite(p.idealKillMs),
                pacingAllowanceMs: finite(p.pacingAllowanceMs),
                coverage: finite(p.coverage),
                modelHitCount: finite(p.modelHitsPerKill),
                leadSpeciesId: id(p.leadSpeciesId)
            };
        } catch { return null; }
    }
    function snapshotIfChanged(at) {
        if (model.phase !== 'recording' || model.stateRows.length >= MAX_STATES) return;
        const state = activeSnapshot();
        const key = JSON.stringify(state);
        if (key !== model.previousStateKey) {
            model.previousStateKey = key;
            model.stateRows.push({ms: relative(at), state});
        }
    }
    function observeState(delta, at, keep = true) {
        if (!delta || typeof delta !== 'object') return;
        if (own(delta,'cheio') && delta.cheio === true) {
            model.pokemon.clear();
            model.activeConfirmed = false;
            model.lastActiveId = null;
        }
        if (Array.isArray(delta.pokemons)) {
            model.pokemon.clear();
            for (const pk of delta.pokemons.slice(0, 2500))
                if (id(pk?.id) !== null) model.pokemon.set(id(pk.id), pk);
        }
        for (const pk of (Array.isArray(delta.pkMud) ? delta.pkMud.slice(0, 150) : []))
            if (id(pk?.id) !== null) model.pokemon.set(id(pk.id), pk);
        for (const v of (Array.isArray(delta.pkFora) ? delta.pkFora.slice(0, 150) : []))
            if (id(v) !== null) model.pokemon.delete(id(v));
        if (own(delta, 'activeId')) {
            model.activeId = id(delta.activeId);
            if (model.activeId !== null) {
                model.lastActiveId = model.activeId;
                model.activeConfirmed = true;
            }
        }
        if (own(delta,'huntSlug')) {
            if (model.huntSlug !== delta.huntSlug) {
                model.lastActiveId = model.activeId;
                // Hunt transition is captured with timestamp in report.
            }
            model.huntSlug = typeof delta.huntSlug === 'string' ?
                delta.huntSlug.slice(0, 80) : null;
        }
        if (finite(delta.level) !== null) model.playerLevel = delta.level;
        if (delta.twitch || delta.evento || delta.loja || delta.guild ||
            own(delta,'guildBonusPct'))
            model.bonuses = {...model.bonuses,...safeBonuses(delta)};
        if (keep) snapshotIfChanged(at);
    }
    function snapshotEvent(event, at, packetNumber, index) {
        if (!event || typeof event !== 'object' || !EVENT_KINDS.has(event.k))
            return null;
        const row = {
            ms: relative(at), packet: packetNumber, index,
            kind: event.k,
            who: safeEnum(event.quem, ['selvagem','jogador']),
            actor: safeEnum(event.por, ['selvagem','jogador']),
            slot: token(model.slotRefs, event.slot ?? event.s, 'T', 200),
            ...compact(event)
        };
        if (event.k === 'ataque') {
            row.move = moveName(event);
            row.cast = castRef(event);
            row.attackFields = Object.keys(event).filter(key =>
                /^[a-zA-Z_]{1,48}$/.test(key)).slice(0, 32);
            if (event.golpe && typeof event.golpe === 'object')
                row.ability = sanitizeMove(event.golpe);
            if (event.movimento && typeof event.movimento === 'object')
                row.ability = sanitizeMove(event.movimento);
            if (event.ataque && typeof event.ataque === 'object')
                row.ability = sanitizeMove(event.ataque);
        }
        if (event.k === 'morte') {
            row.hasTrainerXp = own(event,'xpTreinador');
            row.hasPokemonXp = own(event,'xpPokemon');
        }
        return row;
    }
    function ingest(data, at) {
        if (model.phase === 'done') return;
        if (typeof data !== 'string') { return; }
        let message;
        try { message = JSON.parse(data); } catch { return; }
        if (!message || typeof message !== 'object') return;
        if (message.t === 'welcome') {
            model.welcomePackets++;
            if (Array.isArray(message.hunts))
                for (const hunt of message.hunts.slice(0, 800))
                    if (typeof hunt?.slug === 'string')
                        model.huntCatalog.set(hunt.slug, hunt);
            if (message.estado) observeState(message.estado, at);
        } else if (message.t === 'estado') {
            model.statePackets++;
            observeState(message.estado, at);
        }
        if (model.phase !== 'recording') return;
        model.packets++;
        if (message.t === 'batalha' && Array.isArray(message.ev)) {
            model.battlePackets++;
            const number = ++model.packetNo;
            recordKeyCounts(model.keys, message);
            for (const [i, ev] of message.ev.entries()) {
                if (!ev || typeof ev !== 'object') continue;
                const kind = typeof ev.k === 'string' ? ev.k : 'unknown';
                model.counts[kind] = (model.counts[kind] || 0) + 1;
                if (!model.eventSources.has(kind)) model.eventSources.add(kind);
                if (!model.keys[kind]) model.keys[kind] = {};
                recordKeyCounts(model.keys[kind], ev);
                if (model.rows.length < MAX_EVENTS) {
                    const row = snapshotEvent(ev, at, number, i);
                    if (row) model.rows.push(row);
                } else model.droppedRows++;
            }
        }
        if (model.phase === 'recording' && model.battlePackets % 4 === 0) updatePanel();
    }
    function attachSocket(socket) {
        if (!socket || typeof socket.addEventListener !== 'function') return;
        let host = '';
        try { host = new URL(socket.url).hostname.toLowerCase(); } catch { return; }
        if (host !== 'pokeidle.io' && !host.endsWith('.pokeidle.io')) return;
        model.gameSockets++;
        socket.addEventListener('message', ev => {
            const at = performance.now();
            if (typeof ev.data === 'string') ingest(ev.data, at);
            else if (typeof Blob !== 'undefined' && ev.data instanceof Blob)
                void ev.data.text().then(text => ingest(text, at)).catch(() => {});
        });
    }
    function installHook() {
        const Base = page.WebSocket;
        if (typeof Base !== 'function') return;
        const Wrapped = new Proxy(Base, {
            construct(target, args) {
                const socket = Reflect.construct(target, args, target);
                model.sockets++;
                attachSocket(socket);
                return socket;
            }
        });
        try {
            page.WebSocket = Wrapped;
            model.wrapped = page.WebSocket === Wrapped;
        } catch { model.warning = 'WebSocket hook unavailable; reload after installing.'; }
    }
    function median(numbers) {
        const sorted = numbers.filter(Number.isFinite).sort((a,b) => a-b);
        if (!sorted.length) return null;
        const mid = sorted.length >> 1;
        return sorted.length % 2 ? sorted[mid] :
            (sorted[mid-1]+sorted[mid])/2;
    }
    function summarize(report) {
        const attacks = report.timeline.filter(e => e.kind === 'ataque');
        const player = attacks.filter(e => e.actor === 'jogador');
        const enemy = attacks.filter(e => e.actor === 'selvagem');
        const kills = report.timeline.filter(e => e.kind === 'morte' &&
            e.who === 'selvagem');
        const rewardKills = kills.filter(e => e.hasTrainerXp && finite(e.xpTreinador) !== null);
        const trainerXp = rewardKills.reduce((a,e) => a+e.xpTreinador,0);
        const pokemonXp = kills.filter(e => e.hasPokemonXp &&
            finite(e.xpPokemon) !== null).reduce((a,e)=>a+e.xpPokemon,0);
        const gaps = (arr) => arr.slice(1).map((e,i)=>e.ms-arr[i].ms)
            .filter(ms => ms > 0);
        const distinctAttackTimes = player.filter((e,i)=>i===0||e.ms!==player[i-1].ms);
        const attackedSlots = new Map();
        for (const ev of player) {
            if (ev.slot) attackedSlots.set(ev.slot,(attackedSlots.get(ev.slot)||0)+1);
        }
        return {
            windowMs: report.durationMs, battlePackets: report.packets.battle,
            playerAttackEvents: player.length,
            uniquePlayerAttackTimes: distinctAttackTimes.length,
            enemyAttackEvents: enemy.length,
            wildKills: kills.length, knownTrainerRewards: rewardKills.length,
            totalTrainerXp: trainerXp, totalPokemonXp: pokemonXp,
            trainerXpPerHourWindow: report.durationMs > 0 &&
                rewardKills.length === kills.length
                ? Math.round(trainerXp*3600000/report.durationMs) : null,
            killsPerHourWindow: report.durationMs > 0
                ? Math.round(kills.length*3600000/report.durationMs) : null,
            medianPlayerAttackGapMs: median(gaps(distinctAttackTimes)),
            medianKillGapMs: median(gaps(kills)),
            firstKillAtMs: kills[0]?.ms ?? null,
            firstAttackAtMs: player[0]?.ms ?? null,
            attackedTargetCount: attackedSlots.size,
            attackHitsPerObservedKill: kills.length ? player.length/kills.length : null,
            movesSeen: [...new Set(player.map(e => e.move).filter(Boolean))].slice(0, 20),
            simultaneousDamageRows: player.length - distinctAttackTimes.length,
            note: '30s window includes initial partial fights and is NOT a stable hourly measurement'
        };
    }
    function buildReport() {
        const end = performance.now();
        const report = {
            format: 'pokeidle-battle-trace', schemaVersion: 1,
            addonVersion: '0.1.0', game: 'pokeidle.io',
            startedUtc: new Date(Date.now() - (end-model.started)).toISOString(),
            targetDurationMs: DURATION_MS,
            durationMs: relative(end),
            source: 'read-only game WebSocket, observed browser receipt timestamps',
            privacy: 'only allowlisted combat fields; anonymized target/cast slots; no raw state or auth',
            connection: {
                hookInstalled: model.wrapped,
                socketsCreatedSincePageLoad: model.sockets,
                gameSocketsMonitored: model.gameSockets
            },
            contextAtStart: model.contextAtStart || null,
            contextAtEnd: activeSnapshot(),
            huntAtlasStart: model.atlasStart || null,
            huntAtlasEnd: readAtlas(),
            stateChanges: model.stateRows.slice(),
            packets: {received: model.packets, battle: model.battlePackets,
                stateDuringPage: model.statePackets, welcomeDuringPage: model.welcomePackets},
            eventsByKind: {...model.counts},
            observedFieldNamesByKind: model.keys,
            omittedEvents: model.droppedRows,
            timeline: model.rows.slice()
        };
        report.summary = summarize(report);
        report.warnings = [];
        if (model.gameSockets === 0 || model.battlePackets === 0)
            report.warnings.push('No battle WebSocket data captured. Reload the game page with the diagnostic installed, then retry.');
        if (!report.contextAtStart?.lead)
            report.warnings.push('Active Pokémon unavailable when recording began; hunt/battle events may still be useful.');
        if (report.contextAtStart?.huntSlug !== report.contextAtEnd?.huntSlug)
            report.warnings.push('Hunt changed during recording; run another 30s at a single hunt.');
        if (model.droppedRows)
            report.warnings.push('Event cap reached. Some later events were omitted.');
        return report;
    }
    let root, mainButton, downloadButton, statusNode;
    function updatePanel() {
        if (!statusNode) return;
        if (model.phase === 'recording') {
            const left = Math.max(0, Math.ceil((DURATION_MS -
                (performance.now()-model.started))/1000));
            statusNode.textContent = left + 's remaining · ' + model.battlePackets +
                ' battle packets · ' + model.counts.morte + ' deaths';
        } else if (model.phase === 'done') {
            statusNode.textContent = 'Saved ' + model.report?.summary?.wildKills +
                ' wild kills, ' + model.report?.summary?.playerAttackEvents +
                ' attacks. Upload the JSON file here.';
        } else statusNode.textContent = model.warning ||
            'Stay in one hunt. Press Record while your Pokémon is battling.';
        if (mainButton) {
            mainButton.disabled = model.phase === 'recording';
            mainButton.textContent = model.phase === 'recording' ? 'Recording…' :
                model.phase === 'done' ? 'Record again (30s)' : 'Record 30s';
        }
        if (downloadButton) downloadButton.hidden = model.phase !== 'done';
    }
    function download() {
        if (!model.report) return;
        const data = JSON.stringify(model.report,null,2);
        const blob = new Blob([data],{type:'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pokeidle-battle-trace-30s-' +
            new Date().toISOString().replace(/[:.]/g,'-') + '.json';
        a.style.display = 'none';
        (document.body || document.documentElement).appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url),60000);
    }
    function finish() {
        if (model.phase !== 'recording') return;
        model.phase = 'done';
        clearInterval(model.clock);
        clearTimeout(model.timer);
        model.clock = null;
        model.timer = null;
        model.report = buildReport();
        updatePanel();
        // Browser may suppress automated downloads. The visible Download
        // button stays available for a direct user-triggered save.
        download();
    }
    function start() {
        if (model.phase === 'recording') return;
        model.phase = 'recording';
        model.started = performance.now();
        model.rows = []; model.stateRows = []; model.report = null;
        model.packets = 0; model.battlePackets = 0; model.packetNo = 0;
        model.counts = {}; model.keys = {}; model.droppedRows = 0;
        model.previousStateKey = '';
        model.slotRefs = new Map(); model.castRefs = new Map();
        model.atlasStart = readAtlas();
        readBridge();
        model.contextAtStart = activeSnapshot();
        snapshotIfChanged(model.started);
        model.timer = setTimeout(finish,DURATION_MS);
        model.clock = setInterval(updatePanel,250);
        updatePanel();
    }
    function installPanel() {
        if (document.getElementById('moth-battle-trace-host')) return;
        const host = document.createElement('div');
        host.id = 'moth-battle-trace-host';
        host.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:2147483645;';
        const shadow = host.attachShadow({mode:'open'});
        shadow.innerHTML = '<style>' +
            '.panel{width:260px;box-sizing:border-box;padding:12px;background:#151a27;color:#eef3ff;' +
            'border:1px solid #71809b;border-radius:10px;box-shadow:0 5px 24px #000a;' +
            'font:12px/1.4 system-ui,Arial,sans-serif}' +
            'b{font-size:13px}p{margin:7px 0 10px;color:#bfcede}' +
            '.buttons{display:flex;gap:5px;flex-wrap:wrap}' +
            'button{background:#304e82;color:white;border:1px solid #7d9dd1;' +
            'padding:6px 9px;border-radius:6px;cursor:pointer;font:inherit}' +
            'button:disabled{opacity:.6;cursor:default}' +
            '.note{font-size:10px;margin-top:7px;color:#aebbd4}' +
            '</style><div class="panel"><b>Battle Trace · 30 seconds</b>' +
            '<p id="status"></p><div class="buttons">' +
            '<button id="start" type="button">Record 30s</button>' +
            '<button id="download" type="button" hidden>Download JSON again</button>' +
            '</div><div class="note">Only combat data. No account IDs, passwords, chat or raw packets.</div>' +
            '</div>';
        mainButton = shadow.getElementById('start');
        downloadButton = shadow.getElementById('download');
        statusNode = shadow.getElementById('status');
        mainButton.addEventListener('click',start);
        downloadButton.addEventListener('click',download);
        (document.body || document.documentElement).appendChild(host);
        root = host;
        updatePanel();
    }
    installHook();
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded',installPanel,{once:true});
    else installPanel();
    page.__mothBattleTrace30s = {status:()=>({
        phase:model.phase,hookInstalled:model.wrapped,
        battlePackets:model.battlePackets,gameSockets:model.gameSockets
    })};
})();
