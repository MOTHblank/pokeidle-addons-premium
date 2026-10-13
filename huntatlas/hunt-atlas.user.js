// ==UserScript==
// @name         PokéIdle Hunt Atlas
// @namespace    moth.pokeidle
// @author       MOTHblank
// @homepageURL  https://github.com/MOTHblank/pokeidle-addons-premium/tree/main/huntatlas
// @supportURL   https://github.com/MOTHblank/pokeidle-addons-premium/issues
// @version      1.9.8
// @description  Hunt finder with measured lead-Pokémon combat speed and personalized trainer XP/hour ranking.
// @match        https://pokeidle.io/app*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      pokeapi.co
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    // Report only this script's version to the native monitor (no account data).
    const reportMothAddonVersion = () => {
        document.documentElement?.setAttribute('data-moth-addon-version-hunt-atlas', '1.9.8');
    };
    reportMothAddonVersion();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', reportMothAddonVersion, { once: true });
    }

    const page =
        typeof unsafeWindow !== 'undefined'
            ? unsafeWindow
            : window;

    const CACHE_KEY =
        'moth-pokeidle-hunt-atlas-cache-v1';

    const TYPE_CACHE_KEY =
        'moth-pokeidle-hunt-atlas-types-v1';

    const FILTER_KEY =
        'moth-pokeidle-hunt-atlas-filters-v2';

    const ENABLED_KEY =
        'moth-pokeidle-hunt-atlas-enabled-v1';

    const PERF_KEY =
        'moth-pokeidle-hunt-atlas-performance-v2';

    const MARKET_CACHE_KEY =
        'moth-pokeidle-hunt-atlas-market-v2';

    const MARKET_REFRESH_MS =
        15 * 60 * 1000;

    const MARKET_CACHE_MAX_AGE_MS =
        7 * 24 * 60 * 60 * 1000;

    const MARKET_HISTORY_MAX_PAGES =
        12;

    const MARKET_LISTING_MAX_PAGES =
        50;

    /*
     * Keep these in sync with PokéIdle shared/sell-value.mjs.
     *
     * The creature JSON is a raw mirror. Values above 500k can be import
     * garbage (Aerodactyl's historical 6.5b is the canonical example), and
     * high-region species are normalized from hunt level before sale pricing.
     */
    const SELL_VALUE_ANCHOR_LEVEL =
        150;

    const SELL_VALUE_ANCHOR_GOLD =
        12000;

    const NPC_CATALOG_PRICE_MAX =
        500000;

    const GOLD_KILL_LEVEL_1 =
        36;

    const GOLD_KILL_ANCHOR_LEVEL =
        5000;

    const GOLD_KILL_ANCHOR =
        6000;

    const GOLD_KILL_EXPONENT =
        Math.log(
            GOLD_KILL_ANCHOR /
                GOLD_KILL_LEVEL_1
        ) /
        Math.log(
            GOLD_KILL_ANCHOR_LEVEL
        );

    const GOLD_KILL_LEVEL_CAP =
        25000;

    const NPC_SELL_BASE_CAP =
        6 *
        Math.round(
            GOLD_KILL_LEVEL_1 *
            Math.pow(
                GOLD_KILL_LEVEL_CAP,
                GOLD_KILL_EXPONENT
            )
        );

    const BUTTON_ID =
        'moth-hunt-atlas-button';

    const DRAWER_ID =
        'moth-hunt-atlas-drawer';

    const STYLE_ID =
        'moth-hunt-atlas-style';

    const STANDARD_TYPES = [
        'NORMAL',
        'FIRE',
        'WATER',
        'ELECTRIC',
        'GRASS',
        'ICE',
        'FIGHTING',
        'POISON',
        'GROUND',
        'FLYING',
        'PSYCHIC',
        'BUG',
        'ROCK',
        'GHOST',
        'DRAGON',
        'DARK',
        'STEEL',
        'FAIRY'
    ];

    /*
     * Attack type -> defender type multiplier.
     * Missing entries are neutral (1x).
     */
    const TYPE_CHART = {
        NORMAL: {
            ROCK: 0.5,
            GHOST: 0,
            STEEL: 0.5
        },
        FIRE: {
            FIRE: 0.5,
            WATER: 0.5,
            GRASS: 2,
            ICE: 2,
            BUG: 2,
            ROCK: 0.5,
            DRAGON: 0.5,
            STEEL: 2
        },
        WATER: {
            FIRE: 2,
            WATER: 0.5,
            GRASS: 0.5,
            GROUND: 2,
            ROCK: 2,
            DRAGON: 0.5
        },
        ELECTRIC: {
            WATER: 2,
            ELECTRIC: 0.5,
            GRASS: 0.5,
            GROUND: 0,
            FLYING: 2,
            DRAGON: 0.5
        },
        GRASS: {
            FIRE: 0.5,
            WATER: 2,
            GRASS: 0.5,
            POISON: 0.5,
            GROUND: 2,
            FLYING: 0.5,
            BUG: 0.5,
            ROCK: 2,
            DRAGON: 0.5,
            STEEL: 0.5
        },
        ICE: {
            FIRE: 0.5,
            WATER: 0.5,
            GRASS: 2,
            ICE: 0.5,
            GROUND: 2,
            FLYING: 2,
            DRAGON: 2,
            STEEL: 0.5
        },
        FIGHTING: {
            NORMAL: 2,
            ICE: 2,
            POISON: 0.5,
            FLYING: 0.5,
            PSYCHIC: 0.5,
            BUG: 0.5,
            ROCK: 2,
            GHOST: 0,
            DARK: 2,
            STEEL: 2,
            FAIRY: 0.5
        },
        POISON: {
            GRASS: 2,
            POISON: 0.5,
            GROUND: 0.5,
            ROCK: 0.5,
            GHOST: 0.5,
            STEEL: 0,
            FAIRY: 2
        },
        GROUND: {
            FIRE: 2,
            ELECTRIC: 2,
            GRASS: 0.5,
            POISON: 2,
            FLYING: 0,
            BUG: 0.5,
            ROCK: 2,
            STEEL: 2
        },
        FLYING: {
            ELECTRIC: 0.5,
            GRASS: 2,
            FIGHTING: 2,
            BUG: 2,
            ROCK: 0.5,
            STEEL: 0.5
        },
        PSYCHIC: {
            FIGHTING: 2,
            POISON: 2,
            PSYCHIC: 0.5,
            DARK: 0,
            STEEL: 0.5
        },
        BUG: {
            FIRE: 0.5,
            GRASS: 2,
            FIGHTING: 0.5,
            POISON: 0.5,
            FLYING: 0.5,
            PSYCHIC: 2,
            GHOST: 0.5,
            DARK: 2,
            STEEL: 0.5,
            FAIRY: 0.5
        },
        ROCK: {
            FIRE: 2,
            ICE: 2,
            FIGHTING: 0.5,
            GROUND: 0.5,
            FLYING: 2,
            BUG: 2,
            STEEL: 0.5
        },
        GHOST: {
            NORMAL: 0,
            PSYCHIC: 2,
            GHOST: 2,
            DARK: 0.5
        },
        DRAGON: {
            DRAGON: 2,
            STEEL: 0.5,
            FAIRY: 0
        },
        DARK: {
            FIGHTING: 0.5,
            PSYCHIC: 2,
            GHOST: 2,
            DARK: 0.5,
            FAIRY: 0.5
        },
        STEEL: {
            FIRE: 0.5,
            WATER: 0.5,
            ELECTRIC: 0.5,
            ICE: 2,
            ROCK: 2,
            STEEL: 0.5,
            FAIRY: 2
        },
        FAIRY: {
            FIRE: 0.5,
            FIGHTING: 2,
            POISON: 0.5,
            DRAGON: 2,
            DARK: 2,
            STEEL: 0.5
        }
    };


    const TEXT = {
        en: {
            'title': 'Hunt Atlas',
            'toggle.on': 'Atlas on',
            'toggle.off': 'Atlas off',
            'toggle.onTitle': 'Hunt Atlas is replacing the native map. Click to use PokéIdle’s map.',
            'toggle.offTitle': 'PokéIdle’s native map is active. Click to enable Hunt Atlas.',
            'filter.search': 'Search',
            'filter.searchPlaceholder': 'Pokémon, hunt or region…',
            'filter.region': 'Region',
            'filter.allRegions': 'All regions',
            'filter.level': 'Level',
            'filter.min': 'Min',
            'filter.max': 'Max',
            'filter.minLevelAria': 'Minimum hunt level',
            'filter.maxLevelAria': 'Maximum hunt level',
            'filter.availability': 'Availability',
            'filter.all': 'All',
            'filter.unlocked': 'Unlocked',
            'filter.locked': 'Locked',
            'filter.type': 'Type',
            'filter.allTypes': 'All types',
            'filter.typeLoading': 'Type: loading…',
            'filter.weakTo': 'Weak to',
            'filter.anyWeakness': 'Any weakness',
            'filter.weaknessLoading': 'Weakness: loading…',
            'filter.matchAllWeaknesses': 'All selected',
            'filter.matchAnyWeaknesses': 'Any selected',
            'filter.weaknessSelected': '{count} selected',
            'filter.clearWeakness': 'Clear selection',
            'filter.collection': 'Collection',
            'filter.caughtAndUncaught': 'Caught + uncaught',
            'filter.uncaughtOnly': 'Uncaught only',
            'filter.caughtOnly': 'Caught only',
            'filter.sort': 'Sort',
            'sort.xp': 'XP/hour',
            'sort.name': 'Name',
            'sort.pokedex': 'Pokédex number',
            'sort.level': 'Level',
            'sort.npc': 'MKT',
            'sort.player': 'RMT',
            'sort.matchup': 'Matchup',
            'sort.asc': 'Ascending',
            'sort.desc': 'Descending',
            'filter.clear': 'Clear filters',
            'filter.defaults': 'Default filters',
            'filter.changedOne': '1 filter changed from default',
            'filter.changedMany': '{count} filters changed from default',
            'footer.by': 'by MOTHblank',
            'footer.play': 'MOTHblank on Google Play',
            'footer.x': 'MOTHblank on X',
            'footer.whatsapp': 'WhatsApp / Pix',
            'footer.source': 'source code',
            'capture.caught': 'caught',
            'capture.notCaught': 'not caught',
            'capture.typeUnknown': 'type ?',
            'common.lead': 'Lead',
            'price.npc': 'MKT ~{value}',
            'price.npcMissing': 'MKT —',
            'price.players': 'RMT ~{value}',
            'price.playersMissing': 'RMT —',
            'price.npcTip': 'MKT: NPC sale reference at the visible hunt level{plural} and quality 1.0{range} · actual captured Pokémon vary with quality; shiny ×10',
            'price.npcMissingTip': 'MKT: NPC sell value is not available for this species yet.',
            'price.playerTip': 'RMT: recent non-shiny completed player Market sales · {count} {sample} · range {min}–{max}',
            'price.playerListingTip': 'RMT: lowest current gold listing in the player Market. Completed-sale averages are preferred when available.',
            'price.playerMissingTip': 'RMT: no recent completed sale or current gold listing was found.',
            'price.sample': 'sample',
            'price.samples': 'samples',
            'price.range': ' · range {min}–{max}',
            'matchup.immune': 'immune',
            'matchup.weak': 'weak',
            'matchup.resists': 'resists',
            'matchup.neutral': 'neutral',
            'matchup.deal': 'Deal {multiplier} · {relation}',
            'matchup.take': 'Take {multiplier} · {relation}',
            'matchup.dealTitle': '{lead}’s best known attack type ({type}) vs {species}: {multiplier}.',
            'matchup.takeTitle': '{species}’s best STAB type ({type}) vs {lead}: {multiplier}.',
            'hunt.level': 'Lv {level}',
            'hunt.unlocked': 'unlocked',
            'hunt.locked': 'locked',
            'hunt.here': 'Here',
            'hunt.go': 'Go',
            'hunt.requiresLevel': 'Requires level {level}',
            'hunt.current': 'Current hunt',
            'hunt.travel': 'Travel to this hunt',
            'hunt.measuredXp': 'measured {value} trainer XP/h',
            'hunt.modeledXp': 'model {value} trainer XP/h',
            'xp.lead': '{name} Lv {level} · lead · power {power}',
            'xp.warmStart': 'warm-started from nearest level',
            'xp.baseline': 'upstream baseline model; personalized combat data will refine it',
            'xp.kills': '{count} kills',
            'xp.attacks': '{count} attacks',
            'xp.cadence': '{seconds}s attack cadence{detail}',
            'xp.throughput': ' (attack throughput)',
            'xp.floor': ' (900ms floor)',
            'xp.travel': '{seconds}s travel',
            'xp.hpSamples': '{count} HP samples',
            'xp.measuredHunt': '{count} measured hunt',
            'xp.measuredHunts': '{count} measured hunts',
            'xp.killsPerHour': '{count} kills/h',
            'xp.pokemonPerHour': '{value} Pokémon XP/h',
            'xp.measuredShort': 'measured {value} XP/h',
            'xp.modelShort': 'model {value} XP/h',
            'xp.sectionTitle': 'XP/hour recommendations',
            'xp.sectionSubtitle': 'Best hunt for {lead} within the current filters.',
            'xp.best': 'Best: {hunt}',
            'xp.showTopFive': 'Show top 5',
            'xp.hideTopFive': 'Hide top 5',
            'xp.topFiveTitle': 'Top 5 hunts by trainer XP/hour',
            'xp.measuredTrainer': 'measured {value} trainer XP/h',
            'xp.modeledTrainer': 'modeled {value} trainer XP/h',
            'xp.noEstimate': 'No unlocked XP estimate matches the current filters.',
            'xp.details': 'Details',
            'xp.hideDetails': 'Hide details',
            'xp.recommendationNote': '{lead} · recommendations respect the current Atlas filters.',
            'xp.currentMeasured': ' · current measured {value} trainer XP/h',
            'xp.currentModeled': ' · current modeled {value} trainer XP/h',
            'xp.warmingSession': 'warming up: sustained observations still insufficient',
            'xp.sessionEvidence': '{samples} kills / {minutes} min, wall-clock',
            'sort.capture': 'Captured/hour (Ultra/Beast)',
            'sort.shinyCatch': 'Shiny caught/hour (conditional)',
            'catch.title': 'Catch and shiny planner',
            'catch.ball': 'Compare with',
            'catch.ultra': 'Ultra Ball · ×4 (default)',
            'catch.beast': 'Beast Ball · ×8 (Diamonds)',
            'catch.lure': 'Simulate Shiny Secret Lure ×2 (hypothetical, not verified active)',
            'catch.current': 'Compared hunt: {hunt}',
            'catch.unknown': '— (species rarity or kill rate unavailable)',
            'catch.percent': '{chance}% per accepted throw',
            'catch.expected': '{count} captures/h · {balls} accepted balls/capture on average',
            'catch.seen': 'Shinies seen: {count}/h · shinies caught: {caught}/h',
            'catch.oneDay': '≥1 shiny caught in 24h: {chance}% (if steady conditions)',
            'catch.cost': 'Replacement: {coins} Coins per expected capture',
            'catch.diamondCost': 'Beast requires Diamonds; no Coin cost assumed',
            'catch.stock': 'Stock: {count} · coverage at observed throw rate: {hours}h',
            'catch.observed': 'Observed: {throws} accepted throws, {caught} captures, {seen} shiny seen, {shiny} shiny caught; {fraction}% of killed corpses thrown at',
            'catch.observedBall': 'Selected ball: {throws} accepted · {caught} confirmed captures (small samples are noisy)',
            'catch.limit': 'Cross-hunt estimate is an upper bound IF every killed body gets one accepted throw. Current-hunt observed throws replace that assumption only after a usable sample. No free retries after failed throws.',
            'catch.source': 'Wiki-conditional model, unverified server capture formula or active boosts · model coverage {coverage}% · {source}',
            'catch.shiny': 'Shiny is rolled per eligible accepted throw (1/24,000 base; 1/12,000 with applicable Lure), NOT per kill. Caught shiny needs both rolls to succeed. No guarantee or saleable specimen implied.',
            'catch.outland': 'Outland shiny capture eligibility unresolved; shiny estimates withheld.',
            'catch.clamp': 'Beast ×8 does not always double Ultra ×4 after the 10% cap.',
            'catch.mystic': 'Mystic Arena uses a separate ball table and consumes one ticket per attempt; never included in ordinary hunt odds.',
            'catch.card': 'Ultra {ultra}% · Beast {beast}% (wiki-conditional)',
            'catch.levelCap': 'Caught level cap: {level} (wild rewards unchanged)',
            'catch.cardUnknown': 'Capture chance unavailable (rarity unresolved)',
            'catch.targetRate': 'Target {captures} captures/h · {shiny} shiny caught/h · mean {hours}h/shiny ({source})',
            'catch.targetObserved': 'observed throw coverage',
            'catch.targetCeiling': 'upper bound if all bodies targeted',
            'catch.shinyMean': 'Mean wait for shiny caught: {hours}h · ≈{throws} accepted attempts/shiny caught',
            'sort.pokemonXp': 'Pokémon XP/hour',
            'sort.npcLoot': 'NPC loot EV/hour (not cash)',
            'sort.rare': 'Selected rare items/hour',
            'sort.ballEfficiency': 'Fewest Coins/capture (Ultra)',
            'rank.heading': 'Hunt recommendations by {metric}',
            'rank.topFive': 'Top 5 by {metric}',
            'rank.best': 'Best for {metric}: {hunt}',
            'rank.noEvidence': 'No comparable estimate for this metric under the current filters.',
            'rank.rareLabel': 'Rare item for comparison',
            'rank.value': '{value}/h · {source}',
            'rank.efficiency': '{value} Coins/expected capture · wiki-conditional',
            'rank.rarePreview': 'Outland tier {tier} preview, not the active tier',
            'rank.invalid': 'Unavailable — insufficient model evidence or not eligible',
            'rank.unboosted': 'Unboosted / not validated against active server buffs',
            'rank.details': 'Hunt details (tap to expand)',
            'rank.keyInfo': 'Rates are conditional, and the best hunt depends on the selected metric.',
            'rank.unknown': 'No data',
            'rank.learning': 'Learning',
            'rank.unverified': 'Unverified',
            'diag.toggle': 'Local estimate diagnostics (off by default)',
            'diag.title': 'Redacted evidence · local only',
            'diag.source': 'source: {source} · sample window: {window} · model coverage: {coverage}%',
            'diag.noWindow': 'no measured window',
            'diag.caveat': 'No raw messages, token, name or account ID is exported or uploaded.',
            'sort.coins': 'Kill Coins/hour',
            'sort.netCoins': 'Net Coins/hour (measured)',
            'econ.title': 'Farming economy · {hunt}',
            'econ.kill': 'Kill Coins/h',
            'econ.loot': 'NPC loot EV/h',
            'econ.realized': 'Realized Coins/h',
            'econ.net': 'Net Coins/h',
            'econ.cost': 'Replacement cost of used items',
            'econ.diamonds': 'Diamonds/h (separate)',
            'econ.model': 'shared model (unboosted, catalog fallback level)',
            'econ.observed': 'observed server receipts',
            'econ.estimatedLoot': 'reconstructed static loot · {coverage}% coverage (not verified server drops)',
            'econ.netCaveat': 'Net = realized hunt Coins minus replacement cost of consumed balls/potions/revives, not a wallet-balance change. Unsold loot and potential market sales are excluded.',
            'econ.noPrice': 'Costs unavailable: missing official shop price for {count} uses',
            'econ.unlinked': 'Net unavailable: {count} throw event(s) could not be reconciled to a unique corpse',
            'econ.stock': 'Stock {count} · runway {hours}h at observed use rate',
            'econ.unknown': '— (insufficient evidence)',
            'rare.heading': 'Rare farming · tier preview',
            'rare.outland': 'Outland rare drops',
            'rare.egg': 'Shiny Egg Fragment',
            'rare.preview': 'Compare Outland tier',
            'rare.active': 'Active in-game: Outland {tier}',
            'rare.activeUnknown': 'Active in-game tier: not available from game state',
            'rare.fallback': 'Reported tier {reported} reduced to allowed tier {effective} for current trainer level',
            'rare.select': 'Use this tier in game',
            'rare.pending': 'Change requested; waiting for the game to confirm',
            'rare.locked': 'Locked: trainer level {level} required',
            'rare.previewOnly': 'Preview only; no change to the active hunt or tier',
            'rare.noCommand': 'In-game activation unavailable until the game reports its current tier',
            'rare.source': '{source} · {rate} kills/h ({rateSource})',
            'rare.kills': 'per kill',
            'rare.units': '{value} items/h',
            'rare.mean': 'mean {hours}h / item',
            'rare.craft': 'mean {hours}h / 10 fragments',
            'rare.chances': '≥1 in 1h: {hour}% · 24h: {day}%',
            'rare.incubation': 'Shiny Egg incubation: 168h after crafting (126h with verified heating)',
            'rare.observed': 'Observed in this session: {count}',
            'rare.marketUnknown': 'Completed-sale valuation: — (no verified sales samples)',
            'rare.uncertainty': 'Unboosted independent-roll model; expected times are NOT guarantees. Loot Boost, guild/event stacking, item-roll exclusivity and bicycle server hook are unverified.',
            'rare.notEligible': 'No supported rare drop for this location',
            'rare.noRate': 'Kills/h unavailable; predictions are warming up',
            'rare.huntContext': 'Base hunt: {hunt} (same Outland map across tiers)',
            'xp.sourceLabel': 'source: {source}',
            'xp.sourceMeasured': 'server kill rewards (observed)',
            'xp.sourceModel': 'personalized combat projection',
            'xp.sourceBaseline': 'unboosted static baseline',
            'xp.sourceImmunity': 'known immunity',
            'xp.ranged': 'heuristic range {low}–{high} trainer XP/h',
            'xp.unboosted': 'modeled XP excludes unverified VIP, guild, stream, event and catch-up bonuses',
            'xp.uncertainLeader': 'Leading candidate (uncertain): {hunt}',
            'xp.fallback': 'reason: {reason}',
            'xp.calibration': 'validated against {count} hunt(s) in this context; median absolute error {error}%',
            'xp.unknownPokemon': 'Pokémon XP event stream incomplete (not combined with trainer XP)',
            'xp.modelNote': ' · exact upstream XP curve; real combat samples take priority over experimental move-index estimates.',
            'xp.possibleMoves': '{count} level-eligible indexed moves (not confirmed equipped)',
            'xp.knownMoves': '{count} named moves confirmed by battle events',
            'xp.namesUnavailable': 'Battle events have no identified move names yet; using attack-type measurements',
            'xp.protocol': 'Player hits: {total} · named {named} · unnamed {unnamed}',
            'xp.protocolKeys': 'Unnamed attack fields: {keys}',
            'xp.indexedMoveSummary': 'Possible attacks: {moves}',
            'xp.observedMoveSummary': 'Observed attacks: {moves}',
            'xp.moveConfidence': 'Move model: {confidence}',
            'xp.confidence.high': 'observed',
            'xp.confidence.medium': 'partly observed',
            'xp.confidence.low': 'experimental',
            'arcade.open': '🎮 Parcel Panic',
            'arcade.back': '← Back to Atlas',
            'arcade.title': '📦 Parcel Panic: Outland Express',
            'arcade.subtitle': 'Deliver nonsense mail to hunt markers. The ghost auditors want a word.',
            'arcade.region': 'Region',
            'arcade.score': 'Deliveries',
            'arcade.best': 'Best',
            'arcade.hearts': 'Hearts',
            'arcade.time': 'Time',
            'arcade.target': 'Deliver to',
            'arcade.start': 'Start delivering',
            'arcade.restart': 'Restart run',
            'arcade.resume': 'Resume',
            'arcade.ready': 'Press Start to deliver nonsense',
            'arcade.running': 'Avoid the ghost auditors!',
            'arcade.paused': 'Paused — press Resume',
            'arcade.gameOver': 'Fired by the postal service',
            'arcade.finished': '{score} deliveries. The post office is disappointed.',
            'arcade.delivered': 'Delivered to {hunt}!',
            'arcade.ouch': 'Paperwork collision!',
            'arcade.instructions': 'Focus the board for WASD / arrow keys, drag on it, or use the buttons below.',
            'arcade.loading': 'Loading the hunt-marker index…',
            'arcade.unavailable': 'Marker index unavailable. Try reopening Atlas later.',
            'arcade.disclaimer': 'The roads are fictional, coordinates are stretched, and this does not move your Pokémon or grant in-game XP.',
            'arcade.up': 'Up', 'arcade.down': 'Down',
            'arcade.left': 'Left', 'arcade.right': 'Right',
            'xp.incompleteShort': '⚠ model covers {percentage}%',
            'xp.incompleteDetail': 'Incomplete personalized model: {covered}/{total} spawn points covered ({percentage}%); using baseline, not excluding enemies.',
            'status.movesUnavailable': ' · move index unavailable',
            'location.shared': 'Same mapped zone: {hunts}',
            'location.coverage': 'Mapped hunt locations: {matched}/{total} · {conflicts} outdated level labels',
            'xp.catalogMoves': '{count} candidates from creature catalog (index is advisory)',
            'xp.moveDisagreements': '{count} indexed moves differ from the creature catalog',
            'location.coordinates': 'World location: {region} · {x}, {y} (reference only)',
            'status.locationsUnavailable': ' · world location index unavailable',
            'results.showMore': 'Show more · {count} Pokémon remaining',
            'results.noMatch': 'No Pokémon match these filters. Use Clear filters to reset the Atlas.',
            'results.waiting': 'Waiting for PokéIdle hunt data. Reload the page once after installing Hunt Atlas if this remains empty.',
            'results.count': '{pokemon} Pokémon',
            'results.countPartial': '{shown}/{pokemon} Pokémon',
            'status.waitingGameData': 'Waiting for game data…',
            'status.cachedCatalog': 'Using cached hunt catalog until live state arrives.',
            'status.entered': 'Entered {hunt}.',
            'status.huntsLoaded': '{count} hunt regions loaded.',
            'status.gameNotReady': 'Game connection is not ready yet.',
            'status.traveling': 'Traveling to {hunt}…',
            'status.notAccepted': 'PokéIdle did not accept {hunt}. It may still be locked or hunt switching may be on cooldown.',
            'status.couldNotSend': 'Could not send hunt selection.',
            'status.huntLocked': '{hunt} is locked — requires level {level}.',
            'status.alreadyHere': 'Already hunting in {hunt}.',
            'status.loadingTypes': ' · loading type data',
            'status.typesUnavailable': ' · type data unavailable',
            'status.marketSampling': ' · sampling Market prices',
            'type.NORMAL': 'Normal',
            'type.FIRE': 'Fire',
            'type.WATER': 'Water',
            'type.ELECTRIC': 'Electric',
            'type.GRASS': 'Grass',
            'type.ICE': 'Ice',
            'type.FIGHTING': 'Fighting',
            'type.POISON': 'Poison',
            'type.GROUND': 'Ground',
            'type.FLYING': 'Flying',
            'type.PSYCHIC': 'Psychic',
            'type.BUG': 'Bug',
            'type.ROCK': 'Rock',
            'type.GHOST': 'Ghost',
            'type.DRAGON': 'Dragon',
            'type.DARK': 'Dark',
            'type.STEEL': 'Steel',
            'type.FAIRY': 'Fairy'
        },
        'pt-BR': {
            'title': 'Hunt Atlas',
            'toggle.on': 'Atlas ligado',
            'toggle.off': 'Atlas desligado',
            'toggle.onTitle': 'O Hunt Atlas está substituindo o mapa padrão. Clique para usar o mapa do PokéIdle.',
            'toggle.offTitle': 'O mapa padrão do PokéIdle está ativo. Clique para ativar o Hunt Atlas.',
            'filter.search': 'Buscar',
            'filter.searchPlaceholder': 'Pokémon, hunt ou região…',
            'filter.region': 'Região',
            'filter.allRegions': 'Todas as regiões',
            'filter.level': 'Nível',
            'filter.min': 'Mín.',
            'filter.max': 'Máx.',
            'filter.minLevelAria': 'Nível mínimo da hunt',
            'filter.maxLevelAria': 'Nível máximo da hunt',
            'filter.availability': 'Disponibilidade',
            'filter.all': 'Todas',
            'filter.unlocked': 'Liberadas',
            'filter.locked': 'Bloqueadas',
            'filter.type': 'Tipo',
            'filter.allTypes': 'Todos os tipos',
            'filter.typeLoading': 'Tipo: carregando…',
            'filter.weakTo': 'Fraco contra',
            'filter.anyWeakness': 'Qualquer fraqueza',
            'filter.weaknessLoading': 'Fraqueza: carregando…',
            'filter.matchAllWeaknesses': 'Todas selecionadas',
            'filter.matchAnyWeaknesses': 'Qualquer selecionada',
            'filter.weaknessSelected': '{count} selecionadas',
            'filter.clearWeakness': 'Limpar seleção',
            'filter.collection': 'Coleção',
            'filter.caughtAndUncaught': 'Capturados + não capturados',
            'filter.uncaughtOnly': 'Só não capturados',
            'filter.caughtOnly': 'Só capturados',
            'filter.sort': 'Ordenar',
            'sort.xp': 'XP/hora',
            'sort.name': 'Nome',
            'sort.pokedex': 'Número da Pokédex',
            'sort.level': 'Nível',
            'sort.npc': 'MKT',
            'sort.player': 'RMT',
            'sort.matchup': 'Matchup',
            'sort.asc': 'Crescente',
            'sort.desc': 'Decrescente',
            'filter.clear': 'Limpar filtros',
            'filter.defaults': 'Filtros padrão',
            'filter.changedOne': '1 filtro alterado',
            'filter.changedMany': '{count} filtros alterados',
            'footer.by': 'por MOTHblank',
            'footer.play': 'MOTHblank no Google Play',
            'footer.x': 'MOTHblank no X',
            'footer.whatsapp': 'WhatsApp / Pix',
            'footer.source': 'código-fonte',
            'capture.caught': 'capturado',
            'capture.notCaught': 'não capturado',
            'capture.typeUnknown': 'tipo ?',
            'common.lead': 'Líder',
            'price.npc': 'MKT ~{value}',
            'price.npcMissing': 'MKT —',
            'price.players': 'RMT ~{value}',
            'price.playersMissing': 'RMT —',
            'price.npcTip': 'MKT: referência de venda ao NPC no{plural} nível{plural} de hunt visível{plural} e qualidade 1,0{range} · o valor real varia com a qualidade; shiny ×10',
            'price.npcMissingTip': 'MKT: o valor de venda ao NPC ainda não está disponível para esta espécie.',
            'price.playerTip': 'RMT: vendas recentes concluídas de Pokémon não shiny no Mercado de jogadores · {count} {sample} · faixa {min}–{max}',
            'price.playerListingTip': 'RMT: menor anúncio atual em ouro no Mercado de jogadores. A média de vendas concluídas tem prioridade quando disponível.',
            'price.playerMissingTip': 'RMT: nenhuma venda concluída recente nem anúncio atual em ouro foi encontrado.',
            'price.sample': 'amostra',
            'price.samples': 'amostras',
            'price.range': ' · faixa {min}–{max}',
            'matchup.immune': 'imune',
            'matchup.weak': 'fraco',
            'matchup.resists': 'resiste',
            'matchup.neutral': 'neutro',
            'matchup.deal': 'Causa {multiplier} · {relation}',
            'matchup.take': 'Recebe {multiplier} · {relation}',
            'matchup.dealTitle': 'Melhor tipo de ataque conhecido de {lead} ({type}) contra {species}: {multiplier}.',
            'matchup.takeTitle': 'Melhor STAB de {species} ({type}) contra {lead}: {multiplier}.',
            'hunt.level': 'Nv {level}',
            'hunt.unlocked': 'liberada',
            'hunt.locked': 'bloqueada',
            'hunt.here': 'Aqui',
            'hunt.go': 'Ir',
            'hunt.requiresLevel': 'Requer nível {level}',
            'hunt.current': 'Hunt atual',
            'hunt.travel': 'Ir para esta hunt',
            'hunt.measuredXp': 'medido {value} XP de treinador/h',
            'hunt.modeledXp': 'modelo {value} XP de treinador/h',
            'xp.lead': '{name} Nv {level} · líder · poder {power}',
            'xp.warmStart': 'iniciado com dados do nível mais próximo',
            'xp.baseline': 'modelo-base do jogo; dados reais de combate vão refiná-lo',
            'xp.kills': '{count} abates',
            'xp.attacks': '{count} ataques',
            'xp.cadence': '{seconds}s entre ataques{detail}',
            'xp.throughput': ' (ritmo observado)',
            'xp.floor': ' (piso de 900ms)',
            'xp.travel': '{seconds}s de deslocamento',
            'xp.hpSamples': '{count} amostras de HP',
            'xp.measuredHunt': '{count} hunt medida',
            'xp.measuredHunts': '{count} hunts medidas',
            'xp.killsPerHour': '{count} abates/h',
            'xp.pokemonPerHour': '{value} XP de Pokémon/h',
            'xp.measuredShort': 'medido {value} XP/h',
            'xp.modelShort': 'modelo {value} XP/h',
            'xp.sectionTitle': 'Recomendações de XP/hora',
            'xp.sectionSubtitle': 'Melhor hunt para {lead} dentro dos filtros atuais.',
            'xp.best': 'Melhor: {hunt}',
            'xp.showTopFive': 'Ver top 5',
            'xp.hideTopFive': 'Ocultar top 5',
            'xp.topFiveTitle': 'Top 5 hunts por XP de treinador/hora',
            'xp.measuredTrainer': 'medido {value} XP de treinador/h',
            'xp.modeledTrainer': 'modelado {value} XP de treinador/h',
            'xp.noEstimate': 'Nenhuma estimativa de XP liberada corresponde aos filtros atuais.',
            'xp.details': 'Detalhes',
            'xp.hideDetails': 'Ocultar detalhes',
            'xp.recommendationNote': '{lead} · recomendações respeitam os filtros atuais do Atlas.',
            'xp.currentMeasured': ' · atual medido {value} XP de treinador/h',
            'xp.currentModeled': ' · atual modelado {value} XP de treinador/h',
            'xp.warmingSession': 'aquecendo: ainda faltam medições sustentadas',
            'xp.sessionEvidence': '{samples} abates / {minutes} min, tempo corrido',
            'sort.capture': 'Capturas/h (Ultra/Beast)',
            'sort.shinyCatch': 'Shinies capturados/h (condicional)',
            'catch.title': 'Planejador de capturas e shinies',
            'catch.ball': 'Comparar usando',
            'catch.ultra': 'Ultra Ball · ×4 (padrão)',
            'catch.beast': 'Beast Ball · ×8 (Diamantes)',
            'catch.lure': 'Simular Shiny Secret Lure ×2 (hipotético; não confirmado ativo)',
            'catch.current': 'Hunt em análise: {hunt}',
            'catch.unknown': '— (raridade da espécie ou abates/h indisponíveis)',
            'catch.percent': '{chance}% por bola aceita',
            'catch.expected': '{count} capturas/h · {balls} bolas aceitas/captura em média',
            'catch.seen': 'Shinies vistos: {count}/h · shinies capturados: {caught}/h',
            'catch.oneDay': '≥1 shiny capturado em 24h: {chance}% (com condições constantes)',
            'catch.cost': 'Reposição: {coins} Moedas por captura esperada',
            'catch.diamondCost': 'Beast usa Diamantes; sem inventar custo em Moedas',
            'catch.stock': 'Estoque: {count} · duração no ritmo observado: {hours}h',
            'catch.observed': 'Observado: {throws} bolas aceitas, {caught} capturas, {seen} shinies vistos, {shiny} shinies capturados; {fraction}% dos corpos derrotados receberam bola',
            'catch.observedBall': 'Bola selecionada: {throws} aceitas · {caught} capturas confirmadas (amostras pequenas oscilam)',
            'catch.limit': 'Outras hunts: previsão é TETO condicional a arremessar uma bola aceita em todo corpo derrotado. Na hunt atual, o ritmo observado substitui essa hipótese apenas após amostra suficiente. Sem repetição grátis após falha.',
            'catch.source': 'Modelo condicional da wiki, fórmula real/bônus ativos não verificados · cobertura {coverage}% · {source}',
            'catch.shiny': 'O shiny é sorteado por arremesso aceito elegível (1/24.000 normal; 1/12.000 com Lure aplicável), NÃO por abate. Capturar shiny exige sucesso em ambos os sorteios. Sem garantia de drop ou Pokémon vendável.',
            'catch.outland': 'Elegibilidade de shiny na Outland não verificada; projeção de shiny omitida.',
            'catch.clamp': 'Beast ×8 nem sempre dobra a chance da Ultra ×4 após o teto de 10%.',
            'catch.mystic': 'A Arena Mística usa tabela especial de bolas e consome um ticket por tentativa; não entra nas odds das hunts comuns.',
            'catch.card': 'Ultra {ultra}% · Beast {beast}% (condicional da wiki)',
            'catch.levelCap': 'Teto do nível ao capturar: {level} (recompensas do selvagem não mudam)',
            'catch.cardUnknown': 'Chance de captura indisponível (raridade não verificada)',
            'catch.targetRate': 'Alvo {captures} capturas/h · {shiny} shinies capturados/h · média {hours}h/shiny ({source})',
            'catch.targetObserved': 'cobertura medida de arremessos',
            'catch.targetCeiling': 'teto se todos os corpos receberem bola',
            'catch.shinyMean': 'Espera média por shiny capturado: {hours}h · ≈{throws} bolas aceitas/shiny capturado',
            'sort.pokemonXp': 'XP do Pokémon/hora',
            'sort.npcLoot': 'EV de loot NPC/h (não é dinheiro recebido)',
            'sort.rare': 'Itens raros selecionados/h',
            'sort.ballEfficiency': 'Menor custo Moedas/captura (Ultra)',
            'rank.heading': 'Melhores hunts por {metric}',
            'rank.topFive': 'Top 5 por {metric}',
            'rank.best': 'Melhor para {metric}: {hunt}',
            'rank.noEvidence': 'Nenhuma previsão comparável nesta métrica com os filtros atuais.',
            'rank.rareLabel': 'Item raro para comparar',
            'rank.value': '{value}/h · {source}',
            'rank.efficiency': '{value} Moedas/captura esperada · condicional da wiki',
            'rank.rarePreview': 'Prévia Outland {tier}, não o tier ativo',
            'rank.invalid': 'Indisponível — dados insuficientes ou não elegível',
            'rank.unboosted': 'Sem bônus / não validado com bônus ativos do servidor',
            'rank.details': 'Detalhes da hunt (clique para abrir)',
            'rank.keyInfo': 'As taxas são condicionais; a melhor hunt depende da métrica escolhida.',
            'rank.unknown': 'Sem dados',
            'rank.learning': 'Aprendendo',
            'rank.unverified': 'Não verificado',
            'diag.toggle': 'Diagnóstico local da estimativa (desligado por padrão)',
            'diag.title': 'Evidências resumidas · somente local',
            'diag.source': 'origem: {source} · janela de amostras: {window} · cobertura do modelo: {coverage}%',
            'diag.noWindow': 'sem janela medida',
            'diag.caveat': 'Nenhuma mensagem bruta, token, nome ou ID de conta é exportado ou enviado.',
            'sort.coins': 'Moedas/h por abate',
            'sort.netCoins': 'Moedas líquidas/h (medido)',
            'econ.title': 'Economia da hunt · {hunt}',
            'econ.kill': 'Moedas/h dos abates',
            'econ.loot': 'EV/h de loot vendável ao NPC',
            'econ.realized': 'Moedas/h realizadas',
            'econ.net': 'Moedas líquidas/h',
            'econ.cost': 'Reposição dos itens consumidos',
            'econ.diamonds': 'Diamantes/h (separado)',
            'econ.model': 'modelo-base (sem bônus, nível da hunt)',
            'econ.observed': 'recibos observados do servidor',
            'econ.estimatedLoot': 'loot reconstruído do catálogo · cobertura {coverage}% (drops do servidor não verificados)',
            'econ.netCaveat': 'Líquido = moedas realizadas na hunt menos custo de reposição de bolas/poções/revives usados, não variação do saldo. Loot guardado e vendas futuras não entram.',
            'econ.noPrice': 'Custo indisponível: falta preço oficial de {count} usos',
            'econ.unlinked': 'Líquido indisponível: {count} evento(s) de bola sem associação confiável a um corpo',
            'econ.stock': 'Estoque {count} · duração {hours}h no ritmo observado',
            'econ.unknown': '— (evidência insuficiente)',
            'rare.heading': 'Farming raro · prévia do tier',
            'rare.outland': 'Drops raros da Outland',
            'rare.egg': 'Fragmento de Ovo Shiny',
            'rare.preview': 'Comparar Outland',
            'rare.active': 'Ativa no jogo: Outland {tier}',
            'rare.activeUnknown': 'Tier ativo no jogo: ainda não informado pelo estado',
            'rare.fallback': 'Tier informado {reported} ajustado ao tier permitido {effective} para o nível atual',
            'rare.select': 'Usar este tier no jogo',
            'rare.pending': 'Troca solicitada; aguardando confirmação do jogo',
            'rare.locked': 'Bloqueado: requer nível de treinador {level}',
            'rare.previewOnly': 'Apenas prévia; não altera a hunt nem o tier ativo',
            'rare.noCommand': 'Troca no jogo indisponível até o estado informar o tier atual',
            'rare.source': '{source} · {rate} abates/h ({rateSource})',
            'rare.kills': 'por abate',
            'rare.units': '{value} itens/h',
            'rare.mean': 'média {hours}h / item',
            'rare.craft': 'média {hours}h / 10 fragmentos',
            'rare.chances': '≥1 em 1h: {hour}% · 24h: {day}%',
            'rare.incubation': 'Incubação do Ovo Shiny: 168h após fabricar (126h com aquecimento confirmado)',
            'rare.observed': 'Observado nesta sessão: {count}',
            'rare.marketUnknown': 'Valoração por vendas concluídas: — (sem amostras verificadas)',
            'rare.uncertainty': 'Modelo sem bônus e com sorteios independentes; tempos médios NÃO garantem drops. Loot Boost, guilda/eventos, exclusividade dos sorteios e servidor da Bicicleta não estão verificados.',
            'rare.notEligible': 'Esta hunt não tem o drop raro modelado',
            'rare.noRate': 'Abates/h indisponíveis; previsão aquecendo',
            'rare.huntContext': 'Hunt de base: {hunt} (a Outland usa o mesmo mapa em todos os tiers)',
            'xp.sourceLabel': 'fonte: {source}',
            'xp.sourceMeasured': 'recompensas do servidor (medidas)',
            'xp.sourceModel': 'projeção personalizada de combate',
            'xp.sourceBaseline': 'estimativa-base sem bônus',
            'xp.sourceImmunity': 'imunidade conhecida',
            'xp.ranged': 'faixa heurística {low}–{high} XP de treinador/h',
            'xp.unboosted': 'XP modelado não inclui bônus não verificados de VIP, guilda, lives, eventos ou catch-up',
            'xp.uncertainLeader': 'Candidato principal (incerto): {hunt}',
            'xp.fallback': 'motivo: {reason}',
            'xp.calibration': 'comparado com {count} hunt(s) neste contexto; erro absoluto mediano {error}%',
            'xp.unknownPokemon': 'evento de XP do Pokémon incompleto (não somado ao XP do treinador)',
            'xp.modelNote': ' · curva oficial de XP; amostras reais de combate têm prioridade sobre estimativas experimentais do índice de golpes.',
            'xp.possibleMoves': '{count} golpes possíveis neste nível (não confirmados como equipados)',
            'xp.knownMoves': '{count} golpes identificados nos eventos de combate',
            'xp.namesUnavailable': 'Sem nomes de golpes identificados nos eventos; usando medidas por tipo de ataque',
            'xp.protocol': 'Acertos do jogador: {total} · com nome {named} · sem nome {unnamed}',
            'xp.protocolKeys': 'Campos de ataque sem nome: {keys}',
            'xp.indexedMoveSummary': 'Ataques possíveis: {moves}',
            'xp.observedMoveSummary': 'Ataques observados: {moves}',
            'xp.moveConfidence': 'Modelo dos golpes: {confidence}',
            'xp.confidence.high': 'medido',
            'xp.confidence.medium': 'parcialmente medido',
            'xp.confidence.low': 'experimental',
            'arcade.open': '🎮 Correio Maluco',
            'arcade.back': '← Voltar ao Atlas',
            'arcade.title': '📦 Correio Maluco: Expresso Outland',
            'arcade.subtitle': 'Entregue encomendas absurdas nas hunts. Os fantasmas fiscais estão atrás de você.',
            'arcade.region': 'Região',
            'arcade.score': 'Entregas',
            'arcade.best': 'Recorde',
            'arcade.hearts': 'Vidas',
            'arcade.time': 'Tempo',
            'arcade.target': 'Entregar em',
            'arcade.start': 'Começar entregas',
            'arcade.restart': 'Reiniciar',
            'arcade.resume': 'Continuar',
            'arcade.ready': 'Aperte Começar para entregar bobagens',
            'arcade.running': 'Fuja dos fiscais fantasmas!',
            'arcade.paused': 'Pausado — aperte Continuar',
            'arcade.gameOver': 'Demitido pelos Correios',
            'arcade.finished': '{score} entregas. O gerente não está satisfeito.',
            'arcade.delivered': 'Encomenda entregue em {hunt}!',
            'arcade.ouch': 'Colisão burocrática!',
            'arcade.instructions': 'Foque no tabuleiro e use WASD / setas, arraste nele ou use os botões abaixo.',
            'arcade.loading': 'Carregando o índice de hunts no mapa…',
            'arcade.unavailable': 'Índice de locais indisponível. Tente abrir o Atlas novamente.',
            'arcade.disclaimer': 'As estradas são inventadas, as coordenadas distorcidas e nada aqui move seu Pokémon ou concede XP real.',
            'arcade.up': 'Cima', 'arcade.down': 'Baixo',
            'arcade.left': 'Esquerda', 'arcade.right': 'Direita',
            'xp.incompleteShort': '⚠ modelo cobre {percentage}%',
            'xp.incompleteDetail': 'Modelo personalizado incompleto: {covered}/{total} pontos de aparição cobertos ({percentage}%); usando modelo-base, sem ignorar inimigos.',
            'status.movesUnavailable': ' · índice de golpes indisponível',
            'location.shared': 'Mesma zona mapeada: {hunts}',
            'location.coverage': 'Hunts com localização: {matched}/{total} · {conflicts} níveis divergentes no índice',
            'xp.catalogMoves': '{count} candidatos do catálogo de Pokémon (índice complementar)',
            'xp.moveDisagreements': '{count} golpes diferentes entre índice e catálogo',
            'location.coordinates': 'Local no mundo: {region} · {x}, {y} (apenas referência)',
            'status.locationsUnavailable': ' · índice de locais indisponível',
            'results.showMore': 'Mostrar mais · restam {count} Pokémon',
            'results.noMatch': 'Nenhum Pokémon corresponde aos filtros. Use Limpar filtros para redefinir o Atlas.',
            'results.waiting': 'Aguardando os dados de hunts do PokéIdle. Recarregue a página uma vez após instalar o Hunt Atlas se isto continuar vazio.',
            'results.count': '{pokemon} Pokémon',
            'results.countPartial': '{shown}/{pokemon} Pokémon',
            'status.waitingGameData': 'Aguardando dados do jogo…',
            'status.cachedCatalog': 'Usando o catálogo de hunts em cache até chegarem dados atuais.',
            'status.entered': 'Entrou em {hunt}.',
            'status.huntsLoaded': '{count} regiões de hunt carregadas.',
            'status.gameNotReady': 'A conexão com o jogo ainda não está pronta.',
            'status.traveling': 'Indo para {hunt}…',
            'status.notAccepted': 'O PokéIdle não aceitou {hunt}. A área pode estar bloqueada ou a troca de hunt pode estar em cooldown.',
            'status.couldNotSend': 'Não foi possível enviar a troca de hunt.',
            'status.huntLocked': '{hunt} está bloqueada — requer nível {level}.',
            'status.alreadyHere': 'Você já está caçando em {hunt}.',
            'status.loadingTypes': ' · carregando tipos',
            'status.typesUnavailable': ' · dados de tipo indisponíveis',
            'status.marketSampling': ' · amostrando preços do Mercado',
            'type.NORMAL': 'Normal',
            'type.FIRE': 'Fogo',
            'type.WATER': 'Água',
            'type.ELECTRIC': 'Elétrico',
            'type.GRASS': 'Planta',
            'type.ICE': 'Gelo',
            'type.FIGHTING': 'Lutador',
            'type.POISON': 'Veneno',
            'type.GROUND': 'Terra',
            'type.FLYING': 'Voador',
            'type.PSYCHIC': 'Psíquico',
            'type.BUG': 'Inseto',
            'type.ROCK': 'Pedra',
            'type.GHOST': 'Fantasma',
            'type.DRAGON': 'Dragão',
            'type.DARK': 'Sombrio',
            'type.STEEL': 'Aço',
            'type.FAIRY': 'Fada'
        }
    };

    function currentLocale() {
        let gameLanguage = null;

        try {
            gameLanguage =
                localStorage.getItem(
                    'idioma'
                );
        } catch {}

        if (gameLanguage) {
            return gameLanguage ===
                'pt'
                ? 'pt-BR'
                : 'en';
        }

        const htmlLanguage =
            String(
                document.documentElement
                    ?.lang ||
                ''
            ).toLowerCase();

        if (htmlLanguage) {
            return htmlLanguage.startsWith(
                'pt'
            )
                ? 'pt-BR'
                : 'en';
        }

        const browserLanguage =
            String(
                navigator.language ||
                ''
            ).toLowerCase();

        return browserLanguage.startsWith(
            'pt'
        )
            ? 'pt-BR'
            : 'en';
    }

    function tr(
        key,
        params = null
    ) {
        const dictionary =
            TEXT[currentLocale()] ||
            TEXT.en;

        let value =
            dictionary[key] ??
            TEXT.en[key] ??
            key;

        if (!params) {
            return value;
        }

        return value.replace(
            /\{(\w+)\}/g,
            (
                whole,
                name
            ) =>
                params[name] !==
                    undefined
                    ? String(
                        params[name]
                    )
                    : whole
        );
    }

    function typeLabel(
        type
    ) {
        return tr(
            'type.' +
            String(
                type ||
                ''
            ).toUpperCase()
        );
    }

    function localizedNumber(
        value
    ) {
        return Number(
            value ||
            0
        ).toLocaleString(
            currentLocale()
        );
    }

    function loadAtlasEnabled() {
        try {
            return (
                localStorage.getItem(
                    ENABLED_KEY
                ) !== '0'
            );
        } catch {
            return true;
        }
    }

    function saveAtlasEnabled(
        enabled
    ) {
        try {
            localStorage.setItem(
                ENABLED_KEY,
                enabled
                    ? '1'
                    : '0'
            );
        } catch {}
    }

    const q =
        (selector, root = document) =>
            root.querySelector(selector);

    const qa =
        (selector, root = document) =>
            [...root.querySelectorAll(selector)];

    const initialMarketCache =
        loadMarketCache();

    const state = {
        rateGeneration: 1,
        farmingSessionToken: Math.random().toString(36).slice(2),
        farmingLedger: makeFarmingLedger(),
        farmingSnapshot: {},
        outlandTierSeen: false,
        pendingOutlandTier: null,
        outlandCatalogTiers: null,
        xpBonusState: {},
        itemCatalogStatus: 'idle',
        itemsByName: new Map(),
        itemsById: new Map(),
        npcLootBySpecies: new Map(),
        ballPrices: new Map(),
        itemPrices: new Map(),
        captureBallRates: new Map(),
        captureRarities: new Map(),
        captureBonusEvidence: {},
        captureChanceEvidence: {seen:0,min:null,max:null},
        inventoryForCosts: new Map(),
        calibrationEvidence: new Map(),
        hunts: [],
        playerLevel: 0,
        currentHuntSlug: null,
        huntSceneKnown: false,
        huntScene: {
            noCentro: false,
            casaDentro: null,
            bossArena: null,
            mistico: false
        },

        pokedex: new Map(),
        ownedSpecies: new Set(),
        pokemons: new Map(),
        strongestPokemon: null,
        activePokemonId: null,
        lastLeadPokemon: null,

        huntPerf: loadPerformance(),

        marketValues:
            initialMarketCache.values,
        marketCacheSavedAt:
            initialMarketCache.savedAt,
        marketStatus:
            initialMarketCache.values.size
                ? 'cached'
                : 'idle',
        marketFetch: null,
        marketListingFetch:
            null,

        combatTargets: new Map(),
        speciesCombat: new Map(),
        combatCatalogStatus: 'idle',
        combatCatalogPromise: null,
        locationsBySlug: new Map(),
        locationsByRange: new Map(),
        locationIndexDiagnostics: { loaded: 0 },
        locationLastAttempt: 0,
        locationIndexStatus: 'idle',
        locationIndexPromise: null,
        movesBySpecies: new Map(),
        movesByName: new Map(),
        moveLastAttempt: 0,
        moveIndexStatus: 'idle',
        moveIndexPromise: null,
        moveIndexGeneratedAt: '',
        combatRevision: 0,
        battleDiagnostics: {
            playerEvents: 0, namedEvents: 0, unnamedEvents: 0,
            lastUnnamedKeys: [], lastSeenAt: 0,
            explicitCastEvents: 0, heuristicGroupedEvents: 0,
            unnamedGroupedEvents: 0
        },
        combatProfileCache: null,
        estimateCache: new Map(),
        estimateCacheKey: '',

        serverTypeChart: null,
        huntAmplification: 1.5,

        typesBySpecies: new Map(),
        typeStatus: 'idle',

        lockOverrides: new Map(),

        drawerOpen: false,
        atlasEnabled:
            loadAtlasEnabled(),
        nativeMapTitle: null,
        lastLocale: null,
        resultLimit: 120,
        xpDetailsOpen: true,
        diagnosticsEnabled: false,
        lastDrawerRenderAt: 0,
        drawerRenderTimer: null,
        renderStats: {attempts:0,skipped:0},
        mapObserver: null,
        mapSyncQueued: false,
        keyboardBound: false,
        websocketHookInstalled: false,
        sockets: 0,
        activeSocket: null,
        pendingTravel: null,

        status: {
            key:
                'status.waitingGameData',
            params: {}
        },

        filters: loadFilters(),

        renderQueued: false
    };

    function normalize(value) {
        return String(value ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function defaultFilters() {
        return {
            search: '',
            region: 'all',
            minLevel: '',
            maxLevel: '',
            type: 'all',
            weakness: [],
            weaknessMatchAll: false,
            availability: 'unlocked',
            captured: 'all',
            sort: 'xp',
            outlandPreviewTier: 1,
            captureBall: 'ultra',
            shinyLurePreview: false,
            rareSortItem: 70000,
            detailOpen: false,
            sortDirection: 'desc'
        };
    }

    function loadFilters() {
        const defaults =
            defaultFilters();

        try {
            const saved =
                JSON.parse(
                    localStorage.getItem(
                        FILTER_KEY
                    ) || '{}'
                );

            const next = {
                ...defaults,
                ...saved
            };
            const preview=Number(next.outlandPreviewTier);
            next.outlandPreviewTier=Number.isInteger(preview)&&preview>=1&&
                preview<=8?preview:1;
            next.captureBall=['ultra','beast'].includes(next.captureBall)
                ?next.captureBall:'ultra';
            next.shinyLurePreview=next.shinyLurePreview===true;
            next.rareSortItem=[70000,70011,70012,70013,70017].includes(
                Number(next.rareSortItem))?Number(next.rareSortItem):70000;
            next.detailOpen=next.detailOpen===true;

            if (typeof next.weakness === 'string') {
                next.weakness =
                    next.weakness === 'all' || !next.weakness
                        ? []
                        : [next.weakness];
            } else if (!Array.isArray(next.weakness)) {
                next.weakness = [];
            }

            next.weakness = [
                ...new Set(
                    next.weakness
                        .map(value => String(value).toUpperCase())
                        .filter(value => STANDARD_TYPES.includes(value))
                )
            ];

            next.weaknessMatchAll =
                Boolean(next.weaknessMatchAll) &&
                next.weakness.length > 1;

            const legacySorts = {
                npc_desc: [
                    'npc',
                    'desc'
                ],
                npc_asc: [
                    'npc',
                    'asc'
                ],
                player_market_desc: [
                    'player_market',
                    'desc'
                ],
                player_market_asc: [
                    'player_market',
                    'asc'
                ],
                market_desc: [
                    'player_market',
                    'desc'
                ],
                market_asc: [
                    'player_market',
                    'asc'
                ],
                default: [
                    'pokedex',
                    'asc'
                ],
                spawn_desc: [
                    'xp',
                    'desc'
                ],
                level_desc: [
                    'level',
                    'desc'
                ],
                level_asc: [
                    'level',
                    'asc'
                ]
            };

            if (
                legacySorts[
                    next.sort
                ]
            ) {
                [
                    next.sort,
                    next.sortDirection
                ] =
                    legacySorts[
                        next.sort
                    ];
            } else if (
                saved.sortDirection ===
                    undefined
            ) {
                next.sortDirection =
                    (
                        next.sort ===
                            'name' ||
                        next.sort ===
                            'pokedex'
                    )
                        ? 'asc'
                        : 'desc';
            }

            if (
                next.sort ===
                    'spawn'
            ) {
                next.sort =
                    'xp';
                next.sortDirection =
                    'desc';
            }

            const validSorts = [
                'xp',
                'pokemonXp',
                'coins',
                'npcLoot',
                'netCoins',
                'rare',
                'ballEfficiency',
                'capture',
                'shinyCatch',
                'name',
                'pokedex',
                'level',
                'npc',
                'player_market',
                'matchup'
            ];

            if (
                !validSorts.includes(
                    next.sort
                )
            ) {
                next.sort =
                    defaults.sort;
            }

            if (
                next.sortDirection !==
                    'asc' &&
                next.sortDirection !==
                    'desc'
            ) {
                next.sortDirection =
                    defaults.sortDirection;
            }

            return next;
        } catch {
            return defaults;
        }
    }

    function activeFilterCount() {
        const defaults =
            defaultFilters();

        return Object.keys(
            defaults
        ).filter(
            key => {
                if (key === 'sort' || key === 'sortDirection') {
                    return false;
                }

                if (key === 'weakness') {
                    return Array.isArray(state.filters.weakness) &&
                        state.filters.weakness.length > 0;
                }

                if (key === 'weaknessMatchAll') {
                    return Boolean(state.filters.weaknessMatchAll);
                }

                return String(state.filters[key] ?? '') !==
                    String(defaults[key] ?? '');
            }
        ).length;
    }

    function saveFilters() {
        localStorage.setItem(
            FILTER_KEY,
            JSON.stringify(
                state.filters
            )
        );
    }

    function setStatus(
        key,
        params = {}
    ) {
        state.status = {
            key,
            params
        };
    }

    function localizedStatus() {
        if (
            typeof state.status ===
                'string'
        ) {
            return state.status;
        }

        return tr(
            state.status?.key ||
                'status.waitingGameData',
            state.status?.params ||
                {}
        );
    }

    function loadMarketCache() {
        try {
            const raw =
                JSON.parse(
                    localStorage.getItem(
                        MARKET_CACHE_KEY
                    ) || 'null'
                );

            const savedAt =
                Number(
                    raw?.savedAt ||
                    0
                );

            if (
                !savedAt ||
                Date.now() - savedAt >
                    MARKET_CACHE_MAX_AGE_MS ||
                !raw?.values ||
                typeof raw.values !==
                    'object'
            ) {
                return {
                    savedAt: 0,
                    values: new Map()
                };
            }

            return {
                savedAt,
                values:
                    new Map(
                        Object.entries(
                            raw.values
                        )
                    )
            };
        } catch {
            return {
                savedAt: 0,
                values: new Map()
            };
        }
    }

    function saveMarketCache() {
        try {
            localStorage.setItem(
                MARKET_CACHE_KEY,
                JSON.stringify({
                    savedAt:
                        state.marketCacheSavedAt,
                    values:
                        Object.fromEntries(
                            state.marketValues
                        )
                })
            );
        } catch {}
    }

    function loadPerformance() {
        try {
            const raw =
                JSON.parse(
                    localStorage.getItem(
                        PERF_KEY
                    ) || '{}'
                );

            return new Map(
                Object.entries(raw)
            );
        } catch {
            return new Map();
        }
    }

    function savePerformance() {
        try {
            const entries =
                [...state.huntPerf.entries()]
                    .sort(
                        (a, b) =>
                            Number(
                                b[1]?.updatedAt ||
                                0
                            ) -
                            Number(
                                a[1]?.updatedAt ||
                                0
                            )
                    );

            /*
             * Records are level-specific for accuracy. Keep a generous
             * rolling history without letting localStorage grow forever.
             */
            if (
                entries.length >
                160
            ) {
                for (
                    const [
                        key
                    ] of
                    entries.slice(
                        160
                    )
                ) {
                    state.huntPerf.delete(
                        key
                    );
                }
            }

            localStorage.setItem(
                PERF_KEY,
                JSON.stringify(
                    Object.fromEntries(
                        state.huntPerf
                    )
                )
            );
        } catch {}
    }

    function pokemonPower(
        pokemon
    ) {
        const direct =
            Number(
                pokemon?.poder
            );

        if (
            Number.isFinite(direct) &&
            direct > 0
        ) {
            return direct;
        }

        const stats =
            pokemon?.stats || {};

        return [
            stats.hp,
            stats.atk,
            stats.def,
            stats.spAtk,
            stats.spDef,
            stats.speed
        ]
            .map(Number)
            .filter(Number.isFinite)
            .reduce(
                (sum, value) =>
                    sum + value,
                0
            );
    }

    function refreshStrongestPokemon() {
        const owned =
            [...state.pokemons.values()];

        state.strongestPokemon =
            owned
                .sort(
                    (a, b) =>
                        pokemonPower(b) -
                            pokemonPower(a) ||
                        Number(b.level || 0) -
                            Number(a.level || 0)
                )[0] || null;
    }

    function strongestSignature() {
        const pokemon =
            state.strongestPokemon;

        if (!pokemon) {
            return null;
        }

        return [
            pokemon.id,
            pokemon.speciesId,
            pokemon.level,
            Math.round(
                pokemonPower(pokemon)
            )
        ].join(':');
    }

    function formatRate(
        value
    ) {
        const n =
            Number(value);

        if (
            !Number.isFinite(n) ||
            n <= 0
        ) {
            return '—';
        }

        if (n >= 1000000000) {
            return (
                n / 1000000000
            ).toFixed(
                n >= 10000000000
                    ? 0
                    : 1
            ) + 'b';
        }

        if (n >= 1000000) {
            return (
                n / 1000000
            ).toFixed(
                n >= 10000000
                    ? 0
                    : 1
            ) + 'm';
        }

        if (n >= 1000) {
            return (
                n / 1000
            ).toFixed(
                n >= 100000
                    ? 0
                    : 1
            ) + 'k';
        }

        return Math.round(n)
            .toLocaleString();
    }

    function leadPokemon() {
        const active =
            state.pokemons.get(
                Number(
                    state.activePokemonId
                )
            );

        const available =
            active ||
            state.strongestPokemon ||
            null;

        /*
         * The game can briefly publish activeId=null between fights or while
         * changing targets. Keep the last valid lead for recommendations
         * instead of blanking the XP panel during that transient state.
         */
        if (available) {
            state.lastLeadPokemon = available;
        }

        return (
            available ||
            state.lastLeadPokemon ||
            null
        );
    }

    function leadLoadoutSignature(
        pokemon =
            leadPokemon()
    ) {
        if (!pokemon) {
            return null;
        }

        const stats = pokemon.stats || {};
        const iv = pokemon.ivs || pokemon.iv || {};
        // Include battle-relevant values, NOT volatile current HP/XP or
        // cooldown timers. A refreshed same-ID Pokémon can change combat stats.
        const battleStats = ['atk', 'def', 'spAtk', 'spDef', 'speed']
            .map(key => stats[key] ?? '?');
        const speedIv = pokemon.speedIV ?? pokemon.speedIv ??
            iv.speed ?? iv.spd ?? '?';
        const moves = Array.isArray(pokemon.attacks)
            ? pokemon.attacks.slice(0, 20).map(move => [
                move?.name, move?.type, move?.category, move?.power
            ].join(':')).sort().join(',') : '';
        return [
            pokemon.id,
            pokemon.speciesId,
            pokemon.tmElemental,
            pokemon.tmAoe,
            pokemon.heldItemId,
            pokemon.megaId || pokemon.mega || '',
            speedIv, ...battleStats, moves
        ]
            .map(
                value =>
                    value ??
                    ''
            )
            .join(':');
    }

    function leadSignature(
        pokemon =
            leadPokemon()
    ) {
        const loadout =
            leadLoadoutSignature(
                pokemon
            );

        if (!loadout) {
            return null;
        }

        /* Exact measurement identity includes level. */
        return (
            loadout +
            ':L' +
            Number(
                pokemon?.level ||
                0
            )
        );
    }
    function isHuntHere(
        slug =
            state.currentHuntSlug
    ) {
        if (
            !slug ||
            !state.huntSceneKnown
        ) {
            return false;
        }

        const scene =
            state.huntScene;

        return !(
            scene.noCentro ||
            scene.casaDentro ||
            scene.bossArena ||
            scene.mistico
        ) &&
            slug ===
                state.currentHuntSlug;
    }

    function currentHunt() {
        if (
            !isHuntHere()
        ) {
            return null;
        }

        return (
            state.hunts.find(
                hunt =>
                    hunt.slug ===
                    state.currentHuntSlug
            ) ||
            null
        );
    }

    function farmingSnapshotScope() {
        return [state.farmingSnapshot.outlandTier ?? '?',
            state.farmingSnapshot.catalogRevision ?? '?',
            state.farmingSnapshot.boostSignature ?? '?',
            xpBonusScope(state.xpBonusState)].join('|');
    }

    function performanceKey(
        huntSlug,
        pokemon =
            leadPokemon()
    ) {
        const signature =
            leadSignature(
                pokemon
            );

        if (
            !huntSlug ||
            !signature
        ) {
            return null;
        }

        return (
            huntSlug + '|' + signature + '|session:' +
            state.farmingSessionToken + ':' + state.rateGeneration +
            '|tier:' + (state.farmingSnapshot.outlandTier ?? '?') +
            '|catalog:' + (state.farmingSnapshot.catalogRevision ?? '?') +
            '|boost:' + (state.farmingSnapshot.boostSignature ?? '?') +
            '|xpBonus:' + xpBonusScope(state.xpBonusState)
        );
    }

    function createPerformanceRecord(
        huntSlug,
        pokemon
    ) {
        return {
            version: 5,
            rateGeneration: state.rateGeneration,
            sessionToken: state.farmingSessionToken,
            snapshotScope: farmingSnapshotScope(),
            rateWindow: null,
            captureWindow: null,
            huntSlug,
            signature:
                leadSignature(
                    pokemon
                ),
            loadoutSignature:
                leadLoadoutSignature(
                    pokemon
                ),
            pokemonId:
                pokemon?.id ??
                null,
            pokemonSpeciesId:
                pokemon?.speciesId ??
                null,
            pokemonName:
                pokemon?.nome ||
                null,
            pokemonLevel:
                Number(
                    pokemon?.level ||
                    0
                ),
            pokemonPower:
                pokemonPower(
                    pokemon
                ),

            kills: 0,
            trainerXp: 0,
            pokemonXp: 0,
            gold: 0,
            rateUseWindow: null,
            speciesKills: {},

            killIntervals: [],
            sameTargetIntervals: [],
            transitionIntervals: [],
            allAttackIntervals: [],

            attacks: 0,
            damage: 0,
            moveDamage: {},
            attackObservations: [],
            hpSamples: [],
            trainerXpMultSamples: [],
            pokemonXpMultSamples: [],
            xpBonusTransitions: [],
            lastTrainerBonusRatio: null,
            lastPokemonBonusRatio: null,
            predictedBeforeMeasurement: null,

            firstEventAt: 0,
            lastEventAt: 0,
            lastKillAt: 0,
            lastAttackAt: 0,
            lastAttackSlot: null,

            updatedAt:
                Date.now()
        };
    }

    function performanceRecord(
        huntSlug =
            state.currentHuntSlug,
        create = false
    ) {
        const pokemon =
            leadPokemon();

        const key =
            performanceKey(
                huntSlug,
                pokemon
            );

        if (!key) {
            return null;
        }

        let record =
            state.huntPerf.get(
                key
            );

        if (
            !record &&
            create
        ) {
            record =
                createPerformanceRecord(
                    huntSlug,
                    pokemon
                );

            state.huntPerf.set(
                key,
                record
            );
        }

        return record;
    }

    function pushSample(
        record,
        key,
        value,
        max = 80
    ) {
        const number =
            Number(value);

        if (
            !Number.isFinite(
                number
            ) ||
            number < 0
        ) {
            return;
        }

        if (
            !Array.isArray(
                record[key]
            )
        ) {
            record[key] = [];
        }

        record[key].push(
            number
        );

        if (
            record[key].length >
            max
        ) {
            record[key].splice(
                0,
                record[key].length -
                    max
            );
        }
    }

    function robustMean(
        values
    ) {
        const clean =
            (
                Array.isArray(values)
                    ? values
                    : []
            )
                .map(Number)
                .filter(
                    value =>
                        Number.isFinite(
                            value
                        ) &&
                        value >= 0
                )
                .sort(
                    (a, b) =>
                        a - b
                );

        if (!clean.length) {
            return null;
        }

        let from = 0;
        let to =
            clean.length;

        if (
            clean.length >=
            10
        ) {
            const trim =
                Math.floor(
                    clean.length *
                    0.1
                );

            from =
                trim;

            to =
                clean.length -
                trim;
        }

        const slice =
            clean.slice(
                from,
                to
            );

        return (
            slice.reduce(
                (sum, value) =>
                    sum + value,
                0
            ) /
            slice.length
        );
    }

    function average(
        values
    ) {
        const clean =
            (
                Array.isArray(values)
                    ? values
                    : []
            )
                .map(Number)
                .filter(
                    value =>
                        Number.isFinite(
                            value
                        ) &&
                        value >= 0
                );

        if (!clean.length) {
            return null;
        }

        return (
            clean.reduce(
                (sum, value) =>
                    sum + value,
                0
            ) /
            clean.length
        );
    }

    function median(
        values
    ) {
        const clean =
            (
                Array.isArray(values)
                    ? values
                    : []
            )
                .map(Number)
                .filter(
                    Number.isFinite
                )
                .sort(
                    (a, b) =>
                        a - b
                );

        if (!clean.length) {
            return null;
        }

        const middle =
            Math.floor(
                clean.length /
                2
            );

        return clean.length % 2
            ? clean[middle]
            : (
                clean[
                    middle - 1
                ] +
                clean[
                    middle
                ]
            ) /
                2;
    }

    /*
     * Exact upstream XP curve from shared/sell-value.mjs.
     */
    function xpDoNivel(level) {
        return farmingXpForLevel(level);
    }

    function goldValueAtLevel(
        level
    ) {
        const n =
            Math.max(
                1,
                Number(level) ||
                1
            );

        return Math.round(
            SELL_VALUE_ANCHOR_GOLD *
            Math.pow(
                n /
                    SELL_VALUE_ANCHOR_LEVEL,
                0.6
            )
        );
    }

    function normalizedNpcBaseFromCatalog(
        meta
    ) {
        if (!meta) {
            return 0;
        }

        const huntLevel =
            Math.max(
                1,
                Number(
                    meta.huntLevel
                ) ||
                1
            );

        const rawSell =
            Number(
                meta.catalogSellValue
            );

        const rawNpc =
            Number(
                meta.priceNpc
            );

        let value;

        /*
         * Mirrors normalizarSellValue()/valorEconomicoDe().
         * High-region rows are always derived from their hunt level. For the
         * raw mirror, a >500k value is not trusted as an economic value.
         */
        if (
            huntLevel >
                SELL_VALUE_ANCHOR_LEVEL
        ) {
            value =
                goldValueAtLevel(
                    huntLevel
                );
        } else if (
            Number.isFinite(rawSell) &&
            rawSell > 0 &&
            rawSell <=
                NPC_CATALOG_PRICE_MAX
        ) {
            value = rawSell;
        } else if (
            Number.isFinite(rawSell) &&
            rawSell >
                NPC_CATALOG_PRICE_MAX
        ) {
            value =
                goldValueAtLevel(
                    huntLevel
                );
        } else if (
            Number.isFinite(rawNpc) &&
            rawNpc > 0 &&
            rawNpc <=
                NPC_CATALOG_PRICE_MAX
        ) {
            value = rawNpc;
        } else {
            value =
                goldValueAtLevel(
                    huntLevel
                );
        }

        /*
         * Mirrors sellValueBaseDe(): sale pricing has its own economic cap,
         * independent of the raw species catalog.
         */
        return Math.min(
            Math.max(
                1,
                value
            ),
            NPC_SELL_BASE_CAP
        );
    }

    function touchRecord(
        record,
        now =
            Date.now()
    ) {
        if (!record) {
            return;
        }

        if (
            !record.firstEventAt
        ) {
            record.firstEventAt =
                now;
        }

        const pokemon =
            leadPokemon();

        if (pokemon) {
            record.pokemonLevel =
                Number(
                    pokemon.level ||
                    0
                );

            record.pokemonPower =
                pokemonPower(
                    pokemon
                );

            record.pokemonSpeciesId =
                pokemon.speciesId ??
                record.pokemonSpeciesId;

            record.pokemonName =
                pokemon.nome ||
                record.pokemonName;
        }

        record.lastEventAt =
            now;

        record.updatedAt =
            now;

        state.combatRevision++;
        state.combatProfileCache =
            null;
    }

    function combatSlot(
        event
    ) {
        const value =
            event?.slot ??
            event?.s;

        if (
            value ===
                undefined ||
            value === null
        ) {
            return null;
        }

        return String(
            value
        );
    }

    function recordTargetHp(
        record,
        target
    ) {
        if (
            !record ||
            !target ||
            target.hpRecorded
        ) {
            return;
        }

        const maxHp =
            Number(
                target.maxHp
            );

        const level =
            Number(
                target.level
            );

        if (
            !Number.isFinite(
                maxHp
            ) ||
            maxHp <= 0 ||
            !Number.isFinite(
                level
            ) ||
            level <= 0
        ) {
            return;
        }

        if (
            !Array.isArray(
                record.hpSamples
            )
        ) {
            record.hpSamples =
                [];
        }

        record.hpSamples.push({
            speciesId:
                Number(
                    target.speciesId
                ) ||
                null,
            level,
            maxHp
        });

        if (
            record.hpSamples.length >
            120
        ) {
            record.hpSamples.splice(
                0,
                record.hpSamples.length -
                    120
            );
        }

        target.hpRecorded =
            true;
    }

    function recordSpawnEvent(
        event
    ) {
        const slot =
            combatSlot(
                event
            );

        if (!slot) {
            return;
        }

        const hp =
            Number(
                event?.maxHp ??
                event?.hp
            );

        farmingSpawn(state.farmingLedger, slot);

        state.combatTargets.set(
            slot,
            {
                slot,
                speciesId:
                    Number(
                        event?.speciesId ??
                        event?.pokeId
                    ) ||
                    null,
                name:
                    event?.nome ||
                    null,
                level:
                    Number(
                        event?.level
                    ) ||
                    Number(
                        currentHunt()
                            ?.nivel
                    ) ||
                    1,
                maxHp:
                    Number.isFinite(
                        hp
                    )
                        ? hp
                        : null,
                playerAttacks: 0,
                hpRecorded:
                    false,
                seenAt:
                    Date.now()
            }
        );
    }


    // Move identity is optional in the battle protocol. Do not use event.nome:
    // in spawn/death messages that field usually names the creature.
    function namedMoveFromAttack(event) {
        const fields = [
            event?.golpe?.name, event?.golpe?.nome,
            event?.movimento?.name, event?.movimento?.nome,
            event?.golpe, event?.nomeGolpe, event?.golpeNome,
            event?.moveName, event?.move, event?.ataqueNome,
            event?.ataque?.name, event?.ataque?.nome,
            typeof event?.ataque === 'string' ? event.ataque : null
        ];
        const found = fields.find(value => typeof value === 'string' &&
            value.trim().length > 0 && value.length <= 80);
        if (found) return found.trim();
        // Some versions may put the move in a generic name/skill field.
        // Accept such a value ONLY if it matches a species-specific known
        // move with the attack's type. This prevents a Pokémon name from
        // being confused with the name of its attack.
        const ambiguous = [event?.nome, event?.skill, event?.habilidade];
        const known = movesForLead();
        const type = String(event?.tipo || '').toUpperCase();
        const candidate = ambiguous.find(value => typeof value === 'string' &&
            value.length <= 80 && known.some(move =>
                moveNameKey(move.name) === moveNameKey(value) &&
                move.type === type));
        return candidate ? candidate.trim() : null;
    }

    // A transient, bounded cast ledger. Never persist raw cast IDs.
    const recentAttackCasts = new WeakMap();

    function explicitAttackCastId(event) {
        // Generic golpeId/ataqueId identify abilities, not executions.
        const candidates = [
            event?.castId, event?.castID, event?.cast_id,
            event?.attackCastId, event?.execucaoId,
            event?.execucaoGolpeId, event?.idExecucao,
            event?.ataque?.castId, event?.golpe?.castId,
            event?.movimento?.castId
        ];
        const value = candidates.find(v =>
            (typeof v === 'string' || typeof v === 'number') &&
            String(v).trim().length > 0 && String(v).length <= 80);
        return value === undefined ? null : String(value);
    }

    function identifyAttackCast(record, event, now, slot, nameKey, type) {
        const explicitId = explicitAttackCastId(event);
        let recent = recentAttackCasts.get(record) || [];
        recent = recent.filter(group => now >= group.startedAt &&
            now - group.startedAt <= 3000).slice(-16);
        let group = null;
        if (explicitId !== null) {
            group = recent.find(row =>
                row.explicitId === explicitId && row.type === type &&
                (!row.nameKey || !nameKey || row.nameKey === nameKey)) || null;
        } else if (slot !== null && nameKey) {
            // The game's global attack floor is 900ms. One named move
            // hitting distinct slots over 350ms may be an area cast;
            // a repeated target starts a NEW cast without a protocol id.
            group = [...recent].reverse().find(row =>
                row.explicitId === null && row.nameKey === nameKey &&
                row.type === type && now - row.startedAt <= 350 &&
                !row.slots.has(slot)) || null;
        }
        if (!group) {
            group = {
                explicitId, nameKey, type, startedAt: now,
                slots: new Set(), hits: 0,
                observation: null, typeSample: null
            };
            recent.push(group);
        }
        if (!group.nameKey && nameKey) group.nameKey = nameKey;
        if (slot !== null) group.slots.add(slot);
        group.hits++;
        recentAttackCasts.set(record, recent);
        return group;
    }

    function recordAttackEvent(
        event
    ) {
        if (
            event?.por !==
                'jogador'
        ) {
            return;
        }

        const record =
            performanceRecord(
                state.currentHuntSlug,
                true
            );

        if (!record) {
            return;
        }

        const now =
            Date.now();

        touchRecord(
            record,
            now
        );

        const slot =
            combatSlot(
                event
            );
        const castName = namedMoveFromAttack(event);
        const castKey = castName ? moveNameKey(castName) : null;
        const castType = String(event?.tipo || 'UNKNOWN').toUpperCase();
        const cast = identifyAttackCast(record, event, now, slot, castKey, castType);
        const sameCast = cast.hits > 1;
        const diagnostic = state.battleDiagnostics;
        if (cast.explicitId !== null) diagnostic.explicitCastEvents++;
        if (sameCast && cast.explicitId === null) diagnostic.heuristicGroupedEvents++;
        if (sameCast && !castKey) diagnostic.unnamedGroupedEvents++;

        if (
            record.lastAttackAt && !sameCast
        ) {
            const gap =
                now -
                record.lastAttackAt;

            /*
             * Multiple AoE damage rows can share one timestamp. Do not
             * mistake those for 0 ms attack cadence.
             */
            if (
                gap >= 100 &&
                gap <= 300000
            ) {
                pushSample(
                    record,
                    'allAttackIntervals',
                    gap
                );

                if (
                    slot &&
                    slot ===
                        record.lastAttackSlot
                ) {
                    pushSample(
                        record,
                        'sameTargetIntervals',
                        gap
                    );
                } else {
                    pushSample(
                        record,
                        'transitionIntervals',
                        gap
                    );
                }
            }
        }

        if (!sameCast) {
            record.lastAttackAt = now;
            record.lastAttackSlot = slot;
            record.attacks = Number(record.attacks || 0) + 1;
        }

        const damage =
            Math.max(
                0,
                Number(
                    event?.dano
                ) ||
                0
            );

        const effectiveness =
            Number(
                event?.ef
            );

        const type =
            typeof event?.tipo ===
                'string'
                ? String(
                    event.tipo
                ).toUpperCase()
                : 'UNKNOWN';

        record.damage =
            Number(
                record.damage ||
                0
            ) +
            damage;


        diagnostic.playerEvents++;
        const attackName = castName;
        if (attackName) diagnostic.namedEvents++;
        else {
            diagnostic.unnamedEvents++;
            // Field names only; no raw battle values or personal identifiers.
            diagnostic.lastUnnamedKeys = Object.keys(event || {}).slice(0, 24);
        }
        diagnostic.lastSeenAt = now;

        if (
            damage > 0 &&
            Number.isFinite(
                effectiveness
            ) &&
            effectiveness > 0
        ) {
            if (
                !record.moveDamage ||
                typeof record.moveDamage !==
                    'object'
            ) {
                record.moveDamage =
                    {};
            }

            const sample =
                record.moveDamage[
                    type
                ] || {
                    count: 0,
                    neutralSamples: [],
                    actualSamples: []
                };

            // Keep the type-based estimator cast-based as well.
            const previous = cast.typeSample;
            if (sameCast && previous?.sample === sample &&
                Number.isInteger(previous.index) &&
                previous.index < sample.neutralSamples.length) {
                const hits = previous.hits;
                sample.neutralSamples[previous.index] =
                    (sample.neutralSamples[previous.index] * hits +
                        damage / effectiveness) / (hits + 1);
                sample.actualSamples[previous.index] =
                    (sample.actualSamples[previous.index] * hits +
                        damage) / (hits + 1);
                previous.hits++;
            } else {
                sample.count++;
                sample.neutralSamples.push(damage / effectiveness);
                sample.actualSamples.push(damage);
                if (sample.neutralSamples.length > 80)
                    sample.neutralSamples.splice(0, sample.neutralSamples.length - 80);
                if (sample.actualSamples.length > 80)
                    sample.actualSamples.splice(0, sample.actualSamples.length - 80);
                cast.typeSample = {
                    sample, index: sample.neutralSamples.length - 1, hits: 1
                };
            }

            record.moveDamage[
                type
            ] =
                sample;

            if (!Array.isArray(record.attackObservations))
                record.attackObservations = [];
            const observations = record.attackObservations;
            // An explicit cast id also groups unnamed attack hits.
            // The heuristic only groups named moves across distinct slots.
            if (sameCast && cast.observation) {
                const observation = cast.observation;
                const hits = Math.max(1, Number(observation.hits) || 1);
                observation.neutralDamage =
                    (observation.neutralDamage * hits +
                        damage / effectiveness) / (hits + 1);
                observation.hits = hits + 1;
                if (!observation.name && attackName) {
                    observation.name = attackName;
                    observation.nameKey = castKey;
                }
            } else {
                const observation = {
                    name: attackName, nameKey: castKey, type,
                    neutralDamage: damage / effectiveness,
                    at: now, hits: 1
                };
                observations.push(observation);
                cast.observation = observation;
                if (observations.length > 160)
                    observations.splice(0, observations.length - 160);
            }
        }

        if (slot) {
            let target =
                state.combatTargets.get(
                    slot
                );

            if (!target) {
                target = {
                    slot,
                    speciesId: null,
                    name: null,
                    level:
                        Number(
                            currentHunt()
                                ?.nivel
                        ) ||
                        1,
                    maxHp: null,
                    playerAttacks: 0,
                    hpRecorded:
                        false,
                    seenAt: now
                };

                state.combatTargets.set(
                    slot,
                    target
                );
            }

            if (
                !Number.isFinite(
                    Number(
                        target.maxHp
                    )
                ) &&
                target.playerAttacks ===
                    0
            ) {
                const hpAfter =
                    Number(
                        event?.hpAlvo
                    );

                if (
                    Number.isFinite(
                        hpAfter
                    ) &&
                    damage > 0
                ) {
                    target.maxHp =
                        Math.max(
                            1,
                            hpAfter +
                                damage
                        );
                }
            }

            target.playerAttacks++;

            recordTargetHp(
                record,
                target
            );
        }
    }


    // HA MILESTONE A PURE BEGIN. Local, bounded and dependency-free farming math.
    const FARM_OUTLAND_TIERS = Object.freeze([
        [150, 1], [500, 1.25], [1000, 1.5], [2000, 2],
        [4000, 3], [8000, 4], [16000, 6], [25000, 8]
    ]);
    const FARM_SHINY_LEVELS = Object.freeze([
        5000, 5400, 5900, 6400, 6950, 8000, 8600,
        10000, 11250, 12750, 14350, 16000, 20000, 21200,
        25000, 27050, 29450, 32000, 34650, 43100,
        50000, 58900, 64000, 69300, 86150, 100000,
        114800, 123350, 132200, 160300
    ]);
    const FARM_RATE_WINDOW_MS = 15 * 60 * 1000;
    const FARM_STALE_MS = 2 * 60 * 1000;
    const FARM_MIN_WINDOW_MS = 60 * 1000;
    const FARM_MIN_KILLS = 6;

    function farmingXpForLevel(level) {
        const n = Math.max(1, Number(level) || 1);
        return n <= 150
            ? Math.floor(0.6 * n * n) + 8
            : Math.round(13500 * Math.pow(n / 150, 1.25));
    }

    function farmingGoldForLevel(level) {
        const n = Math.min(25000, Math.max(1, Number(level) || 1));
        const exponent = Math.log(6000 / 36) / Math.log(5000);
        return Math.round(36 * Math.pow(n, exponent));
    }

    function farmingLootChance(encoded) {
        const n = Number(encoded);
        return Number.isFinite(n) && n >= 0 && n <= 100000
            ? n / 100000 : null;
    }

    function outlandNormalizeSpeciesId(value) {
        const n=Number(value);
        return Number.isInteger(n) && n>=10501 && n<10548 ?
            n-8500 : value;
    }

    function farmingTier(tier, playerLevel) {
        const n = Number(tier), level = Number(playerLevel);
        if (!Number.isInteger(n) || n < 1 || n > 8 ||
            !Number.isFinite(level) || level < FARM_OUTLAND_TIERS[n - 1][0]) {
            return null;
        }
        return {tier: n, requiredLevel: FARM_OUTLAND_TIERS[n - 1][0],
            rareMultiplier: FARM_OUTLAND_TIERS[n - 1][1]};
    }

    function farmingShinyEggChance(level, outland = false) {
        if (outland || !Number.isFinite(Number(level))) return 0;
        const n = Number(level);
        const steps = FARM_SHINY_LEVELS.filter(value => n >= value).length;
        // Integer decimal steps prevent cumulative binary rounding drift.
        return steps ? (375 + (steps - 1) * 15) / 10000000 : 0;
    }

    function farmingChanceAtLeastOne(probability, rolls) {
        const p = Number(probability), n = Number(rolls);
        if (!(p >= 0 && p <= 1) || !(n >= 0 && Number.isFinite(n))) return null;
        if (n === 0 || p === 0) return 0;
        if (p === 1) return 1;
        return -Math.expm1(n * Math.log1p(-p));
    }

    function farmingConfidence(sampleCount, elapsedMs, stale) {
        if (stale) return 'stale';
        if (sampleCount < FARM_MIN_KILLS || elapsedMs < FARM_MIN_WINDOW_MS)
            return 'warming';
        return sampleCount >= 30 && elapsedMs >= 5 * 60000 ? 'high' : 'medium';
    }

    const farmingFinite = value =>
        (value !== null && value !== undefined && value !== '' &&
        Number.isFinite(Number(value)) && Number(value) >= 0)
            ? Number(value) : null;

    function normalizeFarmingEvent(event) {
        if (!event || typeof event !== 'object' || Array.isArray(event) ||
            typeof event.k !== 'string') return null;
        const kind = event.k;
        const supported = ['morte', 'bola', 'capturado', 'cura', 'revive',
            'bossMorto', 'compra'];
        if (!supported.includes(kind)) return null;
        if (kind === 'morte' && event.quem !== 'selvagem') return null;
        const rawSlot = event.slot ?? event.s;
        const slot = (typeof rawSlot === 'string' || typeof rawSlot === 'number') &&
            String(rawSlot).length <= 32 && String(rawSlot).length > 0
                ? String(rawSlot) : null;
        const itemId = farmingFinite(event.itemId ?? event.ballId);
        const trainerXp = farmingFinite(event.xpTreinador);
        const pokemonXp = farmingFinite(event.xpPokemon);
        const killCoins = farmingFinite(event.ouro);
        const autoSaleCoins = farmingFinite(event.ouroVendaAuto);
        // Only supported receipt fields are retained. No names, tokens or raw packets.
        const drops = [];
        if (Array.isArray(event.drops)) {
            for (const drop of event.drops.slice(0, 32)) {
                const id = farmingFinite(drop?.itemId ?? drop?.id) ??
                    RARE_OUTLAND_DROPS.concat([RARE_EGG_DROP])
                        .find(row=>row.name===drop?.nome)?.id ?? null;
                const quantity = farmingFinite(drop?.qtd ?? drop?.quantity ?? 1);
                if (id !== null && quantity !== null && quantity > 0)
                    drops.push({itemId: id, quantity});
            }
        }
        return {
            kind, slot,
            itemId: itemId === null ? null : Math.trunc(itemId),
            trainerXp: kind === 'morte' ? trainerXp : null,
            pokemonXp: kind === 'morte' ? pokemonXp : null,
            killCoins: kind === 'morte' ? killCoins : null,
            autoSaleCoins: kind === 'morte' ? autoSaleCoins : null,
            speciesId: kind === 'morte' ? farmingFinite(event.speciesId ?? event.pokeId) : null,
            mobLevel: kind === 'morte' ? farmingFinite(event.level) : null,
            drops: kind === 'morte' || kind === 'bossMorto' ? drops : [],
            shinySeen: kind === 'bola' && typeof event.shiny === 'boolean'
                ? event.shiny : null,
            shinyCaught: kind === 'capturado' &&
                typeof event.pokemon?.shiny === 'boolean'
                ? event.pokemon.shiny : null,
            chanceRaw: kind === 'bola' ? farmingFinite(event.chance) : null,
            successFlag: kind === 'bola' && typeof event.sucesso === 'boolean'
                ? event.sucesso : null,
            // bola is a server-emitted accepted use, not a click/tick.
            evidence: 'observed-server/event'
        };
    }

    function normalizeFarmingSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return null;
        const tierRaw = snapshot.tierOutland ?? snapshot.outlandTier ?? snapshot.outland_tier;
        const tierPresent = Object.hasOwn(snapshot, 'tierOutland') ||
            Object.hasOwn(snapshot, 'outlandTier') || Object.hasOwn(snapshot, 'outland_tier');
        const revision = snapshot.catalogRevision ?? snapshot.catalogoVersao;
        const boosts = snapshot.bonuses;
        const boostSignature = boosts && typeof boosts === 'object'
            ? Object.entries(boosts).filter(([key, value]) =>
                /^[a-zA-Z_]{1,30}$/.test(key) && farmingFinite(value) !== null
            ).sort(([a], [b]) => a.localeCompare(b))
                .slice(0, 24).map(([key, value]) => key + ':' + value).join('|')
            : undefined;
        return {
            ...(tierPresent ? {
                outlandTier: Number.isInteger(Number(tierRaw)) &&
                    Number(tierRaw) >= 1 && Number(tierRaw) <= 8
                        ? Number(tierRaw) : null
            } : {}),
            ...(revision !== undefined ? {
                catalogRevision: String(revision).slice(0, 40)
            } : {}),
            ...(boostSignature !== undefined ? {boostSignature} : {}),
            inventoryPresent: Object.hasOwn(snapshot, 'balls') ||
                Object.hasOwn(snapshot, 'items'),
            coinsPresent: Object.hasOwn(snapshot, 'gold')
        };
    }

    function farmingEventEvidence(event) {
        const normalized = normalizeFarmingEvent(event);
        const kind = typeof event?.k === 'string' ? event.k : 'invalid';
        const fields = ['slot', 's', 'quem', 'xpTreinador', 'xpPokemon',
            'ouro', 'ouroVendaAuto', 'drops', 'ballId', 'chance',
            'sucesso', 'shiny', 'pokemon', 'itemId'].filter(key =>
            Object.prototype.hasOwnProperty.call(event || {}, key));
        return {kind, fields, recognized: Boolean(normalized),
            missingSlot: Boolean(normalized && !normalized.slot),
            source: 'observed-server/event', schema: 1};
    }

    function recordFarmingEvidence(ledger, event) {
        if (!ledger) return;
        const detail = farmingEventEvidence(event);
        const kind = detail.kind;
        if (!['morte', 'bola', 'capturado', 'cura', 'revive',
            'bossMorto', 'compra'].includes(kind)) return;
        let row = ledger.fieldPresence.get(kind);
        if (!row) {
            row = {seen: 0, malformed: 0, noSlot: 0, keys: {}};
            ledger.fieldPresence.set(kind, row);
        }
        row.seen++;
        if (!detail.recognized) row.malformed++;
        if (detail.missingSlot) row.noSlot++;
        for (const key of detail.fields) row.keys[key] = (row.keys[key] || 0) + 1;
    }

    function makeFarmingLedger() {
        return {schema: 1, slots: new Map(), totals: {
            kills: 0, trainerXp: 0, pokemonXp: 0,
            killCoins: 0, autoSaleCoins: 0, acceptedThrows: 0,
            captures: 0, shinySeen: 0, shinyCaught: 0,
            potions: 0, revives: 0, bossDeaths: 0
        }, items: new Map(), diagnostics: {malformed: 0, duplicates: 0,
            noSlot: 0, unlinked: 0, uncertainCosts: 0}, fieldPresence: new Map()};
    }

    function farmingSpawn(ledger, slot) {
        if (!ledger || slot === null) return;
        const old = ledger.slots.get(slot);
        if (!old || old.dead) {
            ledger.slots.delete(slot);
            ledger.slots.set(slot, {dead: false, thrown: false, captured: false});
        }
        if (ledger.slots.size > 64)
            ledger.slots.delete(ledger.slots.keys().next().value);
    }

    function acceptFarmingEvent(ledger, receipt) {
        if (!ledger || !receipt) {
            if (ledger) ledger.diagnostics.malformed++;
            return false;
        }
        const kind = receipt.kind;
        const slot = receipt.slot;
        let corpse = slot !== null ? ledger.slots.get(slot) : null;
        if (['morte', 'bola', 'capturado'].includes(kind) && !slot) {
            ledger.diagnostics.noSlot++;
            if (kind === 'bola') ledger.diagnostics.uncertainCosts++;
            return false; // Cannot safely deduplicate or correlate a body.
        }
        if (kind === 'morte') {
            if (!corpse) {
                farmingSpawn(ledger, slot); // Late initial spawn is unknown.
                corpse = ledger.slots.get(slot);
            }
            if (corpse.dead) {
                ledger.diagnostics.duplicates++;
                return false;
            }
            corpse.dead = true;
            corpse.speciesId = receipt.speciesId !== null
                ? Number(outlandNormalizeSpeciesId(receipt.speciesId)):null;
            ledger.totals.kills++;
            for (const [field, name] of [
                ['trainerXp', 'trainerXp'], ['pokemonXp', 'pokemonXp'],
                ['killCoins', 'killCoins'], ['autoSaleCoins', 'autoSaleCoins']
            ]) ledger.totals[name] += receipt[field] ?? 0;
        } else if (kind === 'bola') {
            if (!corpse?.dead || corpse.thrown) {
                ledger.diagnostics.uncertainCosts++;
                ledger.diagnostics.unlinked++;
                return false;
            }
            corpse.thrown = true;
            corpse.ballId=receipt.itemId;
            ledger.totals.acceptedThrows++;
            if (receipt.shinySeen) ledger.totals.shinySeen++;
        } else if (kind === 'capturado') {
            if (!corpse?.thrown || corpse.captured) {
                ledger.diagnostics.unlinked++;
                return false;
            }
            corpse.captured = true;
            ledger.totals.captures++;
            if (receipt.shinyCaught) ledger.totals.shinyCaught++;
        } else if (kind === 'cura' || kind === 'revive') {
            if (receipt.itemId === null) {
                ledger.diagnostics.malformed++;
                return false;
            }
            ledger.totals[kind === 'cura' ? 'potions' : 'revives']++;
            // No per-event protocol ID: identical consecutive uses stay separate.
        } else if (kind === 'bossMorto') {
            ledger.totals.bossDeaths++;
        } else if (kind === 'compra') {
            return true; // Purchases are NOT the cost of a consumed item twice.
        } else return false;
        for (const {itemId, quantity} of receipt.drops) {
            if (!ledger.items.has(itemId) && ledger.items.size >= 64) continue;
            ledger.items.set(itemId, (ledger.items.get(itemId) || 0) + quantity);
        }
        return true;
    }

    // Thirty-second buckets keep multi-hour sessions small, even at extreme K/h.
    // The entire window is counted; dropping individual fast kills would
    // underestimate the rate when the ring buffer fills.
    function appendFarmingKill(window, sample) {
        const at = Number(sample?.at);
        if (!Number.isFinite(at)) return window;
        const reset = !window || !Number.isFinite(window.lastAt) ||
            at < window.lastAt || at - window.lastAt > FARM_STALE_MS;
        const bucket = Math.floor(at / 30000);
        const rows = reset ? [] : window.rows.filter(row =>
            row.at >= at - FARM_RATE_WINDOW_MS - 30000);
        let row = rows[rows.length - 1];
        if (!row || row.bucket !== bucket) {
            row = {bucket, at, kills: 0, productiveMs: 0,
                trainerXp: 0, pokemonXp: 0, gold: 0,
                trainerKnown: 0, pokemonKnown: 0,
                killGold: 0, autoSale: 0, killGoldKnown: 0,
                autoSaleKnown: 0};
            rows.push(row);
        }
        row.kills++;
        if (sample.trainerXp !== null && Number.isFinite(sample.trainerXp)) {
            row.trainerXp += sample.trainerXp;
            row.trainerKnown++;
        }
        if (sample.pokemonXp !== null && Number.isFinite(sample.pokemonXp)) {
            row.pokemonXp += sample.pokemonXp;
            row.pokemonKnown++;
        }
        row.gold += sample.gold ?? 0;
        if (sample.killGold !== null && Number.isFinite(sample.killGold)) {
            row.killGold += sample.killGold;
            row.killGoldKnown++;
        }
        if (sample.autoSale !== null && Number.isFinite(sample.autoSale)) {
            row.autoSale += sample.autoSale;
            row.autoSaleKnown++;
        }
        if (!reset) {
            const gap = at - window.lastAt;
            if (gap >= 0 && gap <= 60000) row.productiveMs += gap;
        }
        if (rows.length > 33) rows.splice(0, rows.length - 33);
        return {startedAt: reset ? at : Math.max(window.startedAt,
            at - FARM_RATE_WINDOW_MS), lastAt: at, rows};
    }

    function farmingObservedRates(window, now) {
        if (!window || !Array.isArray(window.rows) ||
            !Number.isFinite(now) || now < window.lastAt) return null;
        const stale = now - window.lastAt > FARM_STALE_MS;
        const start = Math.max(window.startedAt, now - FARM_RATE_WINDOW_MS);
        const rows = window.rows.filter(row =>
            row.at >= start - 30000 && row.at <= now);
        const samples = rows.reduce((total, row) => total + row.kills, 0);
        const elapsedMs = now - start; // wall-clock: includes restock/idle.
        if (farmingConfidence(samples, elapsedMs, stale) === 'warming' ||
            stale || !samples) return null;
        const killsH = samples * 3600000 / elapsedMs;
        const sum = field => rows.reduce((total, row) => total + row[field], 0);
        const productiveMs = sum('productiveMs');
        return {killsH, killMs: 3600000 / killsH,
            trainerXpH: sum('trainerKnown') === samples
                ? sum('trainerXp') * 3600000 / elapsedMs : null,
            pokemonXpH: sum('pokemonKnown') === samples
                ? sum('pokemonXp') * 3600000 / elapsedMs : null,
            trainerKnown: sum('trainerKnown'),
            pokemonKnown: sum('pokemonKnown'),
            goldH: sum('gold') * 3600000 / elapsedMs,
            killGoldH: sum('killGoldKnown') === samples
                ? sum('killGold') * 3600000 / elapsedMs : null,
            autoSaleH: sum('autoSaleKnown') === samples
                ? sum('autoSale') * 3600000 / elapsedMs : null,
            productiveKillsH: productiveMs >= FARM_MIN_WINDOW_MS
                ? samples * 3600000 / productiveMs : null,
            productiveMs, windowMs: elapsedMs, samples,
            denominator: 'wall', confidence:
                farmingConfidence(samples, elapsedMs, false)};
    }
    // HA MILESTONE A PURE END.






    // HA MILESTONE F PURE BEGIN. Ranking requires the requested metric,
    // never XP as a fallback for missing Coins, rare or capture evidence.
    const HA_RANK_METRICS=Object.freeze([
        'xp','pokemonXp','coins','npcLoot','netCoins','rare',
        'capture','shinyCatch','ballEfficiency'
    ]);
    const HA_RARE_SORT_IDS=Object.freeze([70000,70011,70012,70013,70017]);
    function haMetricNumber(value) {
        return typeof value==='number'&&Number.isFinite(value)?value:null;
    }
    function haMetricValue(metric,data) {
        const xp=data?.xp,coins=data?.economy,rare=data?.rare,
            capture=data?.capture;
        switch(metric){
            case 'xp': return haMetricNumber(xp?.value);
            case 'pokemonXp': return haMetricNumber(xp?.pokemonValue);
            case 'coins': return haMetricNumber(coins?.killCoinsH);
            case 'npcLoot': return haMetricNumber(coins?.npcLootEvH);
            case 'netCoins': return haMetricNumber(coins?.netH);
            case 'rare': return haMetricNumber(rare?.unitsH);
            case 'capture': return haMetricNumber(capture?.catchesH);
            case 'shinyCatch': return haMetricNumber(capture?.shinyCaughtH);
            case 'ballEfficiency': return haMetricNumber(
                capture?.coinsPerCapture);
            default:return null;
        }
    }
    function haRankMetricRows(rows,direction='desc',metric='xp') {
        const asc=direction==='asc';
        const lowerBetter=metric==='ballEfficiency';
        return [...rows].sort((a,b)=>{
            const av=haMetricNumber(a?.score),bv=haMetricNumber(b?.score);
            if(av===null||bv===null) {
                if(av===null&&bv===null)return String(a?.hunt?.slug||'')
                    .localeCompare(String(b?.hunt?.slug||''));
                return av===null?1:-1;
            }
            if(av!==bv) {
                const factor=(asc?-1:1)*(lowerBetter?-1:1);
                return (bv-av)*factor;
            }
            const lv=Number(b?.hunt?.nivel||0)-Number(a?.hunt?.nivel||0);
            return lv||String(a?.hunt?.slug||'').localeCompare(
                String(b?.hunt?.slug||''));
        });
    }
    function haMetricRare(hunt,tier,level,killsH,itemId) {
        const drops=rareForHunt(hunt,tier,level,killsH);
        if(drops.reason)return null;
        return drops.drops.find(row=>row.id===itemId)??null;
    }
    // HA MILESTONE F PURE END.

    // HA MILESTONE E PURE BEGIN — wiki-conditional, not deployed server parity.
    const CAPTURE_BALLS=Object.freeze([
        {id:1,name:'Poké',efficiency:1,defaultCoins:5},
        {id:2,name:'Great',efficiency:2,defaultCoins:20},
        {id:3,name:'Super',efficiency:3,defaultCoins:50},
        {id:4,name:'Ultra',efficiency:4,defaultCoins:130},
        {id:5,name:'Beast',efficiency:8,defaultCoins:null}
    ]);
    function captureRarityFromCatalog(meta) {
        if (!meta) return null;
        const level=Number(meta.huntLevel);
        // The high-level economic normalization is upstream's
        // aplicarEconomiaRegiaoAlta, BEFORE the independent NPC SALE cap.
        if (Number.isFinite(level) && level>150)
            return Math.round(12000*(level/150)**.6);
        const sell=Number(meta.catalogSellValue);
        const npc=Number(meta.priceNpc);
        if (sell>0 && sell<=500000) return sell;
        if (sell>500000 && level>0)
            return Math.round(12000*(level/150)**.6);
        if (npc>0 && npc<=500000) return npc;
        return null; // Never borrow a specimen sale price or RMT listing.
    }
    function captureWikiChance(rarity,efficiency,hpFraction=0) {
        const price=Number(rarity),eff=Number(efficiency),hp=Number(hpFraction);
        if (!(price>0)||!Number.isFinite(price)||!(eff>0)||
            !Number.isFinite(eff)||!Number.isFinite(hp)||hp<0||hp>1)
            return null;
        const r=Math.log10(Math.max(100,price))-1;
        const factor=1+r**3/17;
        return Math.min(.10,Math.max(.003,
            .0075*eff/factor*(1.4-hp)));
    }
    function captureBallCatalog(source) {
        const rows=Array.isArray(source)?source:
            source&&typeof source==='object'?
                Object.entries(source).map(([id,row])=>({
                    id,...(row&&typeof row==='object'?row:{})
                })): [];
        const out=new Map();
        for(const row of rows.slice(0,16)){
            const id=Number(row?.id??row?.ballId);
            const rate=Number(row?.catchRate);
            const price=Number(row?.priceGold);
            if(!Number.isInteger(id)||id<1||id>5)continue;
            // The efficiency is meaningful only when a real catalog supplies
            // a finite positive catchRate; absent values remain wiki conditional.
            out.set(id,{efficiency:Number.isFinite(rate)&&rate>0?rate:null,
                coins:row?.priceGold!==null&&row?.priceGold!==undefined&&
                    Number.isFinite(price)&&price>=0?price:null,
                currency:id===5?'diamonds':'coins',source:'observed-client-catalog'});
        }
        return out;
    }
    function captureMysticChance(ballId,captureBoost=1) {
        const n=Number(ballId),boost=Number(captureBoost);
        if(!Number.isInteger(n)||n<1||n>5 || !(boost>0))return null;
        return Math.min(1,.001*n*boost);
    }
    function captureAppend(window,receipt,at,speciesId=null) {
        if(!receipt||!Number.isFinite(at))return window;
        const rows=!window||at<window.lastAt||
            at-window.lastAt>900000?[]:
                window.rows.filter(row=>row.at>=at-930000);
        const bucket=Math.floor(at/30000);
        let row=rows[rows.length-1];
        if(!row||row.bucket!==bucket){
            row={at,bucket,kills:0,throws:0,captures:0,shinySeen:0,
                shinyCaught:0,shinySeenKnown:0,shinyCaughtKnown:0,
                byBall:{},byBallCaught:{},bySpecies:{}};
            rows.push(row);
        }
        const kind=receipt.kind;
        if(kind==='morte')row.kills++;
        if(kind==='bola'){
            row.throws++;
            if(receipt.shinySeen!==null)row.shinySeenKnown++;
            if(receipt.shinySeen===true)row.shinySeen++;
            const id=receipt.itemId;
            if(id!==null && Number.isInteger(id)&&id>=1&&id<=5)
                row.byBall[id]=(row.byBall[id]||0)+1;
        }
        if(kind==='capturado'){
            row.captures++;
            if(Number.isInteger(receipt.confirmedBallId) &&
                receipt.confirmedBallId>=1&&receipt.confirmedBallId<=5)
                row.byBallCaught[receipt.confirmedBallId]=
                    (row.byBallCaught[receipt.confirmedBallId]||0)+1;
            if(receipt.shinyCaught!==null)row.shinyCaughtKnown++;
            if(receipt.shinyCaught===true)row.shinyCaught++;
        }
        const species=Number(speciesId);
        if(Number.isInteger(species)&&species>0 && species<100000){
            const key=String(species);
            const target=row.bySpecies[key]??{kills:0,throws:0,captures:0};
            if(kind==='morte')target.kills++;
            if(kind==='bola')target.throws++;
            if(kind==='capturado')target.captures++;
            if(Object.keys(row.bySpecies).length<80||row.bySpecies[key])
                row.bySpecies[key]=target;
        }
        if(rows.length>33)rows.splice(0,rows.length-33);
        return {lastAt:at,rows};
    }
    function captureObservedWindow(window,start,now) {
        if(!window||!(now>start)||now-window.lastAt>120000)return null;
        const rows=window.rows.filter(row=>row.at>=start-30000&&row.at<=now);
        const sum=key=>rows.reduce((n,row)=>n+row[key],0);
        const byBall={},byBallCaught={},bySpecies={};
        for(const row of rows){
            for(const [id,count] of Object.entries(row.byBall))
                byBall[id]=(byBall[id]||0)+count;
            for(const [id,count] of Object.entries(row.byBallCaught))
                byBallCaught[id]=(byBallCaught[id]||0)+count;
            for(const [id,counts] of Object.entries(row.bySpecies)){
                const target=bySpecies[id]??{kills:0,throws:0,captures:0};
                for(const key of ['kills','throws','captures'])
                    target[key]+=counts[key];
                bySpecies[id]=target;
            }
        }
        const kills=sum('kills'),throws=sum('throws'),hours=(now-start)/3600000;
        if(kills<6||hours<1/60)return null;
        return {kills,throws,captures:sum('captures'),
            shinySeen:sum('shinySeenKnown')===throws ?
                sum('shinySeen'):null,
            shinyCaught:sum('shinyCaughtKnown')===sum('captures') ?
                sum('shinyCaught'):null,
            shinySeenKnown:sum('shinySeenKnown'),
            shinyCaughtKnown:sum('shinyCaughtKnown'),
            throwsH:throws/hours,capturesH:sum('captures')/hours,
            windowMs:now-start,
            targetableFraction:throws/kills,
            byBall,byBallCaught,bySpecies,
            source:'observed-server/accepted-correlated'};
    }
    function captureHuntChance(hunt,rarities,efficiency,mix=null,mixMode='kills') {
        if(!Array.isArray(hunt?.especies)||!hunt.especies.length)
            return {chance:null,coverage:0,source:'no-spawns'};
        const measured=mix&&Object.values(mix).reduce((n,x)=>n+(x[mixMode]||0),0)>=30;
        let total=0,covered=0,weighted=0;
        for(const row of hunt.especies){
            const id=Number(outlandNormalizeSpeciesId(row.pokeId));
            const weight=measured?(mix?.[id]?.[mixMode]??0):
                Math.max(1,Number(row.pontos)||1);
            total+=weight;
            const rarity=rarities.get(id);
            const chance=captureWikiChance(rarity,efficiency);
            if(chance!==null){covered+=weight;weighted+=weight*chance;}
        }
        return {chance:total>0&&covered===total?weighted/total:null,
            coverage:total?Math.round(100*covered/total):0,
            source:measured?'measured-species-mix+wiki-conditional':
                'spawn-weighted-wiki-conditional'};
    }
    function captureForecast(hunt,rarities,killsH,efficiency,options={}) {
        const base=captureHuntChance(hunt,rarities,efficiency,
            options.mix,options.mixMode??'kills');
        const fraction=options.acceptedFraction;
        const observed=typeof fraction==='number'&&
            Number.isFinite(fraction)&&fraction>=0&&fraction<=1;
        const acceptedH=Number.isFinite(killsH)&&killsH>=0 ?
            killsH*(observed?fraction:1):null;
        const catchesH=base.chance===null||acceptedH===null?
            null:acceptedH*base.chance;
        const shinyEligible=String(hunt?.area||'').toLowerCase()==='outland'
            ? null : true; // Outland eligibility is not inferred from wiki.
        const lure=options.hypotheticalLure===true;
        const shinyP=lure?1/12000:1/24000;
        return {...base,acceptedH,catchesH,
            acceptedSource:observed?'observed-corpse-attempt-fraction':
                'upper-bound-if-every-corpse-targeted',
            ballsPerCapture:base.chance>0?1/base.chance:null,
            coinsPerCapture:base.chance>0&&
                Number.isFinite(options.coinPrice)?options.coinPrice/base.chance:null,
            diamondsPerCapture:base.chance>0&&
                Number.isFinite(options.diamondPrice)?
                    options.diamondPrice/base.chance:null,
            shinyEligible,shinyP,
            shinySeenH:shinyEligible&&acceptedH!==null?
                acceptedH*shinyP:null,
            shinyCaughtH:shinyEligible&&catchesH!==null?
                catchesH*shinyP:null,
            shinyCaught24hChance:shinyEligible&&acceptedH!==null&&
                base.chance!==null?farmingChanceAtLeastOne(
                    shinyP*base.chance,24*acceptedH):null,
            hypotheticalLure:lure};
    }
    function captureSpeciesForecast(hunt,speciesId,rarity,efficiency,
        killsH,options={}) {
        if(!Array.isArray(hunt?.especies)||!hunt.especies.length ||
            !Number.isFinite(killsH)||killsH<0)
            return null;
        const target=Number(outlandNormalizeSpeciesId(speciesId));
        let total=0,matches=0;
        const mix=options.mix;
        const measured=mix&&Object.values(mix).reduce((n,x)=>n+x.kills,0)>=30;
        for(const row of hunt.especies){
            const weight=measured?Number(mix?.[
                outlandNormalizeSpeciesId(row.pokeId)]?.kills??0):
                Math.max(1,Number(row.pontos)||1);
            total+=weight;
            if(Number(outlandNormalizeSpeciesId(row.pokeId))===target)
                matches+=weight;
        }
        const chance=captureWikiChance(rarity,efficiency);
        if(!total||!matches||chance===null)return null;
        const hasMeasuredFraction=typeof options.acceptedFraction==='number' &&
            Number.isFinite(options.acceptedFraction) &&
            options.acceptedFraction>=0&&options.acceptedFraction<=1;
        const fraction=typeof options.acceptedFraction==='number'&&
            options.acceptedFraction>=0&&options.acceptedFraction<=1?
                options.acceptedFraction:1;
        const acceptedH=killsH*(matches/total)*fraction;
        const catchesH=acceptedH*chance;
        const eligible=String(hunt.area||'').toLowerCase()==='outland'
            ?null:true;
        const shinyP=options.hypotheticalLure?1/12000:1/24000;
        return {chance,targetFraction:matches/total,acceptedH,catchesH,
            acceptedSource:hasMeasuredFraction?'observed':'ceiling',
            shinySeenH:eligible?acceptedH*shinyP:null,
            shinyCaughtH:eligible?catchesH*shinyP:null,
            meanHoursShiny:eligible&&catchesH>0?1/(catchesH*shinyP):null,
            shiny24h:eligible?
                farmingChanceAtLeastOne(chance*shinyP,24*acceptedH):null,
            source:measured?'measured-species-mix+wiki':
                'spawn-weighted-wiki-conditional'};
    }
    // HA MILESTONE E PURE END.

    // HA MILESTONE D PURE BEGIN — base probabilities; no inferred boosts.
    const RARE_OUTLAND_DROPS = Object.freeze([
        {id:70000,key:'token',name:'Bronze Boss Token',base:.0005,craft:1,
            source:'wiki+upstream-shared'},
        {id:70011,key:'key',name:'Key Fragment',base:.000005,craft:10,
            source:'wiki+upstream-shared'},
        {id:70012,key:'stone',name:'Shiny Stone Fragment',base:.000005,
            craft:10,source:'wiki+upstream-shared'},
        {id:70013,key:'bicycle',name:'Bicycle Fragment',base:.000005,
            craft:10,source:'wiki-reported;server-hook-unverified'}
    ]);
    const RARE_EGG_DROP = Object.freeze({
        id:70017,key:'egg',name:'Shiny Egg Fragment',craft:10,
        source:'upstream-shared-frozen-ladder'});
    function outlandNativeTier(tier,level) {
        const requested=Number(tier);
        const choice=Number.isInteger(requested) && requested>=1 &&
            requested<=8 ? requested : 1;
        for(let i=choice;i>=1;i--)
            if(farmingTier(i,level))return i;
        for(let i=8;i>=1;i--)
            if(farmingTier(i,level))return i;
        // The upstream default is 1 even before trainer level 150, but the
        // map remains LOCKED. Never advertise tier 1 as unlocked below 150.
        return 1;
    }
    function outlandTierSnapshot(source) {
        if(!source || typeof source!=='object') return null;
        const keys=['tierOutland','outlandTier','outland_tier'];
        for(const key of keys)if(Object.hasOwn(source,key)){
            const n=Number(source[key]);
            return Number.isInteger(n)&&n>=1&&n<=8?n:null;
        }
        return null;
    }
    function rareForHunt(hunt,tier,trainerLevel,killsH) {
        if(!hunt || !Number.isFinite(killsH)||killsH<0)
            return {drops:[],reason:'unknown-kill-rate'};
        const area=String(hunt.area||'').toLowerCase();
        const isOutland=area==='outland';
        if(isOutland && !farmingTier(tier,trainerLevel))
            return {drops:[],reason:'locked-tier'};
        const available=isOutland?
            RARE_OUTLAND_DROPS.map(row=>({...row,
                probability:Math.min(1,row.base*farmingTier(tier,trainerLevel).rareMultiplier)})):
            [RARE_EGG_DROP].map(row=>({...row,
                probability:farmingShinyEggChance(hunt.nivel,false)}));
        const drops=available.filter(row=>row.probability>0)
            .map(row=>rareHorizon(row,killsH));
        return {drops,reason:!drops.length?'ineligible-hunt':null,
            source:'unboosted-wiki/upstream-shared',tier:isOutland?tier:null,
            eggIncubationHours:isOutland?null:168};
    }
    function rareHorizon(item,killsH) {
        const p=item.probability,unitsH=killsH*p;
        return {...item,unitsH,
            meanKills:p>0?1/p:null,
            meanHours:unitsH>0?1/unitsH:null,
            craftHours:unitsH>0?item.craft/unitsH:null,
            chance1h:farmingChanceAtLeastOne(p,killsH),
            chance24h:farmingChanceAtLeastOne(p,24*killsH),
            assumption:'independent-stationary-rolls-unboosted'};
    }
    function rareMarketEvidence(item,sale,now=Date.now()) {
        // Only verified, sufficiently sampled recent COMPLETED trades may
        // supply a speculative reference. Listings are not proceeds.
        const age=now-Number(sale?.sampledAt);
        if(!item || !Number.isFinite(item.unitsH) ||
            !sale || sale.source!=='completed-sale' ||
            !['gold','orb'].includes(sale.currency) ||
            !(Number.isFinite(sale.price)&&sale.price>0) ||
            !(Number.isInteger(sale.samples)&&sale.samples>=3) ||
            !Number.isFinite(age)||age<0||age>30*86400000)
            return null;
        return {units:item.unitsH,currency:sale.currency,
            expectedMarketValueH:item.unitsH*sale.price,
            referenceSamples:sale.samples,sampledAt:sale.sampledAt,
            ageDays:age/86400000,
            source:'historical-completed-sale-not-realized'};
    }
    // HA MILESTONE D PURE END.

    // HA MILESTONE C PURE BEGIN: economy amounts in Coins, not XP or Gems.
    const FARM_SEEDS={NORMAL:'Luck Medallion',FIRE:'Magma Foot',
        WATER:'Air Tank',GRASS:'Massive Vines',ELECTRIC:'Electric Tail',
        ICE:'Ski Poles',FIGHTING:'Belt of Champion',POISON:'Female Ear',
        GROUND:'Horn Drill',FLYING:'Colored Feather',PSYCHIC:'Fox Tail',
        BUG:'Pinsir Horn',ROCK:'Solid Rock Paw',GHOST:'Traces of Ghost',
        DRAGON:'Dragon Tooth',DARK:'Dark Moon',STEEL:'Steelix Tail',
        FAIRY:'Luck Medallion'};
    const FARM_DEAD=new Set(['strange pheromone','10000 carat emerald','moon stone']);
    const farmNum = n => n===null||n===undefined||n===''||
        !Number.isFinite(Number(n))||Number(n)<0 ? null : Number(n);
    function farmNpcPrice(item, shopIds=new Set(),specialIds=new Set()) {
        if (!item || !Number.isInteger(Number(item.id))) return null;
        const name=String(item.name||'').toLowerCase().replace(/\./g,'');
        if (item.category==='stone'&&name!=='rough gemstone') return 0;
        if (['heal','revive'].includes(item.category)||shopIds.has(Number(item.id))||
            specialIds.has(Number(item.id))||FARM_DEAD.has(name)) return 0;
        const price=farmNum(item.npcPrice);
        return item.category==='loot' ? price : null;
    }
    function farmLootValue(lines,priceOf) {
        if (!Array.isArray(lines)) return {perKill:null,unknown:1,lines:0};
        let value=0,unknown=0,seen=0;
        for(const line of lines.slice(0,80)) {
            const p=farmingLootChance(line?.chance);
            const lo=farmNum(line?.minCount??1),hi=farmNum(line?.maxCount??1);
            if(p===null||lo===null||hi===null||lo>hi){unknown++;continue;}
            if(p===0)continue;
            const price=priceOf(line?.name);
            if(price===null||price===undefined){unknown++;continue;}
            value+=p*(lo+hi)/2*price;seen++;
        }
        return {perKill:unknown?null:value,knownSubtotal:value,unknown,lines:seen};
    }
    // Reconstruct the shared economy-drop adjustments from the raw catalog.
    // This is labeled "reconstructed", NOT the deployed server's final table.
    function farmRebalanceLoot(species,priceOf) {
        if(!species||!Array.isArray(species.loot)) return null;
        const rows=species.loot.slice(0,80).map(x=>({...x}));
        const n=farmNum(species.huntLevel);
        if(!(n>=1))return null;
        const gold=farmingGoldForLevel(n);
        const base=n<=25000?gold:farmingGoldForLevel(25000)*(n/25000)**.30;
        const target=Math.max(0,Math.round(base*1.15)-gold);
        const paying=()=>rows.filter(x=>farmNum(x.chance)>0&&(priceOf(x.name)??0)>0);
        if(!paying().length) {
            const name=FARM_SEEDS[String(species.type1||'').toUpperCase()]||FARM_SEEDS.NORMAL;
            const price=priceOf(name);
            if(price>0)rows.push({name,chance:Math.max(1,
                Math.round(Math.min(60,target/price*100)*1000)),
                minCount:1,maxCount:1});
        }
        const lines=paying().filter(x=>x.name!=='Rare Pokémon Picture');
        const ev=farmLootValue(lines,priceOf).perKill;
        if(ev>0)for(const row of lines){
            const scale=target/ev;
            const min=Math.max(1,Math.min(20,Math.round((row.minCount??1)*scale)));
            row.maxCount=Math.max(min,Math.min(20,Math.round((row.maxCount??1)*scale)));
            row.minCount=min;
        }
        const after=farmLootValue(lines,priceOf).perKill;
        const missing=after===null?0:target-after;
        const rarePrice=priceOf('Rare Pokémon Picture');
        const quantity=rarePrice>0?Math.round(missing/(.05*rarePrice)):0;
        const rare=rows.find(x=>x.name==='Rare Pokémon Picture');
        if(missing>0&&quantity>=1){
            if(rare)Object.assign(rare,{chance:5000,minCount:quantity,maxCount:quantity});
            else rows.push({name:'Rare Pokémon Picture',chance:5000,
                minCount:quantity,maxCount:quantity});
        }else if(rare)rows.splice(rows.indexOf(rare),1);
        return rows;
    }
    function farmGoldPrediction(hunt,killsH){
        if(!Number.isFinite(killsH)||killsH<0||
            !Array.isArray(hunt?.especies)||!hunt.especies.length)return null;
        const rows=hunt.especies.map(x=>({weight:Math.max(1,Number(x.pontos)||1),
            level:farmNum(x.level??x.nivel??hunt.nivel)}));
        if(rows.some(x=>!x.level))return null;
        const total=rows.reduce((sum,x)=>sum+x.weight,0);
        return killsH*rows.reduce((sum,x)=>sum+
            x.weight*farmingGoldForLevel(x.level),0)/total;
    }
    function farmLootPrediction(hunt,known,killsH) {
        if(!Number.isFinite(killsH)||killsH<0||
            !Array.isArray(hunt?.especies)||!hunt.especies.length)
            return {perHour:null,coverage:0,source:'unknown'};
        let total=0,covered=0,weighted=0;
        for(const x of hunt.especies){
            const w=Math.max(1,Number(x.pontos)||1);
            total+=w;
            const row=known.get(Number(outlandNormalizeSpeciesId(x.pokeId)));
            if(row&&Number.isFinite(row.perKill)){covered+=w;weighted+=row.perKill*w;}
        }
        return {perHour:covered===total?killsH*weighted/total:null,
            coverage:total?Math.round(100*covered/total):0,
            source:'reconstructed-upstream-catalog'};
    }
    function farmNormalizePrices(data,kind){
        const rows=Array.isArray(data)?data:
            data&&typeof data==='object'?Object.entries(data).map(([id,row])=>
                row&&typeof row==='object'?{id,...row}:{id}):[];
        const out=new Map();
        for(const row of rows.slice(0,200)){
            const id=Number(row?.id??row?.itemId??row?.ballId);
            if(!Number.isInteger(id)||id<0)continue;
            const coins=kind==='ball'?
                farmNum(row.priceGold??row.precoGold??row.goldPrice):
                farmNum(row.npcPrice??row.precoGold??row.priceGold);
            const diamonds=farmNum(row.priceDiamond??row.precoDiamantes??row.diamondPrice);
            out.set(id,{coins,diamonds,kind,source:'observed-client-catalog'});
        }
        return out;
    }
    function farmAppendUse(win,receipt,at){
        if(!Number.isFinite(at)||!receipt)return win;
        const rows=!win||at<win.lastAt||at-win.lastAt>900000?[]:
            win.rows.filter(x=>x.at>=at-930000);
        const bucket=Math.floor(at/30000);
        let row=rows[rows.length-1];
        if(!row||row.bucket!==bucket){row={bucket,at,uses:{}};rows.push(row);}
        const type=receipt.kind==='bola'?'ball':
            ['cura','revive'].includes(receipt.kind)?'item':null;
        if(type&&receipt.itemId!==null){
            const key=type+':'+receipt.itemId;
            row.uses[key]=(row.uses[key]||0)+1;
        }
        if(rows.length>33)rows.splice(0,rows.length-33);
        return {rows,lastAt:at};
    }
    function farmCostRates(win,from,to,catalogs,inventory){
        if(!(to>from))return null;
        const counts=new Map();
        for(const row of win?.rows||[]){
            if(row.at<from-30000||row.at>to)continue;
            for(const [key,count] of Object.entries(row.uses))
                counts.set(key,(counts.get(key)||0)+count);
        }
        let coins=0,diamonds=0,unknown=0;
        const items=[];
        for(const [key,count] of counts){
            const [type,idText]=key.split(':');const id=Number(idText);
            const price=(type==='ball'?catalogs.balls:catalogs.items)?.get(id);
            if(price?.coins===null||price?.coins===undefined){
                // Diamond-priced supplies are not free Coins; keep currency separate.
                if(price?.diamonds===null||price?.diamonds===undefined)unknown+=count;
            }else coins+=price.coins*count;
            if(price?.diamonds!==null&&price?.diamonds!==undefined)
                diamonds+=price.diamonds*count;
            items.push({type,id,count,remaining:inventory?.get(key)??null,
                priceSource:price?.source??'unknown'});
        }
        const hours=(to-from)/3600000;
        return {coinsH:unknown?null:coins/hours,diamondsH:diamonds/hours,
            unknown,items,source:'replacement-cost-not-spend'};
    }
    function farmFinancialSummary(killsH,modeledKillH,observedKillH,
        observedAutoSaleH,npcLootEvH,cost){
        const ok=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
        const killH=ok(observedKillH)?observedKillH:ok(modeledKillH)?
            modeledKillH:null;
        const realizedH=ok(observedKillH)&&ok(observedAutoSaleH)?
            observedKillH+observedAutoSaleH:null;
        // No unsold loot EV and no second copy of already-realized auto sales.
        const netH=ok(realizedH)&&ok(cost?.coinsH)?
            realizedH-cost.coinsH:null;
        return {killsH,killCoinsH:killH,
            killSource:ok(observedKillH)?'observed-server/event':'upstream-shared-model',
            npcLootEvH:ok(npcLootEvH)?npcLootEvH:null,realizedH,netH,
            replacementCostH:cost?.coinsH??null,diamondsH:cost?.diamondsH??null,
            source:netH===null?'incomplete':'replacement-cost-adjusted'};
    }
    // HA MILESTONE C PURE END.

    // HA MILESTONE B PURE BEGIN: no live bonus is inferred from a prior kill.
    const XP_BONUS_FIELDS = Object.freeze([
        'xpBoost', 'pokemonXpBoost', 'vip', 'guildBoost',
        'guildRank', 'streamBonusPct', 'twitchBonusPct', 'kickBonusPct',
        'eventXp', 'xpEvent', 'catchupBoost', 'catchupTarget',
        'xpTreinadorBoost', 'xpPokemonBoost'
    ]);
    function xpBonusSnapshot(delta) {
        if (!delta || typeof delta !== 'object') return null;
        const result = {};
        for (const section of [delta, delta.bonuses, delta.boosts]) {
            if (!section || typeof section !== 'object' ||
                Array.isArray(section)) continue;
            for (const key of XP_BONUS_FIELDS) {
                if (!Object.hasOwn(section, key)) continue;
                const value = section[key];
                // Only finite scalar numbers and booleans are safely scoped.
                if (typeof value === 'boolean' ||
                    (typeof value === 'number' && Number.isFinite(value)))
                    result[key] = value;
                else if (value === null) result[key] = null;
                else if (typeof value === 'object' && value !== null) {
                    const safe = {};
                    for (const field of ['active','ativo','expiresAt','expiraEm',
                        'until','multiplier','multiplicador','targetLevel']) {
                        const v = value[field];
                        if (typeof v === 'boolean' ||
                            (typeof v === 'number' && Number.isFinite(v)))
                            safe[field] = v;
                    }
                    result[key] = Object.keys(safe).length ? safe : 'unverified';
                } else result[key] = 'unverified';
            }
        }
        return Object.keys(result).length ? result : null;
    }

    function xpBonusTimeScope(snapshot, now) {
        const defined = [];
        if (!snapshot || typeof snapshot !== 'object') return 'unknown';
        for (const [name,value] of Object.entries(snapshot)) {
            if (!value || typeof value !== 'object') continue;
            const at = value.expiresAt ?? value.until;
            // Only plausible Unix millisecond timestamps have interpretable
            // expiration semantics. Unknown protocol units stay unverified.
            if (typeof at === 'number' && at > 1400000000000 &&
                at < 4100000000000) defined.push([
                    name, now >= at ? 'expired' : 'active'
                ]);
        }
        return JSON.stringify(defined.sort((a,b)=>a[0].localeCompare(b[0])));
    }

    function xpBonusScope(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return 'unknown';
        // Fixed ordering means a delta with identical semantics won't reset data.
        return JSON.stringify(Object.keys(snapshot).sort()
            .map(key => [key, snapshot[key]])) +
            '|' + xpBonusTimeScope(snapshot, Date.now());
    }

    function observeXpTransition(record, channel, xp, base, at) {
        if (!record || !(base > 0) || !(xp >= 0) || !Number.isFinite(xp))
            return;
        const ratio = xp / base;
        const key = channel === 'trainer' ? 'lastTrainerBonusRatio'
            : 'lastPokemonBonusRatio';
        const previous = record[key];
        if (previous !== null && Number.isFinite(previous) &&
            Math.abs(ratio - previous) > Math.max(.1, previous * .12)) {
            record.xpBonusTransitions ||= [];
            record.xpBonusTransitions.push({
                channel, at, previous: Math.round(previous * 100) / 100,
                next: Math.round(ratio * 100) / 100,
                reason: 'bonus-or-catchup-transition-unverified'
            });
            if (record.xpBonusTransitions.length > 12)
                record.xpBonusTransitions.shift();
        }
        record[key] = ratio;
    }

    function xpRewardReceipt(receipt) {
        return {
            trainerXp: Number.isFinite(receipt?.trainerXp)
                ? receipt.trainerXp : null,
            pokemonXp: Number.isFinite(receipt?.pokemonXp)
                ? receipt.pokemonXp : null,
            source: 'observed-server/event'
        };
    }

    function xpGlobalAttackFloor(speedIv) {
        // The Speed-IV rule is wiki-derived because server scheduling is absent.
        const iv = Number(speedIv);
        return Number.isInteger(iv) && iv >= 1 && iv <= 32
            ? Math.max(400, 900 - 10 * iv) : 900;
    }

    function xpMoveCooldown(baseCooldownMs, baseSpeed, speedIv, alreadyAdjusted = false) {
        const cooldown = Number(baseCooldownMs), speed = Number(baseSpeed);
        const iv = Number(speedIv);
        if (!(cooldown > 0) || !Number.isFinite(cooldown))
            return null;
        if (alreadyAdjusted) return Math.round(cooldown);
        if (!(speed >= 0) || !Number.isInteger(iv) || iv < 1 || iv > 32)
            return null; // Do not fake known runtime cooldown from unknown IVs.
        const potential = Math.min(7, speed <= 120 ?
            speed / 20 : 6 + (speed - 120) / 40);
        return Math.round(cooldown * (1 - (potential * iv / 32) / 100));
    }

    function xpCooldownFromPower(power) {
        const p = Math.max(15, Number(power) || 15);
        const seconds = p <= 100 ? 10 + (p - 15) * (20 / 85)
            : 30 + (p - 100) * (30 / 500);
        return Math.round(seconds * 10) * 100;
    }

    function xpPredictionBand(estimate) {
        const value = Number(estimate?.value);
        if (!Number.isFinite(value) || value <= 0) return null;
        const observed = estimate.observed === true;
        const samples = Number(estimate.samples) || 0;
        const coverage = Number(estimate.coverage);
        const high = observed && samples >= 30 &&
            Number(estimate.windowMs) >= 300000;
        // These are explicitly heuristic uncertainty ranges, NOT statistical CIs.
        const fraction = observed ? (high ? .12 : .28)
            : estimate.source === 'baseline model' ? .65
            : coverage < 100 || samples < 16 ? .5 : .3;
        return {
            low: Math.max(0, value * (1 - fraction)),
            high: value * (1 + fraction),
            kind: 'heuristic',
            width: fraction
        };
    }

    function xpCompareForecasts(a, b) {
        const av = Number(a?.value) || 0, bv = Number(b?.value) || 0;
        const ar = xpPredictionBand(a), br = xpPredictionBand(b);
        if (ar && br && Math.abs(av - bv) <= Math.max(
            ar.width * av, br.width * bv
        )) {
            // A ranking must not privilege an uncertain cold-start estimate
            // merely because its point estimate is slightly larger.
            const quality = x => x?.observed ? 3
                : x?.source === 'named-move model' && x?.coverage === 100 ? 2
                : x?.source === 'combat model' && x?.coverage === 100 ? 1 : 0;
            if (quality(a) !== quality(b)) return quality(b) - quality(a);
        }
        return bv - av;
    }

    function xpForecastResidual(predictedKillMs, observedKillMs) {
        if (!(Number(predictedKillMs) > 0) || !(Number(observedKillMs) > 0) ||
            !Number.isFinite(predictedKillMs) || !Number.isFinite(observedKillMs))
            return null;
        const ratio = observedKillMs / predictedKillMs;
        return {
            ratio: Math.max(.5, Math.min(2, ratio)),
            errorPct: Math.round(100 * (predictedKillMs - observedKillMs) /
                observedKillMs)
        };
    }
    // HA MILESTONE B PURE END.

    function recordDeathEvent(
        event
    ) {
        const receipt = normalizeFarmingEvent(event);
        if (!receipt || !acceptFarmingEvent(state.farmingLedger, receipt)) return;

        const record =
            performanceRecord(
                state.currentHuntSlug,
                true
            );

        if (!record) {
            return;
        }

        const now =
            Date.now();

        touchRecord(
            record,
            now
        );

        if (
            record.lastKillAt
        ) {
            const gap =
                now -
                record.lastKillAt;

            if (
                gap >= 0 &&
                gap <= 600000
            ) {
                pushSample(
                    record,
                    'killIntervals',
                    gap,
                    40
                );
            }
        }

        record.lastKillAt =
            now;

        record.kills =
            Number(
                record.kills ||
                0
            ) +
            1;

        // Distinct server receipts. Generic event.xp is not both streams.
        const {trainerXp, pokemonXp} = xpRewardReceipt(receipt);
        const gold = (receipt.killCoins ?? 0) +
            (receipt.autoSaleCoins ?? 0);
        if (trainerXp !== null)
            record.trainerXp = Number(record.trainerXp || 0) + trainerXp;
        if (pokemonXp !== null)
            record.pokemonXp = Number(record.pokemonXp || 0) + pokemonXp;
        record.gold = Number(record.gold || 0) + gold;
        record.goldKill = Number(record.goldKill || 0) +
            (receipt.killCoins ?? 0);
        record.goldAutoSale = Number(record.goldAutoSale || 0) +
            (receipt.autoSaleCoins ?? 0);
        if (record.rateGeneration !== state.rateGeneration ||
            record.sessionToken !== state.farmingSessionToken) {
            record.rateWindow = null;
            record.rateGeneration = state.rateGeneration;
            record.sessionToken = state.farmingSessionToken;
        }
        record.rateWindow = appendFarmingKill(record.rateWindow,
            {at: now, trainerXp, pokemonXp, gold,
                killGold:receipt.killCoins, autoSale:receipt.autoSaleCoins});

        const hunt =
            currentHunt();

        const baseXp =
            xpDoNivel(
                event?.level ||
                hunt?.nivel ||
                1
            );

        observeXpTransition(record, 'trainer', trainerXp, baseXp, now);
        observeXpTransition(record, 'pokemon', pokemonXp, baseXp, now);
        if (
            trainerXp !== null && trainerXp > 0 &&
            baseXp > 0
        ) {
            pushSample(
                record,
                'trainerXpMultSamples',
                trainerXp /
                    baseXp,
                80
            );
        }

        if (
            pokemonXp !== null && pokemonXp > 0 &&
            baseXp > 0
        ) {
            pushSample(
                record,
                'pokemonXpMultSamples',
                pokemonXp /
                    baseXp,
                80
            );
        }

        const slot =
            combatSlot(
                event
            );

        if (slot) {
            const target = state.combatTargets.get(slot);
            const speciesId = outlandNormalizeSpeciesId(receipt.speciesId ?? target?.speciesId);
            if (speciesId && Object.keys(record.speciesKills).length < 80) {
                const key = String(speciesId);
                record.speciesKills[key] = (record.speciesKills[key] || 0) + 1;
            }
            if (state.farmingLedger.slots.has(slot) && speciesId)
                state.farmingLedger.slots.get(slot).speciesId=Number(speciesId);
            recordTargetHp(record, target);
            state.combatTargets.delete(slot);
        }
        record.captureWindow = captureAppend(record.captureWindow,
            receipt,now,state.farmingLedger.slots.get(slot)?.speciesId??
                receipt.speciesId);
        savePerformance();

        if (
            state.drawerOpen
        ) {
            queueRender();
        }
    }

    function processCombatEvents(
        events
    ) {
        if (
            !Array.isArray(
                events
            )
        ) {
            return;
        }

        const hunting = isHuntHere();
        for (
            const event of
            events
        ) {
            recordFarmingEvidence(state.farmingLedger, event);
            if (!hunting) {
                // Boss and supplies are session events, never normal hunt
                // kills/captures (Mystic and other scenes have different rules).
                if (['bossMorto', 'cura', 'revive', 'compra'].includes(event?.k)) {
                    const receipt = normalizeFarmingEvent(event);
                    if (receipt) acceptFarmingEvent(state.farmingLedger, receipt);
                }
                continue;
            }
            if (
                event?.k ===
                    'spawn'
            ) {
                recordSpawnEvent(
                    event
                );
            } else if (
                event?.k ===
                    'ataque'
            ) {
                recordAttackEvent(
                    event
                );
            } else if (
                event?.k ===
                    'morte'
            ) {
                recordDeathEvent(
                    event
                );
            } else {
                const receipt = normalizeFarmingEvent(event);
                if (receipt && acceptFarmingEvent(state.farmingLedger, receipt)) {
                    farmTrackUse(receipt);
                    captureTrackReceipt(receipt);
                }
            }
        }
    }

    function loadCache() {
        try {
            const cache =
                JSON.parse(
                    localStorage.getItem(
                        CACHE_KEY
                    ) || 'null'
                );

            if (!cache) {
                return;
            }

            if (
                Array.isArray(
                    cache.hunts
                )
            ) {
                state.hunts =
                    cache.hunts;
            }

            state.playerLevel =
                Number(
                    cache.playerLevel ||
                    0
                );

            state.currentHuntSlug =
                cache.currentHuntSlug ||
                null;

            if (
                cache.pokedex &&
                typeof cache.pokedex ===
                    'object'
            ) {
                state.pokedex =
                    new Map(
                        Object.entries(
                            cache.pokedex
                        )
                    );
            }

            if (
                Array.isArray(
                    cache.ownedSpecies
                )
            ) {
                state.ownedSpecies =
                    new Set(
                        cache.ownedSpecies
                            .map(Number)
                    );
            }

            if (
                state.hunts.length
            ) {
                setStatus(
                    'status.cachedCatalog'
                );
            }
        } catch {}
    }

    function saveCache() {
        try {
            localStorage.setItem(
                CACHE_KEY,
                JSON.stringify({
                    hunts:
                        state.hunts,
                    playerLevel:
                        state.playerLevel,
                    currentHuntSlug:
                        state.currentHuntSlug,
                    pokedex:
                        Object.fromEntries(
                            state.pokedex
                        ),
                    ownedSpecies:
                        [...state.ownedSpecies]
                })
            );
        } catch {}
    }

    loadCache();

    // ------------------------------------------------------------------
    // PokéIdle protocol
    // ------------------------------------------------------------------

    function mergePokedex(value) {
        if (
            !value ||
            typeof value !== 'object'
        ) {
            return;
        }

        for (
            const [id, entry] of
            Object.entries(value)
        ) {
            state.pokedex.set(
                String(id),
                entry
            );
        }
    }

    function removePokedex(entries) {
        if (!Array.isArray(entries)) {
            return;
        }

        for (const id of entries) {
            state.pokedex.delete(
                String(id)
            );
        }
    }

    function rebuildOwnedSpecies() {
        state.ownedSpecies.clear();

        for (
            const pokemon of
            state.pokemons.values()
        ) {
            const speciesId =
                Number(
                    pokemon?.speciesId
                );

            if (
                Number.isFinite(
                    speciesId
                )
            ) {
                state.ownedSpecies.add(
                    speciesId
                );
            }
        }
    }

    function removeOwnedPokemon(ids) {
        if (!Array.isArray(ids)) {
            return;
        }

        for (const id of ids) {
            state.pokemons.delete(
                Number(id)
            );
        }
    }

    function mergeOwnedPokemon(list) {
        if (!Array.isArray(list)) {
            return;
        }

        for (const pokemon of list) {
            const id =
                Number(
                    pokemon?.speciesId
                );

            if (
                Number.isFinite(id)
            ) {
                state.ownedSpecies.add(
                    id
                );
            }

            if (
                pokemon?.id !==
                    undefined &&
                pokemon?.id !==
                    null
            ) {
                state.pokemons.set(
                    Number(pokemon.id),
                    {
                        ...(state.pokemons.get(
                            Number(pokemon.id)
                        ) || {}),
                        ...pokemon
                    }
                );
            }

            if (
                Number.isFinite(id) &&
                Array.isArray(
                    pokemon?.tipos
                )
            ) {
                state.typesBySpecies.set(
                    id,
                    pokemon.tipos.map(
                        type =>
                            String(type)
                                .toUpperCase()
                    )
                );
            }
        }

        refreshStrongestPokemon();
    }

    function mergeState(
        gameState,
        full = false
    ) {
        if (
            !gameState ||
            typeof gameState !==
                'object'
        ) {
            return;
        }

        const fullSnapshot =
            full ||
            gameState.cheio === true;

        if (
            Number.isFinite(
                Number(gameState.level)
            )
        ) {
            state.playerLevel =
                Number(
                    gameState.level
                );
        }

        /*
         * In the delta protocol, a missing key means "unchanged" while an
         * explicit null means "clear it".
         */
        farmUpdateInventory(gameState);
        const beforeFarmingScope = farmingSnapshotScope();
        const farmSnapshot = normalizeFarmingSnapshot(gameState);
        if (farmSnapshot) Object.assign(state.farmingSnapshot, farmSnapshot);
        if (Object.hasOwn(gameState,'tierOutland') ||
            Object.hasOwn(gameState,'outlandTier') ||
            Object.hasOwn(gameState,'outland_tier')) {
            state.outlandTierSeen=true;
            if(state.pendingOutlandTier &&
                state.farmingSnapshot.outlandTier === state.pendingOutlandTier.tier)
                state.pendingOutlandTier=null;
        }
        const incomingXpBonuses = xpBonusSnapshot(gameState);
        if (incomingXpBonuses) Object.assign(state.xpBonusState, incomingXpBonuses);
        if (beforeFarmingScope !== farmingSnapshotScope()) {
            state.farmingLedger = makeFarmingLedger();
            state.combatRevision++;
            state.combatProfileCache = null;
            state.estimateCache.clear();
        }
        if (
            Object.prototype.hasOwnProperty.call(
                gameState,
                'huntSlug'
            )
        ) {
            if (state.currentHuntSlug !== gameState.huntSlug) {
                state.rateGeneration++;
                state.farmingLedger = makeFarmingLedger();
            }
            state.currentHuntSlug =
                typeof gameState.huntSlug ===
                    'string'
                    ? gameState.huntSlug
                    : null;
        }

        /*
         * PokéIdle keeps huntSlug as the last selected hunt while another
         * scene can own the field. Mirror the native huntEmCampo() rule:
         * Center, house, boss arena and Mystic Arena are not active hunts.
         */
        if (
            fullSnapshot ||
            Object.prototype.hasOwnProperty.call(
                gameState,
                'noCentro'
            )
        ) {
            state.huntScene.noCentro =
                Boolean(
                    gameState.noCentro
                );
        }

        if (
            fullSnapshot ||
            Object.prototype.hasOwnProperty.call(
                gameState,
                'casa'
            )
        ) {
            state.huntScene.casaDentro =
                gameState.casa?.dentro ??
                null;
        }

        if (
            fullSnapshot ||
            Object.prototype.hasOwnProperty.call(
                gameState,
                'boss'
            )
        ) {
            state.huntScene.bossArena =
                gameState.boss?.arena ??
                null;
        }

        if (
            fullSnapshot ||
            Object.prototype.hasOwnProperty.call(
                gameState,
                'mistico'
            )
        ) {
            state.huntScene.mistico =
                Boolean(
                    gameState.mistico
                );
        }

        if (fullSnapshot) {
            state.huntSceneKnown =
                true;
        }

        if (
            Object.prototype.hasOwnProperty.call(
                gameState,
                'activeId'
            )
        ) {
            const nextActiveId =
                gameState.activeId ===
                    null
                    ? null
                    : Number(
                        gameState.activeId
                    );

            if (
                nextActiveId !==
                    state.activePokemonId &&
                (
                    nextActiveId === null ||
                    Number.isFinite(
                        nextActiveId
                    )
                )
            ) {
                state.combatTargets.clear();
            }

            state.activePokemonId =
                nextActiveId === null ||
                Number.isFinite(
                    nextActiveId
                )
                    ? nextActiveId
                    : state.activePokemonId;
        }

        /*
         * Match shared/estado-delta.mjs: complete collections replace local
         * state; pkMud/dexMud patch it; pkFora/dexFora remove entries.
         */
        if (
            gameState.pokedex &&
            typeof gameState.pokedex ===
                'object'
        ) {
            state.pokedex.clear();
            mergePokedex(
                gameState.pokedex
            );
        } else if (fullSnapshot) {
            state.pokedex.clear();
        }

        mergePokedex(
            gameState.dexMud
        );

        removePokedex(
            gameState.dexFora
        );

        if (
            Array.isArray(
                gameState.pokemons
            )
        ) {
            state.pokemons.clear();
            mergeOwnedPokemon(
                gameState.pokemons
            );
        } else if (fullSnapshot) {
            state.pokemons.clear();
        }

        mergeOwnedPokemon(
            gameState.pkMud
        );

        removeOwnedPokemon(
            gameState.pkFora
        );

        rebuildOwnedSpecies();
        refreshStrongestPokemon();

        if (
            gameState.selvagem &&
            Number.isFinite(
                Number(
                    gameState.selvagem
                        .speciesId
                )
            ) &&
            Array.isArray(
                gameState.selvagem.tipos
            )
        ) {
            state.typesBySpecies.set(
                Number(
                    gameState.selvagem
                        .speciesId
                ),
                gameState.selvagem
                    .tipos
                    .map(
                        type =>
                            String(type)
                                .toUpperCase()
                    )
            );
        }

        if (full) {
            saveCache();
        }
    }

    function syncFromControllerBridge() {
        try {
            const bridge = page.__mothControllerBridgeV1;
            if (
                !bridge ||
                typeof bridge.gameSnapshot !== 'function'
            ) {
                return false;
            }

            const snapshot = bridge.gameSnapshot();
            const gameState = snapshot?.state || {};

            if (Array.isArray(snapshot?.hunts) && snapshot.hunts.length) {
                state.hunts = snapshot.hunts.map(hunt => ({
                    ...hunt,
                    slug: String(hunt?.slug || ''),
                    nome: String(hunt?.nome || hunt?.name || hunt?.slug || ''),
                    nivel: Number(hunt?.nivel ?? hunt?.level) || 0,
                    especies: Array.isArray(hunt?.especies)
                        ? hunt.especies
                        : Array.isArray(hunt?.species)
                            ? hunt.species.map(species => ({
                                pokeId: Number(species?.pokeId ?? species?.id) || 0,
                                nome: String(species?.nome || species?.name || '')
                            }))
                            : []
                }));
            }

            if (gameState && typeof gameState === 'object') {
                mergeState(
                    {
                        ...gameState,
                        pokemons: Array.isArray(gameState.pokemons)
                            ? gameState.pokemons
                            : undefined,
                        pokedex: gameState.pokedex || undefined,
                    },
                    false
                );
            }

            if (
                snapshot?.serverTypeChart &&
                typeof snapshot.serverTypeChart === 'object'
            ) {
                state.serverTypeChart = snapshot.serverTypeChart;
            }

            if (state.hunts.length) {
                ensureTypeData();
            }

            return true;
        } catch {
            return false;
        }
    }

    function handleHuntBattleEvent(message) {
        if (
            message?.t !== 'batalha' ||
            !Array.isArray(message.ev)
        ) {
            return false;
        }

        const huntEvent =
            message.ev.find(
                event =>
                    event?.k === 'hunt' &&
                    typeof event.slug === 'string'
            );

        if (!huntEvent) {
            return false;
        }

        if (state.currentHuntSlug !== huntEvent.slug) {
            state.rateGeneration++;
            state.farmingLedger = makeFarmingLedger();
        }
        state.currentHuntSlug =
            huntEvent.slug;

        /*
         * A hunt battle event is authoritative proof that the normal hunt
         * scene owns the field, even before the next state snapshot arrives.
         */
        state.huntSceneKnown =
            true;
        state.huntScene.noCentro =
            false;
        state.huntScene.casaDentro =
            null;
        state.huntScene.bossArena =
            null;
        state.huntScene.mistico =
            false;

        state.combatTargets.clear();

        const enteredRecord =
            performanceRecord(
                huntEvent.slug,
                false
            );

        if (enteredRecord) {
            enteredRecord.lastKillAt =
                0;

            enteredRecord.lastAttackAt =
                0;

            enteredRecord.lastAttackSlot =
                null;
        }

        setStatus(
            'status.entered',
            {
                hunt:
                    huntEvent.nome ||
                    huntEvent.slug
            }
        );

        state.pendingTravel = null;

        saveCache();
        queueRender();

        return true;
    }

    function handleProtocolMessage(
        data
    ) {
        if (typeof data !== 'string') {
            return;
        }

        let message;

        try {
            message =
                JSON.parse(data);
        } catch {
            return;
        }

        if (
            message?.t === 'batalha' &&
            Array.isArray(message.ev)
        ) {
            /*
             * Hunt transition first so spawns/attacks in the same packet
             * are attributed to the new hunt.
             */
            handleHuntBattleEvent(
                message
            );

            processCombatEvents(
                message.ev
            );

            return;
        }

        if (
            message?.t ===
                'market' &&
            message?.aba ===
                'historicoGlobal'
        ) {
            handleMarketHistory(
                message
            );
            return;
        }

        if (
            message?.t ===
                'market' &&
            message?.aba ===
                'especies' &&
            state.marketListingFetch
        ) {
            handleMarketSpeciesSummary(
                message
            );
        }

        if (
            message?.t ===
                'welcome'
        ) {
            // Treat reconnect/account replacement as a new evidence session.
            state.rateGeneration++;
            state.farmingLedger = makeFarmingLedger();
            state.farmingSnapshot = {};
            state.outlandTierSeen = false;
            state.pendingOutlandTier = null;
            state.outlandCatalogTiers = null;
            state.xpBonusState = {};
            state.captureChanceEvidence = {seen:0,min:null,max:null};
            state.calibrationEvidence.clear();
            state.combatTargets.clear();
            state.lastLeadPokemon = null;
            state.activePokemonId = null;
            if (
                message.tabelaTipos &&
                typeof message.tabelaTipos ===
                    'object'
            ) {
                state.serverTypeChart =
                    message.tabelaTipos;
            }

            if (
                Number.isFinite(
                    Number(
                        message.ampliacaoHunt
                    )
                )
            ) {
                state.huntAmplification =
                    Number(
                        message.ampliacaoHunt
                    );
            }

            if (
                Array.isArray(
                    message.hunts
                )
            ) {
                state.hunts =
                    message.hunts;

                setStatus(
                    'status.huntsLoaded',
                    {
                        count:
                            state.hunts.length
                    }
                );
            }

            const publishedTiers=message.catalogoOutlandTiers ??
                message.outlandTiers;
            if(Array.isArray(publishedTiers) && publishedTiers.length===8 &&
                publishedTiers.every((t,i)=>Number(t?.tier)===i+1 &&
                    Number(t?.nivel)===FARM_OUTLAND_TIERS[i][0] &&
                    Number(t?.mult)===FARM_OUTLAND_TIERS[i][1]))
                state.outlandCatalogTiers=publishedTiers.map(t=>({
                    tier:Number(t.tier),nivel:Number(t.nivel),mult:Number(t.mult)
                }));
            farmApplyRuntimeCatalog(message);
            mergeState(
                message.estado,
                true
            );

            saveCache();

            if (
                state.drawerOpen
            ) {
                ensureMarketValues();
            }

            queueRender();

            return;
        }

        if (
            message?.t ===
                'estado'
        ) {
            mergeState(
                message.estado,
                false
            );

            saveCache();
            queueRender();
        }
    }

    function addMarketSample(
        bucket,
        key,
        price,
        soldAt
    ) {
        if (
            !key ||
            !Number.isFinite(price) ||
            price <= 0
        ) {
            return;
        }

        const previous =
            bucket.get(
                key
            ) || {
                sum: 0,
                count: 0,
                min: price,
                max: price,
                lastSaleAt: 0
            };

        previous.sum +=
            price;
        previous.count++;
        previous.min =
            Math.min(
                previous.min,
                price
            );
        previous.max =
            Math.max(
                previous.max,
                price
            );
        previous.lastSaleAt =
            Math.max(
                Number(
                    previous.lastSaleAt ||
                    0
                ),
                Number(
                    soldAt ||
                    0
                )
            );

        bucket.set(
            key,
            previous
        );
    }

    function processMarketSale(
        line,
        bucket
    ) {
        if (
            line?.tipo !==
                'pokemon' ||
            line?.moeda !==
                'gold'
        ) {
            return;
        }

        const ficha =
            line.ficha ||
            {};

        if (ficha.shiny) {
            return;
        }

        const price =
            Number(
                line.bruto ??
                line.preco
            );

        if (
            !Number.isFinite(price) ||
            price <= 0
        ) {
            return;
        }

        const speciesId =
            Number(
                ficha.speciesId ??
                ficha.pokeId
            );

        if (
            Number.isFinite(
                speciesId
            ) &&
            speciesId > 0
        ) {
            addMarketSample(
                bucket,
                'id:' + speciesId,
                price,
                line.em
            );
        }

        const name =
            normalize(
                ficha.nome ||
                ficha.name ||
                ''
            );

        if (name) {
            addMarketSample(
                bucket,
                'name:' + name,
                price,
                line.em
            );
        }
    }

    function finalizeMarketFetch() {
        const fetch =
            state.marketFetch;

        if (!fetch) {
            return;
        }

        const now =
            Date.now();

        for (
            const [key, sample] of
            fetch.batch
        ) {
            if (
                !sample.count
            ) {
                continue;
            }

            state.marketValues.set(
                key,
                {
                    average:
                        sample.sum /
                        sample.count,
                    count:
                        sample.count,
                    min:
                        sample.min,
                    max:
                        sample.max,
                    lastSaleAt:
                        sample.lastSaleAt,
                    sampledAt:
                        now,
                    source:
                        'sales'
                }
            );
        }

        state.marketFetch =
            null;

        startMarketListingFetch();

        if (
            !state.marketListingFetch
        ) {
            state.marketCacheSavedAt =
                now;
            state.marketStatus =
                'ready';

            saveMarketCache();
            queueRender();
        }
    }

    function requestMarketHistoryPage() {
        const fetch =
            state.marketFetch;

        if (
            !fetch ||
            !state.activeSocket ||
            state.activeSocket
                .readyState !==
                page.WebSocket.OPEN
        ) {
            return false;
        }

        if (
            q('#cm-hist-corpo')
        ) {
            finalizeMarketFetch();
            return false;
        }

        try {
            state.activeSocket.send(
                JSON.stringify({
                    t:
                        'market.historicoGlobal',
                    pagina:
                        fetch.page,
                    tipo:
                        'pokemon',
                    moeda:
                        'gold'
                })
            );

            return true;
        } catch {
            state.marketFetch =
                null;
            state.marketStatus =
                state.marketValues.size
                    ? 'cached'
                    : 'error';
            return false;
        }
    }

    function requestMarketSpeciesPage() {
        const fetch =
            state.marketListingFetch;

        if (
            !fetch ||
            !state.activeSocket ||
            state.activeSocket
                .readyState !==
                page.WebSocket.OPEN
        ) {
            return false;
        }

        try {
            state.activeSocket.send(
                JSON.stringify({
                    t:
                        'market.especies',
                    tipo:
                        'pokemon',
                    moeda:
                        'gold',
                    busca:
                        '',
                    ordem:
                        'baratos',
                    criterios:
                        [],
                    elemento:
                        '',
                    soShiny:
                        false,
                    soP5:
                        false,
                    soTmElemental:
                        false,
                    soTmAoe:
                        false,
                    semOutland:
                        false,
                    nivelMin:
                        '',
                    nivelMax:
                        '',
                    potenciaMin:
                        '',
                    potenciaMax:
                        '',
                    ivMin:
                        '',
                    ivMax:
                        '',
                    qualidadeMin:
                        '',
                    qualidadeMax:
                        '',
                    notaMin:
                        '',
                    notaMax:
                        '',
                    pagina:
                        fetch.page
                })
            );

            return true;
        } catch {
            state.marketListingFetch =
                null;
            return false;
        }
    }

    function startMarketListingFetch() {
        if (
            state.marketListingFetch ||
            !state.activeSocket ||
            state.activeSocket
                .readyState !==
                page.WebSocket.OPEN
        ) {
            return;
        }

        state.marketListingFetch = {
            page: 0
        };

        requestMarketSpeciesPage();
    }

    function finishMarketListingFetch() {
        state.marketListingFetch =
            null;
        state.marketCacheSavedAt =
            Date.now();
        state.marketStatus =
            'ready';

        saveMarketCache();
        queueRender();
    }

    function handleMarketSpeciesSummary(
        message
    ) {
        const fetch =
            state.marketListingFetch;

        if (
            !fetch ||
            Number(
                message?.pagina ??
                0
            ) !==
                fetch.page
        ) {
            return;
        }

        for (
            const row of
            message.linhas ||
            []
        ) {
            const id =
                Number(
                    row?.speciesId
                );

            const price =
                Number(
                    row?.minGold
                );

            if (
                !Number.isFinite(id) ||
                id <= 0 ||
                !Number.isFinite(price) ||
                price <= 0
            ) {
                continue;
            }

            const key =
                'id:' + id;

            const existing =
                state.marketValues.get(
                    key
                );

            if (
                existing?.source ===
                    'sales' ||
                (
                    existing?.count &&
                    existing.count > 0
                )
            ) {
                continue;
            }

            state.marketValues.set(
                key,
                {
                    average:
                        price,
                    count: 0,
                    min:
                        price,
                    max:
                        price,
                    source:
                        'listing',
                    sampledAt:
                        Date.now()
                }
            );
        }

        const total =
            Number(
                message.total
            );

        const perPage =
            Number(
                message.porPagina ||
                24
            );

        const hasMore =
            Number.isFinite(total)
                ? (
                    fetch.page + 1 <
                    Math.ceil(
                        total /
                        Math.max(
                            1,
                            perPage
                        )
                    )
                )
                : (
                    Array.isArray(
                        message.linhas
                    ) &&
                    message.linhas.length >=
                        perPage
                );

        if (
            hasMore &&
            fetch.page + 1 <
                MARKET_LISTING_MAX_PAGES
        ) {
            fetch.page++;
            requestMarketSpeciesPage();
            return;
        }

        finishMarketListingFetch();
    }

    function ensureMarketValues() {
        if (
            state.marketFetch ||
            state.marketListingFetch ||
            (
                state.marketValues.size >
                    0 &&
                state.marketCacheSavedAt &&
                Date.now() -
                    state.marketCacheSavedAt <
                    MARKET_REFRESH_MS
            )
        ) {
            return;
        }

        if (
            !state.activeSocket ||
            state.activeSocket
                .readyState !==
                page.WebSocket.OPEN ||
            q('#cm-hist-corpo')
        ) {
            return;
        }

        state.marketFetch = {
            page: 0,
            batch:
                new Map()
        };

        state.marketStatus =
            'loading';

        requestMarketHistoryPage();
        queueRender();
    }

    function handleMarketHistory(
        message
    ) {
        const fetch =
            state.marketFetch;

        if (
            !fetch ||
            Number(
                message?.pagina ??
                0
            ) !==
                fetch.page
        ) {
            return;
        }

        for (
            const line of
            message.linhas ||
            []
        ) {
            processMarketSale(
                line,
                fetch.batch
            );
        }

        if (
            message.temMais &&
            fetch.page + 1 <
                MARKET_HISTORY_MAX_PAGES &&
            !q('#cm-hist-corpo')
        ) {
            fetch.page++;
            requestMarketHistoryPage();
            return;
        }

        finalizeMarketFetch();
    }

    function attachSocket(
        socket
    ) {
        state.sockets++;
        state.activeSocket =
            socket;

        socket.addEventListener(
            'close',
            () => {
                if (
                    state.activeSocket ===
                    socket
                ) {
                    state.activeSocket =
                        null;
                    state.rateGeneration++;
                    state.farmingLedger = makeFarmingLedger();
                    state.farmingSnapshot = {};
                    state.xpBonusState = {};
                    state.calibrationEvidence.clear();
                    state.combatTargets.clear();
                    state.lastLeadPokemon = null;

                    if (
                        state.marketFetch ||
                        state.marketListingFetch
                    ) {
                        state.marketFetch =
                            null;
                        state.marketListingFetch =
                            null;
                        state.marketStatus =
                            state.marketValues.size
                                ? 'cached'
                                : 'idle';
                    }
                }
            }
        );

        socket.addEventListener(
            'message',
            event => {
                if (state.activeSocket !== socket) return;
                if (
                    typeof Blob !==
                        'undefined' &&
                    event.data instanceof
                        Blob
                ) {
                    event.data.text()
                        .then(
                            handleProtocolMessage
                        )
                        .catch(() => {});

                    return;
                }

                handleProtocolMessage(
                    event.data
                );
            }
        );
    }

    function installWebSocketHook() {
        if (
            state.websocketHookInstalled
        ) {
            return true;
        }

        const NativeWebSocket =
            page.WebSocket;

        if (
            typeof NativeWebSocket !==
                'function'
        ) {
            return false;
        }

        if (
            page.__mothHuntAtlasWebSocket
        ) {
            state.websocketHookInstalled =
                true;

            return true;
        }

        const WrappedWebSocket =
            new Proxy(
                NativeWebSocket,
                {
                    construct(
                        target,
                        args
                    ) {
                        const socket =
                            Reflect.construct(
                                target,
                                args,
                                target
                            );

                        attachSocket(
                            socket
                        );

                        return socket;
                    }
                }
            );

        try {
            page.WebSocket =
                WrappedWebSocket;

            page.__mothHuntAtlasWebSocket =
                true;

            state.websocketHookInstalled =
                page.WebSocket ===
                WrappedWebSocket;

            return state.websocketHookInstalled;
        } catch {
            return false;
        }
    }

    installWebSocketHook();

    // ------------------------------------------------------------------
    // Type data
    // ------------------------------------------------------------------

    function loadTypeCache() {
        try {
            const cached =
                JSON.parse(
                    localStorage.getItem(
                        TYPE_CACHE_KEY
                    ) || 'null'
                );

            if (
                !cached ||
                !cached.species
            ) {
                return false;
            }

            for (
                const [id, types] of
                Object.entries(
                    cached.species
                )
            ) {
                if (
                    Array.isArray(types)
                ) {
                    state.typesBySpecies.set(
                        Number(id),
                        types
                    );
                }
            }

            const age =
                Date.now() -
                Number(
                    cached.savedAt ||
                    0
                );

            state.typeStatus =
                age <
                    30 *
                    24 *
                    60 *
                    60 *
                    1000
                    ? 'ready'
                    : 'stale';

            return true;
        } catch {
            return false;
        }
    }

    loadTypeCache();

    function requestJson(url) {
        if (
            typeof GM_xmlhttpRequest ===
                'function'
        ) {
            return new Promise(
                (resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url,
                        timeout: 15000,

                        onload:
                            response => {
                                if (
                                    response.status <
                                        200 ||
                                    response.status >=
                                        300
                                ) {
                                    reject(
                                        new Error(
                                            'HTTP ' +
                                            response.status
                                        )
                                    );

                                    return;
                                }

                                try {
                                    resolve(
                                        JSON.parse(
                                            response.responseText
                                        )
                                    );
                                } catch (
                                    error
                                ) {
                                    reject(
                                        error
                                    );
                                }
                            },

                        onerror:
                            reject,

                        ontimeout:
                            () =>
                                reject(
                                    new Error(
                                        'timeout'
                                    )
                                )
                    });
                }
            );
        }

        return fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(
                        'HTTP ' +
                        response.status
                    );
                }

                return response.json();
            });
    }

    function pokemonIdFromUrl(
        url
    ) {
        const match =
            String(url)
                .match(
                    /\/pokemon\/(\d+)\/?$/i
                );

        if (!match) {
            return null;
        }

        const id =
            Number(match[1]);

        return Number.isFinite(id)
            ? id
            : null;
    }

    let typeLoadPromise =
        null;

    function ensureTypeData() {
        if (
            state.typeStatus ===
                'ready'
        ) {
            return Promise.resolve();
        }

        if (typeLoadPromise) {
            return typeLoadPromise;
        }

        state.typeStatus =
            'loading';

        queueRender();

        typeLoadPromise =
            Promise.all(
                STANDARD_TYPES.map(
                    async type => {
                        const data =
                            await requestJson(
                                'https://pokeapi.co/api/v2/type/' +
                                type.toLowerCase()
                            );

                        return {
                            type,
                            pokemon:
                                Array.isArray(
                                    data?.pokemon
                                )
                                    ? data.pokemon
                                    : []
                        };
                    }
                )
            )
                .then(
                    results => {
                        const discovered =
                            new Map();

                        for (
                            const result of
                            results
                        ) {
                            for (
                                const row of
                                result.pokemon
                            ) {
                                const id =
                                    pokemonIdFromUrl(
                                        row?.pokemon
                                            ?.url
                                    );

                                if (
                                    !id ||
                                    id >
                                        10000
                                ) {
                                    continue;
                                }

                                const types =
                                    discovered.get(
                                        id
                                    ) || [];

                                if (
                                    !types.includes(
                                        result.type
                                    )
                                ) {
                                    types.push(
                                        result.type
                                    );
                                }

                                discovered.set(
                                    id,
                                    types
                                );
                            }
                        }

                        for (
                            const [id, types] of
                            discovered
                        ) {
                            state.typesBySpecies.set(
                                id,
                                types
                            );
                        }

                        state.typeStatus =
                            'ready';

                        try {
                            localStorage.setItem(
                                TYPE_CACHE_KEY,
                                JSON.stringify({
                                    savedAt:
                                        Date.now(),
                                    species:
                                        Object.fromEntries(
                                            [...state.typesBySpecies]
                                                .map(
                                                    ([id, types]) => [
                                                        String(id),
                                                        types
                                                    ]
                                                )
                                        )
                                })
                            );
                        } catch {}

                        queueRender();
                    }
                )
                .catch(
                    error => {
                        console.warn(
                            '[PokéIdle Hunt Atlas] type data unavailable',
                            error
                        );

                        state.typeStatus =
                            'error';

                        queueRender();
                    }
                )
                .finally(
                    () => {
                        typeLoadPromise =
                            null;
                    }
                );

        return typeLoadPromise;
    }

    function weaknessMultiplier(
        speciesTypes,
        attackType
    ) {
        const chart =
            TYPE_CHART[
                attackType
            ] || {};

        return speciesTypes.reduce(
            (multiplier, defender) =>
                multiplier *
                (
                    chart[
                        defender
                    ] ?? 1
                ),
            1
        );
    }

    // ------------------------------------------------------------------
    // Upstream combat catalog
    // ------------------------------------------------------------------


    // The game's welcome.hunts catalog is authoritative; map markers only
    // provide optional reference locations. Never derive unlocks or XP from it.
    function locationForHunt(hunt) {
        return state.locationsBySlug.get(String(hunt?.slug || '')) || null;
    }

    function locationCoverage() {
        const hunts = state.hunts || [];
        const matched = hunts.filter(hunt => locationForHunt(hunt)).length;
        const levelConflicts = hunts.filter(hunt => {
            const marker = locationForHunt(hunt);
            const liveLevel = Number(hunt?.nivel);
            return marker && Number.isFinite(liveLevel) &&
                Number.isFinite(marker.level) &&
                marker.level > 0 && liveLevel !== marker.level;
        }).length;
        return { matched, total: hunts.length, levelConflicts };
    }

    function sharedWorldLocation(hunt) {
        const marker = locationForHunt(hunt);
        if (!marker) return [];
        const liveHunts = new Set(state.hunts.map(row => row.slug));
        return (state.locationsByRange.get(marker.key) || [])
            .filter(row => row.slug !== hunt.slug && liveHunts.has(row.slug))
            .map(row => row.name).slice(0, 4);
    }

    function ensureLocationIndex() {
        if (state.locationIndexStatus === 'ready') return Promise.resolve();
        if (state.locationIndexPromise) return state.locationIndexPromise;
        if (state.locationIndexStatus === 'error' &&
            Date.now() - state.locationLastAttempt < 60000) return Promise.resolve();
        state.locationLastAttempt = Date.now();
        state.locationIndexStatus = 'loading';
        state.locationIndexPromise = fetch('/assets/world/map-markers.json', {
            credentials: 'same-origin', cache: 'force-cache'
        }).then(r => {
            if (!r.ok) throw new Error('map-markers HTTP ' + r.status);
            return r.json();
        }).then(data => {
            if (!Array.isArray(data?.hunts) || !(data?.map?.w > 0) ||
                !(data?.map?.h > 0)) throw new Error('invalid map marker index');
            const bySlug = new Map(), byRange = new Map();
            for (const row of data.hunts) {
                const slug = String(row?.slug || '');
                if (!slug || bySlug.has(slug) ||
                    !Array.isArray(row.pixel) || row.pixel.length !== 2 ||
                    !row.pixel.every(Number.isFinite) ||
                    row.pixel[0] < 0 || row.pixel[0] > data.map.w ||
                    row.pixel[1] < 0 || row.pixel[1] > data.map.h ||
                    !Array.isArray(row.range) || row.range.length !== 5 ||
                    !row.range.every(Number.isFinite)) continue;
                const key = row.range.join(':');
                const entry = {
                    slug, name: String(row.name || slug), area: String(row.area || ''),
                    level: Number(row.level) || 0,
                    pixel: row.pixel, range: row.range, key
                };
                bySlug.set(slug, entry);
                if (!byRange.has(key)) byRange.set(key, []);
                byRange.get(key).push(entry);
            }
            if (!bySlug.size) throw new Error('no usable map markers');
            state.locationsBySlug = bySlug;
            state.locationsByRange = byRange;
            state.locationIndexDiagnostics.loaded = bySlug.size;
            state.locationIndexStatus = 'ready';
            queueRender();
        }).catch(error => {
            state.locationIndexStatus = 'error';
            console.warn('[Hunt Atlas experimental] map-marker lookup failed', error);
            queueRender();
        }).finally(() => { state.locationIndexPromise = null; });
        return state.locationIndexPromise;
    }


    // Index published by the game, but potentially older than the current
    // battle engine. Entries describe moves LEARNABLE by species/level, not
    // necessarily the actual loadout. Combat events remain authoritative.
    function moveNameKey(name) {
        return normalize(name);
    }

    function indexedMove(name) {
        return state.movesByName.get(moveNameKey(name)) || null;
    }


    function catalogMovesForSpecies(id) {
        const pokemonId = Number(id);
        const own = state.speciesCombat.get(pokemonId)?.attacks;
        if (own?.length) return own;
        // Clones inherit the national list, except when their own curated
        // catalog entry exists. Never normalize other 14xxx/10xxx forms.
        if (pokemonId >= 13000 && pokemonId < 14000) {
            return state.speciesCombat.get(pokemonId - 13000)?.attacks || [];
        }
        return [];
    }

    function moveSourceForLead(pokemon = leadPokemon()) {
        if (!pokemon) return 'none';
        return catalogMovesForSpecies(pokemon.speciesId).length
            ? 'catalog' : state.moveIndexStatus === 'ready'
                ? 'index' : 'none';
    }

    function movesForLead(pokemon = leadPokemon()) {
        if (!pokemon) return [];
        const id = Number(pokemon.speciesId);
        const level = Number(pokemon.level) || 0;
        const catalog = catalogMovesForSpecies(id);
        if (catalog.length) {
            // Current October creature overrides outrank the August index.
            // Some moves are added in server boot after these files are read;
            // only observed battle moves can prove the actual loadout.
            return catalog.filter(move => move.learnLevel <= level);
        }
        const possible = state.movesBySpecies.get(id) ||
            (id >= 13000 && id < 14000
                ? state.movesBySpecies.get(id - 13000) : null) || [];
        return possible.filter(move => move.learnLevel <= level);
    }

    function indexConflictsForLead(pokemon = leadPokemon()) {
        if (!pokemon || state.moveIndexStatus !== 'ready') return [];
        const id = Number(pokemon.speciesId);
        const catalog = catalogMovesForSpecies(id);
        if (!catalog.length) return [];
        const index = state.movesBySpecies.get(id) ||
            (id >= 13000 && id < 14000
                ? state.movesBySpecies.get(id - 13000) : null) || [];
        const known = new Map(index.map(move => [moveNameKey(move.name), move]));
        return catalog.filter(move => {
            const old = known.get(moveNameKey(move.name));
            return !old || old.type !== move.type ||
                old.category !== move.category || old.power !== move.power ||
                old.cooldownMs !== move.cooldownMs ||
                old.learnLevel !== move.learnLevel;
        });
    }

    function ensureMoveIndex() {
        if (state.moveIndexStatus === 'ready') return Promise.resolve();
        if (state.moveIndexPromise) return state.moveIndexPromise;
        if (state.moveIndexStatus === 'error' &&
            Date.now() - state.moveLastAttempt < 60000) return Promise.resolve();
        state.moveLastAttempt = Date.now();
        state.moveIndexStatus = 'loading';
        state.moveIndexPromise = fetch('/assets/index/moves-index.json', {
            credentials: 'same-origin', cache: 'force-cache'
        }).then(r => {
            if (!r.ok) throw new Error('moves-index HTTP ' + r.status);
            return r.json();
        }).then(data => {
            if (!data?.porAtaque || typeof data.porAtaque !== 'object') {
                throw new Error('invalid moves-index schema');
            }
            const bySpecies = new Map(), byName = new Map();
            for (const [name, raw] of Object.entries(data.porAtaque)) {
                const type = String(raw?.tipo || '').toUpperCase();
                if (!name || !type || !Array.isArray(raw?.aprendidoPor)) continue;
                const common = {
                    name: String(raw.nome || name),
                    type, category: String(raw.categoria || ''),
                    cooldownMs: Number(raw.cooldownMs) || 0,
                    power: Number(raw.power) || 0
                };
                byName.set(moveNameKey(name), common);
                for (const entry of raw.aprendidoPor) {
                    const id = Number(entry.pokeId);
                    const level = Number(entry.learnLevel);
                    if (!Number.isInteger(id) || id <= 0 ||
                        !Number.isFinite(level) || level <= 0) continue;
                    const ownPower = Number(entry.power);
                    const move = {
                        ...common, learnLevel: level,
                        speciesId: id,
                        power: Number.isFinite(ownPower) && ownPower > 0
                            ? ownPower : common.power
                    };
                    if (!bySpecies.has(id)) bySpecies.set(id, []);
                    bySpecies.get(id).push(move);
                }
            }
            if (!bySpecies.size) throw new Error('no usable indexed moves');
            state.movesByName = byName;
            state.movesBySpecies = bySpecies;
            state.moveIndexGeneratedAt = String(data.gerado || '');
            state.moveIndexStatus = 'ready';
            state.combatRevision++;
            state.combatProfileCache = null;
            queueRender();
        }).catch(error => {
            state.moveIndexStatus = 'error';
            console.warn('[Hunt Atlas experimental] move index unavailable', error);
            queueRender();
        }).finally(() => { state.moveIndexPromise = null; });
        return state.moveIndexPromise;
    }

    function mergeCombatCreature(
        creature
    ) {
        const id = Number(outlandNormalizeSpeciesId(creature?.pokeId));

        if (
            !Number.isFinite(id)
        ) {
            return;
        }

        const previous =
            state.speciesCombat.get(
                id
            ) || {};

        const meta = {
            ...previous,
            id,
            // Later override arrays replace earlier raw-catalog arrays.
            // Never mutate the source arrays (other game components reuse them).
            attacks: Array.isArray(creature?.attacks)
                ? creature.attacks.filter(row =>
                    typeof row?.name === 'string' && row?.type &&
                    Number(row.power) > 0)
                    .map(row => ({
                        name: row.name,
                        type: String(row.type).toUpperCase(),
                        category: String(row.category || ''),
                        power: Number(row.power) || 0,
                        cooldownMs: Number(row.cooldownMs) || 0,
                        learnLevel: Math.max(1, Number(row.learnLevel) || 1)
                    }))
                : previous.attacks || [],
            name:
                creature?.name ||
                previous.name ||
                null,
            baseHp:
                Number.isFinite(
                    Number(
                        creature?.baseHp
                    )
                )
                    ? Number(
                        creature.baseHp
                    )
                    : previous.baseHp,
            type1:
                creature?.type1 ||
                previous.type1 ||
                null,
            type2:
                creature?.type2 ||
                previous.type2 ||
                null,
            huntLevel:
                Number.isFinite(
                    Number(
                        creature?.huntLevel
                    )
                )
                    ? Number(
                        creature.huntLevel
                    )
                    : previous.huntLevel,
            captureLevelCeiling:Number.isInteger(Number(
                creature?.tetoCaptura)) && Number(creature.tetoCaptura)>0
                ? Number(creature.tetoCaptura)
                :previous.captureLevelCeiling??null,
            rawLoot: Array.isArray(creature?.loot)
                ? creature.loot.map(line => ({...line}))
                : previous.rawLoot ?? null,
            catalogSellValue:
                Number.isFinite(
                    Number(
                        creature?.sellValue
                    )
                )
                    ? Number(
                        creature.sellValue
                    )
                    : previous.catalogSellValue,
            priceNpc:
                Number.isFinite(
                    Number(
                        creature?.priceNpc
                    )
                )
                    ? Number(
                        creature.priceNpc
                    )
                    : previous.priceNpc
        };

        meta.sellValue =
            normalizedNpcBaseFromCatalog(
                meta
            );

        state.speciesCombat.set(
            id,
            meta
        );

        const types =
            [
                meta.type1,
                meta.type2
            ]
                .filter(Boolean)
                .map(
                    type =>
                        String(type)
                            .toUpperCase()
                );

        if (types.length) {
            state.typesBySpecies.set(
                id,
                types
            );
        }
    }

    function speciesCombatMeta(
        speciesId
    ) {
        const id = Number(outlandNormalizeSpeciesId(speciesId));

        if (
            !Number.isFinite(id)
        ) {
            return null;
        }

        const direct =
            state.speciesCombat.get(
                id
            );

        if (direct) {
            return direct;
        }

        /*
         * Orre clones use 13xxx ids and inherit the national species'
         * stats in upstream.
         */
        if (id >= 13000) {
            return (
                state.speciesCombat.get(
                    id %
                        1000
                ) ||
                null
            );
        }

        return null;
    }


    function rebuildNpcLootCatalog() {
        // Uses already-loaded raw item/creature assets once per catalog
        // revision. It reconstructs upstream normalization, not server truth.
        const shopIds = new Set(state.itemPrices.keys());
        const special = new Set([70000]); // upstream Bronze Boss Token
        const priceOf = name => {
            const item = state.itemsByName.get(String(name || '').toLowerCase());
            return farmNpcPrice(item, shopIds, special);
        };
        state.npcLootBySpecies.clear();
        state.captureRarities.clear();
        for(const [id,meta] of state.speciesCombat) {
            const rarity=captureRarityFromCatalog(meta);
            if(rarity!==null)state.captureRarities.set(id,rarity);
        }
        if (!state.itemsByName.size) return;
        for (const [id, meta] of state.speciesCombat) {
            if (!Array.isArray(meta.rawLoot)) continue;
            const rebuilt = farmRebalanceLoot({
                loot:meta.rawLoot, huntLevel:meta.huntLevel,
                type1:meta.type1
            }, priceOf);
            const value = farmLootValue(rebuilt, priceOf);
            state.npcLootBySpecies.set(id,value);
        }
    }

    function farmApplyRuntimeCatalog(message) {
        const balls = message?.catalogoBolas;
        const items = message?.itensCompraveis;
        if (balls !== undefined) {
            state.ballPrices = farmNormalizePrices(balls, 'ball');
            state.captureBallRates = captureBallCatalog(balls);
        }
        if (items !== undefined) {
            state.itemPrices = farmNormalizePrices(items, 'item');
            if (state.itemsByName.size) rebuildNpcLootCatalog();
        }
    }

    function farmUpdateInventory(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return;
        for (const [name,kind] of [['balls','ball'],['items','item']]) {
            if (!Object.hasOwn(snapshot,name)) continue;
            for (const key of [...state.inventoryForCosts.keys()])
                if (key.startsWith(kind+':')) state.inventoryForCosts.delete(key);
            const source = snapshot[name];
            const entries = Array.isArray(source) ? source.map(x=>
                [x?.id??x?.itemId??x?.ballId, x?.qtd??x?.quantity??x?.count])
                : source && typeof source === 'object' ?
                    Object.entries(source) : [];
            for (const [id,quantity] of entries.slice(0,200)) {
                const n = Number(id), count = farmNum(quantity);
                if (Number.isInteger(n) && count !== null)
                    state.inventoryForCosts.set(kind+':'+n,count);
            }
        }
    }

    function captureTrackReceipt(receipt, at=Date.now()) {
        if(!receipt || !['bola','capturado'].includes(receipt.kind) ||
            !isHuntHere())return;
        const record=performanceRecord(state.currentHuntSlug,true);
        if(!record)return;
        const species=state.farmingLedger.slots.get(receipt.slot)?.speciesId;
        const tracked=receipt.kind==='capturado'?
            {...receipt,confirmedBallId:state.farmingLedger.slots.get(
                receipt.slot)?.ballId??null}:receipt;
        record.captureWindow=captureAppend(record.captureWindow,tracked,at,species);
        if(receipt.kind==='bola' && receipt.chanceRaw!==null){
            const evidence=state.captureChanceEvidence;
            evidence.seen++;
            evidence.min=evidence.min===null?receipt.chanceRaw:
                Math.min(evidence.min,receipt.chanceRaw);
            evidence.max=evidence.max===null?receipt.chanceRaw:
                Math.max(evidence.max,receipt.chanceRaw);
            // No unit inference: fraction vs percentage and boosted vs
            // unboosted remain unverified until native capture UI comparison.
        }
    }

    function captureObservedForHunt(hunt, now=Date.now()) {
        if(!hunt||!isHuntHere(hunt.slug))return null;
        const record=performanceRecord(hunt.slug,false);
        const rates=observedRates(record,now);
        if(!rates)return null;
        return captureObservedWindow(record?.captureWindow,
            now-rates.windowMs,now);
    }

    function captureInfoForBall(id) {
        const standard=CAPTURE_BALLS.find(row=>row.id===id);
        if(!standard)return null;
        const runtime=state.captureBallRates.get(id);
        const catalogPrice=state.ballPrices.get(id);
        const efficiency=runtime?.efficiency??standard.efficiency;
        const priceCoins=id===5?null:
            (runtime?.coins??standard.defaultCoins);
        return {
            ...standard,efficiency,
            coins:priceCoins,diamondPrice:catalogPrice?.diamonds??null,
            source:runtime?.efficiency?
                'observed-client-efficiency+wiki-conditional-formula':
                'wiki-conditional-efficiency',
            priceSource:runtime?.coins!==null&&runtime?.coins!==undefined?
                'observed-client':'wiki-reference',
            stock:state.inventoryForCosts.get('ball:'+id)??null
        };
    }

    function capturePlanForHunt(hunt,ballId=4,xp=huntXpEstimate(hunt)) {
        if(!hunt)return null;
        const ball=captureInfoForBall(ballId);
        if(!ball)return null;
        const observed=captureObservedForHunt(hunt);
        const mixKills=observed?Object.values(observed.bySpecies)
            .reduce((sum,row)=>sum+row.kills,0):0;
        const mixThrows=observed?Object.values(observed.bySpecies)
            .reduce((sum,row)=>sum+row.throws,0):0;
        const measuredMix=observed&&mixThrows===observed.throws &&
            mixThrows>=30 ? observed.bySpecies:null;
        const fraction=observed&&observed.kills>=6 ?
            Math.min(1,Math.max(0,observed.throws/observed.kills)):null;
        const predicted=captureForecast(hunt,state.captureRarities,
            xp?.killsH??null,ball.efficiency,{
                mix:measuredMix,mixMode:'throws',
                acceptedFraction:fraction,
                coinPrice:ball.coins,
                diamondPrice:ball.diamondPrice,
                hypotheticalLure:state.filters.shinyLurePreview
            });
        const selectedBallUses=observed?.byBall?.[ball.id]??0;
        const observedBallH=selectedBallUses>0&&observed?.windowMs>0
            ?selectedBallUses*3600000/observed.windowMs:null;
        const stockHours=observedBallH>0&&ball.stock!==null?
            ball.stock/observedBallH:null;
        return {...predicted,ball,observed,
            stockHours,rateSource:xp?.observed?'observed-kills':
                xp?.source??'unknown'};
    }

    function capturePlanForSpecies(species,ballId=4,xp=null) {
        if(!species?.hunt)return null;
        const hunt=species.hunt;
        const estimate=xp??huntXpEstimate(hunt);
        const ball=captureInfoForBall(ballId);
        if(!ball)return null;
        const observed=captureObservedForHunt(hunt);
        const mixKills=observed?Object.values(observed.bySpecies)
            .reduce((sum,row)=>sum+row.kills,0):0;
        const mix=observed&&mixKills===observed.kills &&
            mixKills>=30?observed.bySpecies:null;
        const target=observed?.bySpecies?.[
            outlandNormalizeSpeciesId(species.id)];
        const acceptance=target?.kills>=6?
            Math.min(1,target.throws/target.kills):
            observed?Math.min(1,observed.throws/Math.max(1,observed.kills)):null;
        return captureSpeciesForecast(hunt,species.id,
            state.captureRarities.get(Number(outlandNormalizeSpeciesId(species.id))),
            ball.efficiency,estimate?.killsH??null,{
                mix,acceptedFraction:acceptance,
                hypotheticalLure:state.filters.shinyLurePreview
            });
    }

    function farmTrackUse(receipt, at=Date.now()) {
        if (!receipt || !['bola','cura','revive'].includes(receipt.kind) ||
            !isHuntHere()) return;
        const record = performanceRecord(state.currentHuntSlug,true);
        if (!record) return;
        record.rateUseWindow = farmAppendUse(record.rateUseWindow,receipt,at);
    }

    function rareObservedFor(id, eligible=true) {
        return eligible ? (state.farmingLedger.items.get(id) ?? 0) : null;
    }
    function rareOutlandHunt() {
        return state.hunts.find(hunt=>String(hunt?.area).toLowerCase()==='outland'
            && isUnlocked(hunt)) || null;
    }
    function rareModelForHunt(hunt, tier) {
        const xp=hunt ? huntXpEstimate(hunt):null;
        const rate=Number.isFinite(xp?.killsH)?xp.killsH:null;
        const model=rareForHunt(hunt,tier,state.playerLevel,rate);
        const actualHere=isHuntHere(hunt?.slug);
        const tierActive=state.outlandTierSeen &&
            state.farmingSnapshot.outlandTier!==null &&
            outlandNativeTier(state.farmingSnapshot.outlandTier,
                state.playerLevel)===tier;
        return {...model,killsH:rate,
            rateSource:xp?.observed?'observed-wall-clock':
                xp?.source??'unknown',
            observedAvailable:actualHere && (String(hunt?.area).toLowerCase()!=='outland'
                || tierActive),
            observedDrops:actualHere && (String(hunt?.area).toLowerCase()!=='outland'
                || tierActive) ? Object.fromEntries(model.drops.map(row=>[
                    row.id,rareObservedFor(row.id)
                ])):null};
    }

    function requestOutlandTier(tier) {
        // shared/outland-tiers.mjs confirms "outland.tier" exists. This
        // message is not evidence of SUCCESS; only an authoritative estate
        // snapshot with the selected tier may confirm it.
        const requested=Number(tier);
        if(!state.outlandTierSeen ||
            !farmingTier(requested,state.playerLevel) ||
            state.pendingOutlandTier || !socketReady() ||
            state.farmingSnapshot.outlandTier===requested)
            return false;
        try{
            state.activeSocket.send(JSON.stringify({t:'outland.tier',tier:requested}));
            const sentAt=Date.now();
            state.pendingOutlandTier={tier:requested,sentAt};
            setTimeout(()=>{
                if(state.pendingOutlandTier?.sentAt===sentAt){
                    state.pendingOutlandTier=null;
                    queueRender();
                }
            },6000);
            queueRender();
            return true;
        }catch{
            state.pendingOutlandTier=null;
            return false;
        }
    }

    function huntEconomyEstimate(hunt, xp = huntXpEstimate(hunt)) {
        const killsH = Number.isFinite(xp?.killsH) ? xp.killsH : null;
        const modelKillGoldH = farmGoldPrediction(hunt,killsH);
        const loot = farmLootPrediction(hunt,state.npcLootBySpecies,killsH);
        const current = isHuntHere(hunt?.slug);
        const record = current ? performanceRecord(hunt?.slug,false) : null;
        const rates = current ? observedRates(record) : null;
        const now = Date.now();
        const measuredStart = rates ? now-rates.windowMs : null;
        const costs = measuredStart !== null
            ? farmCostRates(record?.rateUseWindow, measuredStart, now,
                {balls:state.ballPrices,items:state.itemPrices},
                state.inventoryForCosts) : null;
        // Missing/unlinked accepted throw events mean the consumed-ball
        // cost ledger may be incomplete; do not publish an inflated net.
        const uncertainCosts=state.farmingLedger.diagnostics.uncertainCosts || 0;
        if (costs && uncertainCosts) costs.coinsH=null;
        const summary = farmFinancialSummary(killsH,modelKillGoldH,
            rates?.killGoldH ?? null,rates?.autoSaleH ?? null,
            loot.perHour,costs);
        return {...summary, lootCoverage:loot.coverage,
            lootSource:loot.source,
            sampleCount:rates?.samples??0,
            windowMs:rates?.windowMs??null,
            useEvidence:(costs?.items??[]).map(entry=>{
                const hours=rates?.windowMs / 3600000;
                const perHour=hours>0 ? entry.count/hours : null;
                return {...entry,perHour,
                    hoursRemaining:perHour>0 &&
                        entry.remaining!==null ? entry.remaining/perHour : null};
            }),
            unknownCosts:costs?.unknown??null,
            unlinkedCosts:uncertainCosts,
            unboosted:!xp?.observed};
    }

    function ensureCombatCatalog() {
        if (
            state.combatCatalogStatus ===
                'ready'
        ) {
            return Promise.resolve();
        }

        if (
            state.combatCatalogPromise
        ) {
            return state.combatCatalogPromise;
        }

        state.combatCatalogStatus =
            'loading';

        const load =
            url =>
                fetch(
                    url,
                    {
                        cache:
                            'force-cache',
                        credentials:
                            'same-origin'
                    }
                )
                    .then(
                        response => {
                            if (
                                !response.ok
                            ) {
                                throw new Error(
                                    'HTTP ' +
                                    response.status
                                );
                            }

                            return response.json();
                        }
                    );

        state.combatCatalogPromise =
            Promise.all([
                load(
                    '/assets/creatures.json'
                ),
                load(
                    '/assets/creatures-novos.json'
                ).catch(
                    () => null
                ),
                load(
                    '/assets/creatures-outland-novos.json'
                ).catch(
                    () => null
                ),
                load(
                    '/assets/creatures-audit-overrides.json'
                ).catch(
                    () => null
                ),
                load('/assets/items.json').catch(() => null)
            ])
                .then(
                    ([
                        base,
                        novos,
                        outland,
                        audit,
                        items
                    ]) => {
                        for (
                            const data of [
                                base,
                                novos,
                                outland
                            ]
                        ) {
                            for (
                                const creature of
                                data?.creatures ||
                                []
                            ) {
                                mergeCombatCreature(
                                    creature
                                );
                            }
                        }

                        for (
                            const override of
                            audit?.overrides ||
                            []
                        ) {
                            mergeCombatCreature(
                                override
                            );
                        }

                        state.itemsByName.clear();
                        state.itemsById.clear();
                        if (Array.isArray(items?.items)) {
                            for (const item of items.items) {
                                const id = Number(item?.id);
                                if (!Number.isInteger(id) || !item.name) continue;
                                state.itemsById.set(id, item);
                                state.itemsByName.set(String(item.name).toLowerCase(), item);
                            }
                            state.itemCatalogStatus = 'raw-upstream-catalog';
                        } else state.itemCatalogStatus = 'unknown';
                        rebuildNpcLootCatalog();

                        state.combatCatalogStatus =
                            'ready';

                        state.combatRevision++;
                        state.combatProfileCache =
                            null;

                        queueRender();
                    }
                )
                .catch(
                    error => {
                        state.combatCatalogStatus =
                            'error';

                        console.warn(
                            '[PokéIdle Hunt Atlas] combat catalog failed',
                            error
                        );
                    }
                )
                .finally(
                    () => {
                        state.combatCatalogPromise =
                            null;
                    }
                );

        return state.combatCatalogPromise;
    }

    function typeMultiplierExact(
        attackType,
        defenderType
    ) {
        const attack =
            String(
                attackType ||
                ''
            ).toUpperCase();

        const defender =
            String(
                defenderType ||
                ''
            ).toUpperCase();

        if (
            !attack ||
            !defender
        ) {
            return 1;
        }

        const chart =
            state.serverTypeChart ||
            TYPE_CHART;

        const row =
            chart[attack] ||
            TYPE_CHART[
                attack
            ] ||
            {};

        if (
            attack ===
                defender &&
            row[defender] ==
                null
        ) {
            if (
                attack ===
                    'GHOST' ||
                attack ===
                    'DRAGON'
            ) {
                return 2;
            }

            if (
                attack ===
                    'NORMAL' ||
                attack ===
                    'GROUND' ||
                attack ===
                    'FLYING'
            ) {
                return 1;
            }

            return 0.5;
        }

        if (
            row[
                defender
            ] != null
        ) {
            const value =
                Number(
                    row[
                        defender
                    ]
                );

            return Number.isFinite(
                value
            )
                ? value
                : 1;
        }

        return 1;
    }

    function exactEffectiveness(
        attackType,
        defenderTypes
    ) {
        let value = 1;

        for (
            const defender of
            defenderTypes ||
            []
        ) {
            value *=
                typeMultiplierExact(
                    attackType,
                    defender
                );
        }

        return value;
    }

    function normalizedTypes(
        values
    ) {
        return [
            ...new Set(
                (
                    Array.isArray(values)
                        ? values
                        : []
                )
                    .map(
                        type =>
                            String(
                                type || ''
                            ).toUpperCase()
                    )
                    .filter(
                        type =>
                            STANDARD_TYPES.includes(
                                type
                            )
                    )
            )
        ];
    }

    function leadDefenderTypes() {
        const lead =
            leadPokemon();

        if (!lead) {
            return [];
        }

        const direct =
            normalizedTypes(
                lead.tipos
            );

        if (direct.length) {
            return direct;
        }

        return normalizedTypes(
            state.typesBySpecies.get(
                Number(
                    lead.speciesId
                )
            )
        );
    }

    function leadAttackTypesForMatchup() {
        const observed = normalizedTypes(combatProfile()?.moveTypes || []);
        if (observed.length) return observed;

        const indexed = movesForLead();
        if (indexed.length) {
            const candidates = normalizedTypes(indexed
                .filter(move => move.power > 0 && move.category !== 'STATUS')
                .map(move => move.type));
            if (candidates.length) return candidates;
        }
        return leadDefenderTypes();
    }

    function bestEffectivenessAgainst(
        attackTypes,
        defenderTypes
    ) {
        const attacks =
            normalizedTypes(
                attackTypes
            );

        const defenders =
            normalizedTypes(
                defenderTypes
            );

        if (
            !attacks.length ||
            !defenders.length
        ) {
            return null;
        }

        let best = null;

        for (const attackType of attacks) {
            const multiplier =
                exactEffectiveness(
                    attackType,
                    defenders
                );

            if (
                !best ||
                multiplier >
                    best.multiplier
            ) {
                best = {
                    attackType,
                    multiplier
                };
            }
        }

        return best;
    }

    function matchupRelation(
        multiplier
    ) {
        if (
            multiplier === null ||
            multiplier === undefined ||
            !Number.isFinite(
                Number(
                    multiplier
                )
            )
        ) {
            return {
                key: 'unknown',
                label: '?'
            };
        }

        const value =
            Number(
                multiplier
            );

        if (value === 0) {
            return {
                key: 'immune',
                label:
                    tr(
                        'matchup.immune'
                    )
            };
        }

        if (value > 1) {
            return {
                key: 'weak',
                label:
                    tr(
                        'matchup.weak'
                    )
            };
        }

        if (value < 1) {
            return {
                key: 'resist',
                label:
                    tr(
                        'matchup.resists'
                    )
            };
        }

        return {
            key: 'neutral',
            label:
                tr(
                    'matchup.neutral'
                )
        };
    }

    function formatMultiplier(
        value
    ) {
        const number =
            Number(
                value
            );

        if (!Number.isFinite(number)) {
            return '×?';
        }

        return (
            '×' +
            (
                Number.isInteger(number)
                    ? String(number)
                    : String(
                        Math.round(
                            number * 100
                        ) / 100
                    )
            )
        );
    }

    function speciesMatchup(
        species
    ) {
        const lead =
            leadPokemon();

        if (!lead) {
            return null;
        }

        const targetTypes =
            normalizedTypes(
                species?.types
            );

        const leadDefense =
            leadDefenderTypes();

        if (
            !targetTypes.length ||
            !leadDefense.length
        ) {
            return null;
        }

        const leadAttackTypes =
            leadAttackTypesForMatchup();

        const offense =
            bestEffectivenessAgainst(
                leadAttackTypes,
                targetTypes
            );

        /*
         * PokéIdle's own Hunt Analyser treats a wild Pokémon's own types as
         * its STAB attack types for matchup analysis. Mirror that rule here.
         */
        const defense =
            bestEffectivenessAgainst(
                targetTypes,
                leadDefense
            );

        return {
            lead,
            targetTypes,
            leadDefense,
            offense,
            defense
        };
    }

    function matchupBadgeMarkup(
        direction,
        result,
        leadName,
        speciesName
    ) {
        if (!result) {
            return '';
        }

        const relation =
            matchupRelation(
                result.multiplier
            );

        const multiplier =
            formatMultiplier(
                result.multiplier
            );

        const isDeal =
            direction === 'deal';

        const label =
            tr(
                isDeal
                    ? 'matchup.deal'
                    : 'matchup.take',
                {
                    multiplier,
                    relation:
                        relation.label
                }
            );

        const title =
            tr(
                isDeal
                    ? 'matchup.dealTitle'
                    : 'matchup.takeTitle',
                {
                    lead:
                        leadName,
                    species:
                        speciesName,
                    type:
                        typeLabel(
                            result.attackType
                        ),
                    multiplier
                }
            );

        const favorability =
            isDeal
                ? result.multiplier > 1
                    ? 'good'
                    : result.multiplier < 1
                        ? 'bad'
                        : 'neutral'
                : result.multiplier > 1
                    ? 'bad'
                    : result.multiplier < 1
                        ? 'good'
                        : 'neutral';

        return `
            <span
                class="mha-matchup ${favorability} ${relation.key}"
                title="${escapeHtml(title)}"
            >${escapeHtml(label)}</span>
        `;
    }

    function huntEffectiveness(
        attackType,
        defenderTypes
    ) {
        const raw =
            exactEffectiveness(
                attackType,
                defenderTypes
            );

        if (
            raw === 0 ||
            raw === 1
        ) {
            return raw;
        }

        const factor =
            Number(
                state.huntAmplification
            ) ||
            1.5;

        return raw > 1
            ? 1 +
                (
                    raw - 1
                ) *
                    factor
            : raw /
                factor;
    }

    // ------------------------------------------------------------------
    // XP/hour model — real combat first, prediction second
    // ------------------------------------------------------------------

    const UPSTREAM_WAVE_MS =
        2600;

    const UPSTREAM_GLOBAL_ATTACK_MS =
        900;

    const UPSTREAM_FALLBACK_MOVE_MS =
        600;

    function attackerTypes() {
        const profile =
            combatProfile();

        if (
            profile &&
            profile.moveTypes.length
        ) {
            return profile.moveTypes;
        }

        const candidates = movesForLead()
            .filter(move => move.power > 0 && move.category !== 'STATUS')
            .map(move => move.type);
        if (candidates.length) return normalizedTypes(candidates);

        return (
            leadPokemon()
                ?.tipos ||
            []
        )
            .map(
                type =>
                    String(type)
                        .toUpperCase()
            );
    }

    function huntMatchupFactor(
        hunt
    ) {
        const attackTypes =
            attackerTypes();

        if (
            !attackTypes.length ||
            !Array.isArray(
                hunt?.especies
            )
        ) {
            return 1;
        }

        let totalWeight = 0;
        let weighted = 0;

        for (
            const species of
            hunt.especies
        ) {
            const weight =
                Math.max(
                    1,
                    Number(
                        species?.pontos ||
                        1
                    )
                );

            const defenderTypes =
                state.typesBySpecies.get(
                    Number(
                        species?.pokeId
                    )
                ) ||
                [];

            const best =
                defenderTypes.length
                    ? Math.max(
                        ...attackTypes.map(
                            attackType =>
                                huntEffectiveness(
                                    attackType,
                                    defenderTypes
                                )
                        )
                    )
                    : 1;

            weighted +=
                weight *
                Math.max(
                    0.01,
                    best
                );

            totalWeight +=
                weight;
        }

        return totalWeight
            ? weighted /
                totalWeight
            : 1;
    }

    function recordsForLead() {
        const signature =
            leadSignature();

        if (!signature) {
            return [];
        }

        return [
            ...state.huntPerf.values()
        ].filter(
            record =>
                record?.version ===
                    5 &&
                record.rateGeneration === state.rateGeneration &&
                record.sessionToken === state.farmingSessionToken &&
                record.snapshotScope === farmingSnapshotScope() &&
                record.signature ===
                    signature
        );
    }

    function profileRecordsForLead() {
        const exact =
            recordsForLead();

        const exactAttacks =
            exact.reduce(
                (sum, record) =>
                    sum +
                    Number(
                        record.attacks ||
                        0
                    ),
                0
            );

        const exactHp =
            exact.reduce(
                (sum, record) =>
                    sum +
                    (
                        record.hpSamples
                            ?.length ||
                        0
                    ),
                0
            );

        /*
         * Once the current level has enough direct combat data, it stands
         * alone. Before that, blend the nearest previous level so a level-up
         * does not blank the Atlas for the first few attacks.
         */
        if (
            exact.length &&
            exactAttacks >= 6 &&
            exactHp >= 1
        ) {
            return {
                records: exact,
                warmStart: false
            };
        }

        const pokemon =
            leadPokemon();

        const loadout =
            leadLoadoutSignature(
                pokemon
            );

        if (!loadout) {
            return {
                records: exact,
                warmStart:
                    false
            };
        }

        const currentSignature =
            leadSignature(
                pokemon
            );

        const compatible =
            [...state.huntPerf.values()]
                .filter(
                    record =>
                        record?.version ===
                            5 &&
                        record.rateGeneration === state.rateGeneration &&
                        record.sessionToken === state.farmingSessionToken &&
                        record.snapshotScope === farmingSnapshotScope() &&
                        record.loadoutSignature ===
                            loadout &&
                        record.signature !==
                            currentSignature &&
                        Number(
                            record.attacks ||
                            0
                        ) > 0
                );

        if (!compatible.length) {
            return {
                records: exact,
                warmStart: false
            };
        }

        const currentLevel =
            Number(
                pokemon?.level ||
                0
            );

        const nearestDistance =
            Math.min(
                ...compatible.map(
                    record =>
                        Math.abs(
                            Number(
                                record.pokemonLevel ||
                                0
                            ) -
                            currentLevel
                        )
                )
            );

        const nearest =
            compatible.filter(
                record =>
                    Math.abs(
                        Number(
                            record.pokemonLevel ||
                            0
                        ) -
                        currentLevel
                    ) ===
                    nearestDistance
            );

        return {
            records: [
                ...exact,
                ...nearest
            ],
            warmStart: true
        };
    }
    function observedRates(record, now = Date.now()) {
        if (!record || record.rateGeneration !== state.rateGeneration ||
            record.sessionToken !== state.farmingSessionToken ||
            record.snapshotScope !== farmingSnapshotScope()) return null;
        return farmingObservedRates(record.rateWindow, now);
    }

    function combatProfile() {
        const cacheKey =
            [
                leadSignature() ||
                    '',
                state.combatRevision,
                state.combatCatalogStatus,
                farmingSnapshotScope()
            ].join('|');

        if (
            state.combatProfileCache
                ?.key ===
            cacheKey
        ) {
            return state.combatProfileCache
                .value;
        }

        const recordSelection =
            profileRecordsForLead();

        const records =
            recordSelection.records;

        if (!records.length) {
            return null;
        }

        const warmStart =
            recordSelection.warmStart;

        const currentPower =
            Math.max(
                1,
                pokemonPower(
                    leadPokemon()
                )
            );

        const sameTarget = [];
        const transitions = [];
        const allAttacks = [];
        const hpSamples = [];
        const trainerMult = [];
        const pokemonMult = [];

        const moves = {};
        const attackObservations = [];

        let attacks = 0;
        let kills = 0;

        for (
            const record of
            records
        ) {
            sameTarget.push(
                ...(
                    record.sameTargetIntervals ||
                    []
                )
            );

            transitions.push(
                ...(
                    record.transitionIntervals ||
                    []
                )
            );

            allAttacks.push(
                ...(
                    record.allAttackIntervals ||
                    []
                )
            );

            hpSamples.push(
                ...(
                    record.hpSamples ||
                    []
                )
            );

            trainerMult.push(
                ...(
                    record.trainerXpMultSamples ||
                    []
                ).slice(-12)
            );

            pokemonMult.push(
                ...(
                    record.pokemonXpMultSamples ||
                    []
                ).slice(-12)
            );

            attacks +=
                Number(
                    record.attacks ||
                    0
                );

            kills +=
                Number(
                    record.kills ||
                    0
                );

            const scale = warmStart
                ? currentPower / Math.max(1, Number(record.pokemonPower || currentPower))
                : 1;
            for (const row of (record.attackObservations || []).slice(-160)) {
                const damage = Number(row?.neutralDamage) * scale;
                if (!(damage > 0) || !Number.isFinite(damage) ||
                    typeof row.type !== 'string') continue;
                attackObservations.push({
                    name: typeof row.name === 'string' ? row.name : null,
                    type: row.type, neutralDamage: damage,
                    at: Number(row.at) || 0
                });
            }

            for (
                const [
                    type,
                    sample
                ] of
                Object.entries(
                    record.moveDamage ||
                    {}
                )
            ) {
                const bucket =
                    moves[
                        type
                    ] || {
                        samples: []
                    };

                const powerScale =
                    warmStart
                        ? currentPower /
                            Math.max(
                                1,
                                Number(
                                    record.pokemonPower ||
                                    currentPower
                                )
                            )
                        : 1;

                bucket.samples.push(
                    ...(
                        sample
                            ?.neutralSamples ||
                        []
                    )
                        .slice(-50)
                        .map(
                            damage =>
                                Number(
                                    damage
                                ) *
                                powerScale
                        )
                );

                if (
                    bucket.samples.length >
                    100
                ) {
                    bucket.samples.splice(
                        0,
                        bucket.samples.length -
                            100
                    );
                }

                moves[
                    type
                ] =
                    bucket;
            }
        }

        const cadenceMeasured =
            robustMean(
                sameTarget
            );

        const cadenceThroughput =
            robustMean(
                allAttacks
            );

        const cadenceMs =
            cadenceMeasured ||
            cadenceThroughput ||
            UPSTREAM_GLOBAL_ATTACK_MS;

        let movementMs =
            null;

        const cleanTransitions =
            transitions
                .map(Number)
                .filter(
                    value =>
                        Number.isFinite(
                            value
                        ) &&
                        value >= 100
                )
                .sort(
                    (a, b) =>
                        a - b
                );

        if (
            cleanTransitions.length
        ) {
            /*
             * Long transition gaps include the fixed 2.6 s wave pause.
             * The lower 60% isolates ordinary travel/pathfinding.
             */
            const take =
                Math.max(
                    1,
                    Math.ceil(
                        cleanTransitions.length *
                        0.6
                    )
                );

            movementMs =
                robustMean(
                    cleanTransitions.slice(
                        0,
                        take
                    )
                );
        }

        if (!movementMs) {
            movementMs =
                UPSTREAM_FALLBACK_MOVE_MS;
        }

        const hpScaleSamples = [];
        const hpPerLevelSamples = [];

        for (
            const sample of
            hpSamples
        ) {
            const level =
                Number(
                    sample?.level
                );

            const maxHp =
                Number(
                    sample?.maxHp
                );

            if (
                !Number.isFinite(
                    level
                ) ||
                level <= 0 ||
                !Number.isFinite(
                    maxHp
                ) ||
                maxHp <= 0
            ) {
                continue;
            }

            hpPerLevelSamples.push(
                maxHp /
                level
            );

            const meta =
                speciesCombatMeta(
                    sample?.speciesId
                );

            const baseHp =
                Number(
                    meta?.baseHp
                );

            if (
                Number.isFinite(
                    baseHp
                ) &&
                baseHp > 0
            ) {
                hpScaleSamples.push(
                    maxHp /
                    (
                        baseHp *
                        level
                    )
                );
            }
        }

        const moveDamage = {};
        let moveSamples = 0;

        for (
            const [
                type,
                bucket
            ] of
            Object.entries(
                moves
            )
        ) {
            const damage =
                robustMean(
                    bucket.samples
                );

            if (
                !damage ||
                damage <= 0
            ) {
                continue;
            }

            moveDamage[
                type
            ] = {
                damage,
                samples:
                    bucket.samples.length
            };

            moveSamples +=
                bucket.samples.length;
        }

        const byName = new Map();
        for (const row of attackObservations) {
            if (!row.name) continue;
            const key = moveNameKey(row.name);
            const aggregate = byName.get(key) || {
                name: row.name, type: row.type, samples: []
            };
            if (aggregate.type !== row.type) continue;
            aggregate.samples.push(row.neutralDamage);
            byName.set(key, aggregate);
        }
        const observedNamedMoves = Object.create(null);
        for (const [key, row] of byName) {
            observedNamedMoves[key] = {
                name: row.name, type: row.type,
                neutralDamage: robustMean(row.samples) || 0,
                samples: row.samples.length
            };
        }
        const namedMoveSamples = [...byName.values()]
            .reduce((sum, row) => sum + row.samples.length, 0);

        const value = {
            records,
            warmStart,
            observedNamedMoves,
            namedMoveSamples,
            attackObservations: attackObservations.slice(-1100),
            attacks,
            kills,
            cadenceMs,
            cadenceMeasured:
                Boolean(
                    cadenceMeasured
                ),
            cadenceFromThroughput:
                !cadenceMeasured &&
                Boolean(
                    cadenceThroughput
                ),
            movementMs,
            movementMeasured:
                cleanTransitions.length >
                0,
            hpScale:
                median(
                    hpScaleSamples
                ),
            hpPerLevel:
                median(
                    hpPerLevelSamples
                ),
            hpSamples:
                hpSamples.length,
            moveDamage,
            moveTypes:
                Object.keys(
                    moveDamage
                ),
            moveSamples,
            trainerXpMult:
                robustMean(
                    trainerMult
                ) ||
                1,
            pokemonXpMult:
                robustMean(
                    pokemonMult
                ) ||
                1
        };

        state.combatProfileCache = {
            key: cacheKey,
            value
        };

        return value;
    }
    function targetHpEstimate(
        speciesId,
        huntLevel,
        profile
    ) {
        const level =
            Math.max(
                1,
                Number(
                    huntLevel
                ) ||
                1
            );

        const meta =
            speciesCombatMeta(
                speciesId
            );

        const baseHp =
            Number(
                meta?.baseHp
            );

        if (
            profile?.hpScale &&
            Number.isFinite(
                baseHp
            ) &&
            baseHp > 0
        ) {
            return (
                baseHp *
                level *
                profile.hpScale
            );
        }

        if (
            profile?.hpPerLevel
        ) {
            return (
                level *
                profile.hpPerLevel
            );
        }

        return null;
    }


    // Forecasts individual observed attacks with index-assisted smoothing.
    // Never assume a LEARNABLE index move was equipped or fired. Missing
    // events use the old per-type estimator unchanged.

    // Confidence describes how much of ACTUAL battle traffic identifies its
    // move. It does not pretend the public index proves the active loadout.
    // One confirmed move is enough; Pokémon are not forced to use two.
    function moveModelConfidence(profile) {
        const observations = (profile?.attackObservations || [])
            .filter(row => Number(row.neutralDamage) > 0);
        const named = observations.filter(row => typeof row.name === 'string' &&
            row.name.length > 0);
        if (named.length >= 16 && named.length / observations.length >= 0.6)
            return 'high';
        if (named.length >= 5 && named.length / observations.length >= 0.3)
            return 'medium';
        return 'low';
    }

    function damagePerAttackAgainst(speciesId, profile) {
        const defender = speciesCombatMeta(speciesId);
        const types = (state.typesBySpecies.get(Number(speciesId)) ||
            [defender?.type1, defender?.type2].filter(Boolean))
            .map(type => String(type).toUpperCase());
        const effectiveness = type => types.length
            ? huntEffectiveness(type, types) : 1;

        // Historical records before v1.9 do not contain per-cast samples.
        const legacyTypeDamage = () => {
            let weighted = 0, count = 0;
            for (const [type, row] of Object.entries(profile?.moveDamage || {})) {
                const samples = Math.max(1, Number(row.samples) || 1);
                weighted += samples * (Number(row.damage) || 0) *
                    effectiveness(type);
                count += samples;
            }
            return count ? weighted / count : null;
        };

        const samples = (profile?.attackObservations || [])
            .filter(row => Number(row.neutralDamage) > 0 &&
                Number.isFinite(Number(row.neutralDamage)) &&
                typeof row.type === 'string')
            .slice(-1100);
        if (!samples.length) return legacyTypeDamage();

        // Unlike the earlier implementation, named and unnamed observations
        // are from ONE stream, so an attack is never counted twice.
        const recognized = movesForLead();
        const byName = new Map(recognized.map(move =>
            [moveNameKey(move.name), move]));
        const groups = new Map();
        for (const row of samples) {
            if (!row.name) continue;
            const move = byName.get(moveNameKey(row.name));
            if (!move || move.type !== row.type || !(move.power > 0)) continue;
            const key = move.type + ':' + move.category;
            const g = groups.get(key) || { sum: 0, n: 0 };
            g.sum += row.neutralDamage / move.power;
            g.n++;
            groups.set(key, g);
        }

        const namedSamples = samples.filter(row => row.name).length;
        // A weak 5% prior can improve a sparse named sample using the
        // species-specific power, but cannot override observed damage.
        const canSmooth = moveModelConfidence(profile) !== 'low' &&
            namedSamples >= 5;
        let total = 0;
        for (const row of samples) {
            let neutral = Number(row.neutralDamage);
            const move = row.name ? byName.get(moveNameKey(row.name)) : null;
            const group = move && groups.get(move.type + ':' + move.category);
            if (canSmooth && move?.type === row.type &&
                move.power > 0 && group?.n >= 6) {
                const observedForMove = Number(
                    profile?.observedNamedMoves?.[moveNameKey(row.name)]?.samples
                ) || 0;
                if (observedForMove < 4) {
                    const prior = group.sum / group.n * move.power;
                    // Bound to ±5% even when the index is badly outdated.
                    const bounded = Math.max(neutral * 0.95,
                        Math.min(neutral * 1.05, prior));
                    neutral = neutral * 0.92 + bounded * 0.08;
                }
            }
            total += neutral * effectiveness(row.type);
        }
        return total / samples.length;
    }

    // Coverage is spawn-weighted. An unknown high-frequency enemy cannot
    // vanish from the denominator of an XP/h prediction.
    function huntCombatCoverage(hunt, profile) {
        const species = Array.isArray(hunt?.especies) ? hunt.especies : [];
        const entries = species.map(row => {
            const weight = Math.max(1, Number(row?.pontos || 1));
            const hp = profile
                ? targetHpEstimate(row?.pokeId, hunt.nivel, profile) : null;
            const damage = profile
                ? damagePerAttackAgainst(row?.pokeId, profile) : null;
            const hpKnown = Number.isFinite(hp) && hp > 0;
            const damageKnown = Number.isFinite(damage) && damage >= 0;
            return { row, weight, hp, damage, hpKnown, damageKnown };
        });
        const total = entries.reduce((sum, row) => sum + row.weight, 0);
        const covered = entries.reduce((sum, row) =>
            sum + (row.hpKnown && row.damageKnown ? row.weight : 0), 0);
        return {
            entries, total, covered,
            percentage: total ? Math.round(100 * covered / total) : 0,
            complete: total > 0 && covered === total,
            missingHp: entries.filter(row => !row.hpKnown).reduce(
                (sum, row) => sum + row.weight, 0),
            missingDamage: entries.filter(row => !row.damageKnown).reduce(
                (sum, row) => sum + row.weight, 0),
            blocked: entries.some(row =>
                row.hpKnown && row.damageKnown && row.damage === 0)
        };
    }

    function rawPredictedKillMs(hunt, profile) {
        if (!hunt || !profile || !profile.moveSamples ||
            (!profile.hpScale && !profile.hpPerLevel)) return null;
        const coverage = huntCombatCoverage(hunt, profile);
        // Preserve the existing known-immunity protection.
        if (coverage.blocked) return Infinity;
        // Missing enemies may be slower than covered ones; do not
        // renormalize their weights into an optimistic personalized model.
        if (!coverage.complete) return null;

        const mobsPerWave = Math.max(1, Math.min(16, coverage.total));
        const lead = typeof leadPokemon === 'function' ? leadPokemon() : null;
        const iv = lead?.speedIV ?? lead?.speedIv ??
            lead?.ivs?.speed ?? lead?.iv?.speed;
        const firstAttackMs = typeof xpGlobalAttackFloor === 'function'
            ? xpGlobalAttackFloor(iv) : UPSTREAM_GLOBAL_ATTACK_MS;
        const transitionMs =
            (Number(profile.movementMs) || 600) + UPSTREAM_WAVE_MS / mobsPerWave;
        let weightedMs = 0;
        for (const row of coverage.entries) {
            const attacksNeeded = Math.max(1, Math.ceil(row.hp / row.damage));
            const killMs = transitionMs + firstAttackMs +
                Math.max(0, attacksNeeded - 1) *
                Math.max(firstAttackMs,
                    Number(profile.cadenceMs) || UPSTREAM_GLOBAL_ATTACK_MS);
            weightedMs += killMs * row.weight;
        }
        return weightedMs / coverage.total;
    }

    // Validation is out-of-sample: freeze an early model estimate BEFORE
    // sustained kills are available, then compare with later actual results.
    function calibrationContextKey() {
        const lead = leadSignature();
        return lead ? lead + '|' + farmingSnapshotScope() : null;
    }

    function recordForecastResidual(hunt, record, observed, now = Date.now()) {
        const prediction = record?.predictedBeforeMeasurement;
        if (!hunt || !prediction || !observed || !(observed.samples >= 6) ||
            observed.windowMs < 60000 ||
            prediction.hunt !== hunt.slug || prediction.scope !== farmingSnapshotScope())
            return null;
        const residual = xpForecastResidual(prediction.killMs, observed.killMs);
        if (!residual) return null;
        const key = calibrationContextKey();
        if (!key) return null;
        let cases = state.calibrationEvidence.get(key);
        if (!cases) {
            cases = new Map();
            state.calibrationEvidence.set(key, cases);
        }
        const previous = cases.get(hunt.slug);
        if (!previous || now - previous.at >= 60000) {
            cases.set(hunt.slug, {ratio: residual.ratio, errorPct: residual.errorPct,
                at: now, samples: observed.samples, source: prediction.source});
            while (cases.size > 12) cases.delete(cases.keys().next().value);
            while (state.calibrationEvidence.size > 4)
                state.calibrationEvidence.delete(state.calibrationEvidence.keys().next().value);
            state.estimateCache.clear();
            // This mutation is deliberately outside the per-kill handler to
            // avoid costly recomputation on every high-frequency battle event.
        }
        return residual;
    }

    function predictionCalibration(profile) {
        const key = calibrationContextKey();
        const cases = key ? state.calibrationEvidence.get(key) : null;
        const ratios = cases ? [...cases.values()].filter(row =>
            Date.now() - row.at < 90 * 60000 && row.samples >= 6)
                .map(row => row.ratio) : [];
        const ratio = robustMean(ratios);
        return ratio && ratios.length
            ? Math.max(.65, Math.min(1.65, ratio)) : 1;
    }

    function calibrationDiagnostics() {
        const key = calibrationContextKey();
        const cases = key ? state.calibrationEvidence.get(key) : null;
        const values = cases ? [...cases.values()].filter(row =>
            Date.now() - row.at < 90 * 60000) : [];
        return {
            hunts: values.length,
            medianErrorPct: values.length
                ? Math.round(median(values.map(row => Math.abs(row.errorPct))))
                : null,
            source: 'personalized-model-validation',
            // Transferring between hunts is an experimental heuristic.
            confidence: values.length >= 3 ? 'medium' : 'low'
        };
    }

    function huntXpEstimate(
        hunt
    ) {
        const cacheKey =
            [
                leadSignature() ||
                    '',
                state.combatRevision,
                state.combatCatalogStatus,
                farmingSnapshotScope()
            ].join('|');

        if (
            state.estimateCacheKey !==
            cacheKey
        ) {
            state.estimateCacheKey =
                cacheKey;

            state.estimateCache.clear();
        }

        const huntKey =
            hunt?.slug ||
            '';

        const record =
            performanceRecord(
                hunt?.slug,
                false
            );

        const observed =
            observedRates(
                record
            );

        /*
         * Always check the live measurement before using a cached model.
         * Measurements evolve during a hunt and must take precedence.
         */
        if (observed && observed.trainerXpH !== null) {
            const residual = recordForecastResidual(hunt, record, observed);
            const result = {
                value:
                    observed.trainerXpH,
                pokemonValue: observed.pokemonXpH,
                killGoldH: observed.killGoldH,
                autoSaleH: observed.autoSaleH,
                trainerKnown: observed.trainerKnown,
                pokemonKnown: observed.pokemonKnown,
                goldValue:
                    observed.goldH,
                goldSource: 'observed-server/combined-receipt',
                killsH:
                    observed.killsH,
                killMs:
                    observed.killMs,
                observed:
                    true,
                source:
                    'measured',
                confidence: observed.confidence,
                samples: observed.samples,
                windowMs: observed.windowMs,
                denominator: observed.denominator,
                bonusSource: 'observed-server/event',
                residualErrorPct: residual?.errorPct ?? null,
                fallbackReason: null,
                range: xpPredictionBand({value: observed.trainerXpH,
                    observed: true, samples: observed.samples,
                    windowMs: observed.windowMs})
            };
            return result;
        }

        if (
            huntKey &&
            state.estimateCache.has(
                huntKey
            )
        ) {
            return state.estimateCache.get(
                huntKey
            );
        }

        const remember =
            value => {
                /*
                 * Never cache a missing estimate. The combat profile may
                 * become usable on a later render without changing its key.
                 */
                if (
                    huntKey &&
                    Number(value?.value || 0) > 0
                ) {
                    state.estimateCache.set(
                        huntKey,
                        value
                    );
                }

                return value;
            };

        const profile =
            combatProfile();

        const coverage = huntCombatCoverage(hunt, profile);
        const rawKillMs = rawPredictedKillMs(hunt, profile);
        const coverageFields = {
            coverage: coverage.percentage,
            coveredPoints: coverage.covered,
            totalPoints: coverage.total,
            missingHpPoints: coverage.missingHp,
            missingDamagePoints: coverage.missingDamage,
            incomplete: !coverage.complete
        };
        // A proven immunity is unfinishable. Measured XP/h above still wins.
        if (rawKillMs === Infinity) return {
            value: 0, pokemonValue: 0, goldValue: null,
            killsH: 0, killMs: Infinity, observed: false,
            source: 'immune combat model', confidence: 'low',
            fallbackReason: 'known-immunity',
            samples: Number(profile?.moveSamples) || 0,
            ...coverageFields
        };

        /*
         * Never hide recommendations while combat data is warming up. The
         * upstream Hunt Analyser uses a stable baseline: 900 ms attack floor,
         * 600 ms average movement, 2 s average move cooldown, and a 2.6 s
         * wave pause spread across up to 16 spawns. Replace this baseline with
         * the personalized combat model as soon as measured data is usable.
         */
        const hasPersonalizedModel =
            Boolean(
                profile &&
                Number.isFinite(rawKillMs) && rawKillMs > 0
            );
        const moveConfidence = moveModelConfidence(profile);

        const species =
            Array.isArray(hunt?.especies)
                ? hunt.especies
                : [];

        const spawnPoints =
            species.reduce(
                (sum, row) =>
                    sum +
                    Math.max(
                        1,
                        Number(row?.pontos || 1)
                    ),
                0
            ) || 1;

        const mobsPerWave =
            Math.max(
                1,
                Math.min(
                    16,
                    spawnPoints
                )
            );

        const baselineKillMs =
            UPSTREAM_GLOBAL_ATTACK_MS +
            UPSTREAM_FALLBACK_MOVE_MS +
            2000 +
            UPSTREAM_WAVE_MS / mobsPerWave;

        if (record && hasPersonalizedModel && !record.predictedBeforeMeasurement &&
            profile.moveSamples >= 6 && !(record.rateWindow?.rows?.reduce(
                (count, row) => count + row.kills, 0) >= 6)) {
            record.predictedBeforeMeasurement = {
                hunt: hunt.slug, scope: farmingSnapshotScope(),
                killMs: rawKillMs, source: 'personalized-model'
            };
        }

        const killMs =
            hasPersonalizedModel
                ? rawKillMs *
                    predictionCalibration(profile)
                : baselineKillMs;

        const killsH =
            3600000 /
            killMs;

        const baseXp =
            xpDoNivel(
                hunt?.nivel ||
                1
            );

        // The bonus stack differs per XP stream and catch-up can cross a
        // threshold mid-session. Never copy historical per-kill multipliers
        // into an unvisited hunt, even from this same lead.
        const trainerXpPerKill = baseXp;
        const pokemonXpPerKill = baseXp;

        const forecast = {
            value:
                trainerXpPerKill *
                killsH,
            pokemonValue:
                pokemonXpPerKill *
                killsH,
            goldValue: farmGoldPrediction(hunt,killsH),
            goldSource: 'upstream-shared-model',
            killGoldH: null,
            autoSaleH: null,
            warmingUp: Boolean(record && record.rateWindow?.rows?.length &&
                record.rateGeneration === state.rateGeneration),
            killsH,
            killMs,
            observed:
                false,
            bonusSource: 'unboosted-upstream-shared',
            bonusCaveat: 'active boosts unverified; model does not include them',
            source:
                !hasPersonalizedModel
                    ? 'baseline model'
                    : moveConfidence === 'low'
                        ? 'combat model'
                        : 'named-move model',
            confidence: hasPersonalizedModel ? moveConfidence : 'low',
            samples:
                Number(profile?.moveSamples) || 0,
            fallbackReason: !profile ? 'no-lead-combat-samples'
                : !coverage.complete ? 'incomplete-spawn-coverage'
                : !hasPersonalizedModel ? 'insufficient-personalized-model'
                : 'observed-attacks-with-unknown-live-scheduler',
            calibration: calibrationDiagnostics(),
            ...coverageFields
        };
        forecast.range = xpPredictionBand(forecast);
        return remember(forecast);
    }

    function rankedUnlockedHunts(
        speciesResults = null
    ) {
        const sourceHunts =
            speciesResults
                ? [
                    ...new Map(
                        speciesResults
                            .map(
                                species => [
                                    species.hunt.slug,
                                    species.hunt
                                ]
                            )
                    ).values()
                ]
                : state.hunts;

        return sourceHunts
            .filter(
                isUnlocked
            )
            .map(
                hunt => ({
                    hunt,
                    xp:
                        huntXpEstimate(
                            hunt
                        )
                })
            )
            .sort(
                (a, b) => {
                    const av =
                        Number(
                            a.xp?.value ||
                            0
                        );

                    const bv =
                        Number(
                            b.xp?.value ||
                            0
                        );

                    if (
                        av !== bv
                    ) {
                        return xpCompareForecasts(a.xp, b.xp);
                    }

                    const levelDifference =
                        Number(
                            b.hunt.nivel ||
                            0
                        ) -
                        Number(
                            a.hunt.nivel ||
                            0
                        );

                    if (levelDifference) {
                        return levelDifference;
                    }

                    return String(
                        a.hunt.slug || ''
                    ).localeCompare(
                        String(
                            b.hunt.slug || ''
                        )
                    );
                }
            );
    }

    // ------------------------------------------------------------------
    // Hunt / capture model
    // ------------------------------------------------------------------

    function captureCount(
        speciesId
    ) {
        const entry =
            state.pokedex.get(
                String(speciesId)
            );

        const count =
            Number(
                entry?.c ||
                0
            );

        if (
            count > 0
        ) {
            return count;
        }

        return state.ownedSpecies.has(
            Number(speciesId)
        )
            ? 1
            : 0;
    }

    function isCaptured(
        speciesId
    ) {
        return (
            captureCount(
                speciesId
            ) > 0
        );
    }

    function isUnlocked(
        hunt
    ) {
        if (
            state.currentHuntSlug &&
            hunt.slug ===
                state.currentHuntSlug
        ) {
            return true;
        }

        if (
            state.lockOverrides.has(
                hunt.slug
            )
        ) {
            return state.lockOverrides.get(
                hunt.slug
            );
        }

        const required =
            Number(
                hunt.nivel ||
                0
            );

        return (
            state.playerLevel >=
            required
        );
    }

    function buildSpeciesIndex() {
        const index =
            new Map();

        for (
            const hunt of
            state.hunts
        ) {
            if (
                !Array.isArray(
                    hunt?.especies
                )
            ) {
                continue;
            }

            for (
                const species of
                hunt.especies
            ) {
                const id =
                    Number(
                        species?.pokeId
                    );

                if (
                    !Number.isFinite(id)
                ) {
                    continue;
                }

                const existing =
                    index.get(id);

                if (existing) {
                    const level =
                        Number(
                            hunt?.nivel
                        );

                    if (
                        Number.isFinite(level) &&
                        (
                            !Number.isFinite(
                                existing.lowestHuntLevel
                            ) ||
                            level <
                                existing.lowestHuntLevel
                        )
                    ) {
                        existing.lowestHuntLevel =
                            level;
                    }

                    continue;
                }

                index.set(
                    id,
                    {
                        id,
                        name:
                            species.nome ||
                            'Pokémon ' +
                            id,
                        hunt,
                        lowestHuntLevel:
                            Number(
                                hunt?.nivel
                            ) ||
                            null
                    }
                );
            }
        }

        return index;
    }

    function marketKeyForSpecies(
        species
    ) {
        const id =
            Number(
                species?.id
            );

        if (Number.isFinite(id)) {
            return 'id:' + id;
        }

        const name =
            normalize(
                species?.name
            );

        return name
            ? 'name:' + name
            : null;
    }

    function marketStatsForSpecies(
        species
    ) {
        const idKey =
            Number.isFinite(
                Number(
                    species?.id
                )
            )
                ? 'id:' +
                    Number(
                        species.id
                    )
                : null;

        if (
            idKey &&
            state.marketValues.has(
                idKey
            )
        ) {
            return state.marketValues.get(
                idKey
            );
        }

        const nameKey =
            'name:' +
            normalize(
                species?.name
            );

        return state.marketValues.get(
            nameKey
        ) || null;
    }

    function playerMarketValueForSpecies(
        species
    ) {
        return Number(
            (
                species?.market ||
                marketStatsForSpecies(
                    species
                )
            )?.average ||
            0
        );
    }

    function npcBaseSellValueForSpecies(
        species
    ) {
        const meta =
            speciesCombatMeta(
                species?.id
            );

        if (!meta) {
            return 0;
        }

        let base =
            Number(
                meta.sellValue ||
                0
            );

        /*
         * Mirrors valor-cadeia.mjs's "raise to the hunt" pass for mirror
         * species whose catalog still carries a Kanto-scale hunt level.
         */
        const catalogLevel =
            Number(
                meta.huntLevel ||
                0
            );

        const lowestHuntLevel =
            Number(
                species?.lowestHuntLevel ||
                0
            );

        if (
            catalogLevel <=
                SELL_VALUE_ANCHOR_LEVEL &&
            lowestHuntLevel >
                SELL_VALUE_ANCHOR_LEVEL
        ) {
            base =
                Math.max(
                    base,
                    goldValueAtLevel(
                        lowestHuntLevel
                    )
                );
        }

        return Math.min(
            Math.max(
                0,
                base
            ),
            NPC_SELL_BASE_CAP
        );
    }

    function npcSellValueAtLevel(
        species,
        level
    ) {
        const base =
            npcBaseSellValueForSpecies(
                species
            );

        const huntLevel =
            Math.max(
                1,
                Number(
                    level ||
                    1
                )
            );

        if (base <= 0) {
            return 0;
        }

        /*
         * PokéIdle's shared sell-value.mjs:
         *   base × (1 + level / 50) × quality
         *
         * Atlas has species/hunt data rather than a captured individual's
         * quality, so use the neutral reference quality 1.0.
         * Shiny is intentionally not included here (actual sale ×10).
         */
        return Math.max(
            1,
            Math.floor(
                base *
                (
                    1 +
                    huntLevel /
                        50
                )
            )
        );
    }

    function npcSellStatsForSpecies(
        species
    ) {
        const value =
            npcSellValueAtLevel(
                species,
                species?.hunt?.nivel
            );

        if (value > 0) {
            return {
                average: value,
                min: value,
                max: value,
                count: 1
            };
        }

        const base =
            npcBaseSellValueForSpecies(
                species
            );

        return base > 0
            ? {
                average: base,
                min: base,
                max: base,
                count: 1
            }
            : null;
    }

    function npcSellValueForSpecies(
        species
    ) {
        return Number(
            npcSellStatsForSpecies(
                species
            )?.average ||
            0
        );
    }



    function bestMatchupScore(
        species
    ) {
        const matchup =
            speciesMatchup(
                species
            );

        if (
            !matchup?.offense ||
            !matchup?.defense
        ) {
            return -Infinity;
        }

        const deal =
            Number(
                matchup.offense
                    .multiplier
            );

        const take =
            Number(
                matchup.defense
                    .multiplier
            );

        if (
            !Number.isFinite(deal) ||
            !Number.isFinite(take)
        ) {
            return -Infinity;
        }

        const safety =
            take === 0
                ? 4
                : 1 /
                    Math.max(
                        0.25,
                        take
                    );

        return deal * safety;
    }

    function regionOptions() {
        return [
            ...new Set(
                state.hunts
                    .map(
                        hunt =>
                            String(
                                hunt.area ||
                                ''
                            )
                    )
                    .filter(Boolean)
            )
        ].sort(
            (a, b) =>
                a.localeCompare(
                    b
                )
        );
    }

    function huntMatchesScope(
        hunt
    ) {
        const regionFilter =
            state.filters.region;

        if (
            regionFilter !== 'all' &&
            String(
                hunt?.area || ''
            ) !== regionFilter
        ) {
            return false;
        }

        const huntLevel =
            Number(
                hunt?.nivel ||
                0
            );

        const minLevelFilter =
            Number.parseInt(
                state.filters.minLevel,
                10
            );

        if (
            Number.isFinite(
                minLevelFilter
            ) &&
            huntLevel <
                minLevelFilter
        ) {
            return false;
        }

        const maxLevelFilter =
            Number.parseInt(
                state.filters.maxLevel,
                10
            );

        if (
            Number.isFinite(
                maxLevelFilter
            ) &&
            huntLevel >
                maxLevelFilter
        ) {
            return false;
        }

        const unlocked =
            isUnlocked(
                hunt
            );

        if (
            state.filters.availability ===
                'unlocked' &&
            !unlocked
        ) {
            return false;
        }

        if (
            state.filters.availability ===
                'locked' &&
            unlocked
        ) {
            return false;
        }

        return true;
    }

    function filteredSpecies() {
        const search =
            normalize(
                state.filters.search
            );

        const typeFilter =
            state.filters.type;

        const weaknessFilter =
            Array.isArray(state.filters.weakness)
                ? state.filters.weakness
                : state.filters.weakness && state.filters.weakness !== 'all'
                    ? [state.filters.weakness]
                    : [];

        const weaknessMatchAll =
            Boolean(state.filters.weaknessMatchAll);

        const captureFilter =
            state.filters.captured;

        const entries =
            [...buildSpeciesIndex().values()];

        const result = [];

        for (
            const species of
            entries
        ) {
            const captured =
                isCaptured(
                    species.id
                );

            if (
                captureFilter ===
                    'captured' &&
                !captured
            ) {
                continue;
            }

            if (
                captureFilter ===
                    'uncaught' &&
                captured
            ) {
                continue;
            }

            const types =
                state.typesBySpecies.get(
                    species.id
                ) || [];

            if (
                typeFilter !== 'all' &&
                !types.includes(
                    typeFilter
                )
            ) {
                continue;
            }

            if (weaknessFilter.length) {
                const matches = weaknessMatchAll
                    ? weaknessFilter.every(
                        attackType =>
                            types.length &&
                            weaknessMultiplier(types, attackType) > 1
                    )
                    : weaknessFilter.some(
                        attackType =>
                            types.length &&
                            weaknessMultiplier(types, attackType) > 1
                    );

                if (!matches) {
                    continue;
                }
            }

            const hunt =
                species.hunt;

            if (
                !hunt ||
                !huntMatchesScope(
                    hunt
                )
            ) {
                continue;
            }

            if (
                search &&
                ![
                    species.name,
                    hunt.nome,
                    hunt.slug,
                    hunt.area,
                    locationForHunt(hunt)?.name,
                    locationForHunt(hunt)?.area
                ]
                    .map(
                        normalize
                    )
                    .some(
                        text =>
                            text.includes(
                                search
                            )
                    )
            ) {
                continue;
            }

            result.push({
                ...species,
                captured,
                captureCount:
                    captureCount(
                        species.id
                    ),
                types,
                market:
                    marketStatsForSpecies(
                        species
                    )
            });
        }

        // Compute at most one economy estimate per hunt during this sort.
        const economySortCache = new Map();
        const captureSortCache = new Map();
        const economyFor = hunt => {
            if (!hunt?.slug) return null;
            if (!economySortCache.has(hunt.slug))
                economySortCache.set(hunt.slug, huntEconomyEstimate(hunt));
            return economySortCache.get(hunt.slug);
        };
        result.sort(
            (a, b) => {
                const sort =
                    state.filters.sort;

                const direction =
                    state.filters
                        .sortDirection ===
                    'asc'
                        ? 1
                        : -1;

                const compareNumbers =
                    (
                        av,
                        bv,
                        missingBottom =
                            false
                    ) => {
                        const an =
                            Number(av);

                        const bn =
                            Number(bv);

                        const aMissing =
                            !Number.isFinite(
                                an
                            ) ||
                            (
                                missingBottom &&
                                an <= 0
                            );

                        const bMissing =
                            !Number.isFinite(
                                bn
                            ) ||
                            (
                                missingBottom &&
                                bn <= 0
                            );

                        if (
                            aMissing &&
                            bMissing
                        ) {
                            return 0;
                        }

                        if (aMissing) {
                            return 1;
                        }

                        if (bMissing) {
                            return -1;
                        }

                        if (an === bn) {
                            return 0;
                        }

                        return (
                            an -
                            bn
                        ) * direction;
                    };

                let comparison = 0;

                if (sort === 'name') {
                    comparison =
                        a.name.localeCompare(
                            b.name,
                            currentLocale(),
                            {
                                sensitivity:
                                    'base'
                            }
                        ) *
                        direction;
                } else if (
                    sort === 'pokedex'
                ) {
                    comparison =
                        compareNumbers(
                            a.id,
                            b.id
                        );
                } else if (
                    sort === 'xp'
                ) {
                    const value =
                        species =>
                            Number(
                                huntXpEstimate(
                                    species.hunt
                                )?.value ||
                                0
                            );

                    comparison =
                        compareNumbers(
                            value(a),
                            value(b),
                            true
                        );
                } else if (sort === 'coins' || sort === 'netCoins') {
                    // Null means unsupported, NOT free or equal to zero.
                    const key = sort === 'coins' ? 'killCoinsH' : 'netH';
                    const av = economyFor(a.hunt)?.[key];
                    const bv = economyFor(b.hunt)?.[key];
                    const aKnown = typeof av === 'number' && Number.isFinite(av);
                    const bKnown = typeof bv === 'number' && Number.isFinite(bv);
                    comparison = aKnown && bKnown ? (av - bv) * direction
                        : aKnown ? -1 : bKnown ? 1 : 0;
                } else if (sort === 'capture' || sort === 'shinyCatch') {
                    const id=state.filters.captureBall==='beast'?5:4;
                    const key=sort==='capture'?'catchesH':'shinyCaughtH';
                    const val=species=>{
                        const cacheKey=String(species.id)+'|'+species.hunt?.slug;
                        if(!captureSortCache.has(cacheKey))
                            captureSortCache.set(cacheKey,
                                capturePlanForSpecies(species,id)?.[key]??null);
                        return captureSortCache.get(cacheKey);
                    };
                    const av=val(a),bv=val(b);
                    const ak=typeof av==='number'&&Number.isFinite(av);
                    const bk=typeof bv==='number'&&Number.isFinite(bv);
                    comparison=ak&&bk?(av-bv)*direction:ak?-1:bk?1:0;
                } else if (
                    sort === 'npc'
                ) {
                    comparison =
                        compareNumbers(
                            npcSellValueForSpecies(
                                a
                            ),
                            npcSellValueForSpecies(
                                b
                            ),
                            true
                        );
                } else if (
                    sort ===
                    'player_market'
                ) {
                    comparison =
                        compareNumbers(
                            playerMarketValueForSpecies(
                                a
                            ),
                            playerMarketValueForSpecies(
                                b
                            ),
                            true
                        );

                } else if (
                    sort === 'level'
                ) {
                    const value =
                        species =>
                            Number(
                                species.hunt
                                    ?.nivel ||
                                0
                            );

                    comparison =
                        compareNumbers(
                            value(a),
                            value(b)
                        );
                } else if (
                    sort === 'matchup'
                ) {
                    comparison =
                        compareNumbers(
                            bestMatchupScore(
                                a
                            ),
                            bestMatchupScore(
                                b
                            ),
                            true
                        );
                }

                if (comparison) {
                    return comparison;
                }

                /*
                 * The primary sort can legitimately tie (for example several
                 * Pokémon can share the same hunt level/XP, or market data can
                 * be unavailable while it is loading). Keep the requested
                 * direction meaningful instead of always falling back to
                 * ascending name order.
                 */
                const nameTie =
                    a.name.localeCompare(
                        b.name,
                        currentLocale(),
                        {
                            sensitivity:
                                'base'
                        }
                    ) *
                    direction;

                if (nameTie) {
                    return nameTie;
                }

                return (
                    (
                        Number(a.id) ||
                        0
                    ) -
                    (
                        Number(b.id) ||
                        0
                    )
                ) * direction;
            }
        );

        return result;
    }

    // ------------------------------------------------------------------
    // Hunt navigation
    // ------------------------------------------------------------------

    function socketReady() {
        return Boolean(
            state.activeSocket &&
            state.activeSocket.readyState ===
                WebSocket.OPEN
        );
    }

    function sendHuntSelect(
        hunt
    ) {
        if (
            !hunt ||
            !hunt.slug
        ) {
            return false;
        }

        if (!socketReady()) {
            setStatus(
                'status.gameNotReady'
            );

            queueRender();
            return false;
        }

        try {
            state.pendingTravel = {
                slug:
                    hunt.slug,
                startedAt:
                    Date.now()
            };

            setStatus(
                'status.traveling',
                {
                    hunt:
                        hunt.nome ||
                        hunt.slug
                }
            );

            /*
             * Explorer captured PokéIdle's exact map action:
             *   { t: "hunt.select", slug: "<hunt-slug>" }
             *
             * The server remains authoritative for cooldowns and any
             * progression restrictions Atlas does not know about.
             */
            state.activeSocket.send(
                JSON.stringify({
                    t:
                        'hunt.select',
                    slug:
                        hunt.slug
                })
            );

            queueRender();

            setTimeout(
                () => {
                    if (
                        state.pendingTravel?.slug ===
                            hunt.slug &&
                        !isHuntHere(
                            hunt.slug
                        )
                    ) {
                        setStatus(
                            'status.notAccepted',
                            {
                                hunt:
                                    hunt.nome ||
                                    hunt.slug
                            }
                        );

                        state.pendingTravel =
                            null;

                        queueRender();
                    }
                },
                2500
            );

            return true;
        } catch (error) {
            console.warn(
                '[PokéIdle Hunt Atlas] hunt.select failed',
                error
            );

            state.pendingTravel =
                null;

            setStatus(
                'status.couldNotSend'
            );

            queueRender();
            return false;
        }
    }

    function navigateToHunt(
        hunt
    ) {
        if (
            !isUnlocked(hunt)
        ) {
            setStatus(
                'status.huntLocked',
                {
                    hunt:
                        hunt.nome,
                    level:
                        hunt.nivel
                }
            );

            queueRender();
            return;
        }

        if (
            isHuntHere(
                hunt.slug
            )
        ) {
            setStatus(
                'status.alreadyHere',
                {
                    hunt:
                        hunt.nome
                }
            );

            queueRender();
            return;
        }

        if (
            sendHuntSelect(
                hunt
            )
        ) {
            /*
             * Keep the Atlas open briefly so the user sees "Traveling…".
             * The confirmed hunt event will update the current state.
             */
            setTimeout(
                () => {
                    if (
                        isHuntHere(
                            hunt.slug
                        )
                    ) {
                        q(
                            '#modal-fechar'
                        )?.click();
                    }
                },
                300
            );
        }
    }


    // ------------------------------------------------------------------
    // Parcel Panic — a toy, NOT a geographic map or game automation.
    // Spawn locations come from the game's optional map-marker index;
    // each region is deliberately stretched to fill the toy playfield.
    // Absolutely nothing here sends game events, changes hunts or awards XP.
    // ------------------------------------------------------------------
    const ARCADE_WIDTH = 640;
    const ARCADE_HEIGHT = 360;
    const ARCADE_BEST_KEY = 'moth-hunt-atlas-parcel-panic-best-v1:';
    const arcade = {
        open: false, running: false, paused: false, raf: 0, lastFrame: 0,
        region: '', markers: [], edges: [], player: {x: 320, y: 180},
        destination: null, lastDestination: '', ghosts: [], sparks: [],
        keys: new Set(), pointer: null, score: 0, best: 0,
        hearts: 3, seconds: 60, invulnerable: 0, hudAt: 0,
        canvas: null, context: null
    };

    function arcadeRegions() {
        const counts = new Map();
        for (const marker of state.locationsBySlug.values()) {
            const region = String(marker.area || '').toLowerCase();
            if (region && Array.isArray(marker.pixel) &&
                marker.pixel.length === 2 &&
                marker.pixel.every(Number.isFinite)) {
                counts.set(region, (counts.get(region) || 0) + 1);
            }
        }
        return [...counts].filter(([, count]) => count >= 3)
            .map(([region]) => region)
            .sort((a, b) => (a === 'outland' ? -1 : b === 'outland' ? 1 :
                a.localeCompare(b)));
    }

    function arcadeProjectMarkers(rows, region) {
        const matching = rows.filter(row =>
            String(row?.area || '').toLowerCase() === region &&
            Array.isArray(row.pixel) && row.pixel.length === 2 &&
            row.pixel.every(Number.isFinite));
        if (!matching.length) return [];
        const xs = matching.map(row => row.pixel[0]);
        const ys = matching.map(row => row.pixel[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const spanX = Math.max(1, maxX - minX);
        const spanY = Math.max(1, maxY - minY);
        return matching.map(row => ({
            slug: String(row.slug || ''),
            name: String(row.name || row.slug || '?'),
            x: 32 + ((row.pixel[0] - minX) / spanX) * (ARCADE_WIDTH - 64),
            y: 32 + ((row.pixel[1] - minY) / spanY) * (ARCADE_HEIGHT - 64)
        }));
    }

    function arcadeDistance(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function arcadeEdges(markers) {
        // Fake roads for a silly constellation: nearest-neighbor art only.
        // They are NOT valid walkable routes or accurate world distances.
        return markers.map((marker, i) => {
            let best = -1, distance = Infinity;
            for (let j = 0; j < markers.length; j++) {
                if (j === i) continue;
                const next = arcadeDistance(marker, markers[j]);
                if (next < distance) { distance = next; best = j; }
            }
            return [i, best];
        }).filter(([, j]) => j >= 0);
    }

    function arcadePickDestination() {
        const choices = arcade.markers.filter(row =>
            row.slug !== arcade.lastDestination &&
            arcadeDistance(row, arcade.player) >= 85);
        const pool = choices.length ? choices : arcade.markers.filter(row =>
            row.slug !== arcade.lastDestination);
        if (!pool.length) return null;
        const chosen = pool[Math.floor(Math.random() * pool.length)];
        arcade.lastDestination = chosen.slug;
        return chosen;
    }

    function arcadeSpawnGhost() {
        if (!arcade.markers.length || arcade.ghosts.length >= 5) return;
        const far = arcade.markers.filter(marker =>
            arcadeDistance(marker, arcade.player) > 120 &&
            (!arcade.destination || marker.slug !== arcade.destination.slug));
        const pool = far.length ? far : arcade.markers;
        const spawn = pool[Math.floor(Math.random() * pool.length)];
        arcade.ghosts.push({
            x: spawn.x, y: spawn.y,
            phase: Math.random() * Math.PI * 2
        });
    }

    function arcadeReadBest(region) {
        try {
            return Math.max(0, Math.min(9999,
                Number(localStorage.getItem(ARCADE_BEST_KEY + region)) || 0));
        } catch { return 0; }
    }

    function arcadeRememberBest() {
        if (arcade.score <= arcade.best) return;
        arcade.best = arcade.score;
        try {
            localStorage.setItem(ARCADE_BEST_KEY + arcade.region,
                String(arcade.best));
        } catch {}
    }

    function arcadeStop() {
        if (arcade.raf) cancelAnimationFrame(arcade.raf);
        arcade.raf = 0;
        arcade.running = false;
        arcade.lastFrame = 0;
        arcade.keys.clear();
        arcade.pointer = null;
    }

    function arcadeClose() {
        arcadeRememberBest();
        arcadeStop();
        arcade.paused = false;
        arcade.open = false;
    }

    function arcadePrepare(region) {
        arcadeStop();
        arcade.paused = false;
        arcade.region = region;
        arcade.markers = arcadeProjectMarkers(
            [...state.locationsBySlug.values()], region);
        arcade.edges = arcadeEdges(arcade.markers);
        arcade.score = 0;
        arcade.seconds = 60;
        arcade.hearts = 3;
        arcade.invulnerable = 0;
        arcade.ghosts = [];
        arcade.sparks = [];
        arcade.lastDestination = '';
        arcade.best = arcadeReadBest(region);
        const spawn = arcade.markers[Math.floor(arcade.markers.length / 2)];
        arcade.player = spawn
            ? {x: spawn.x, y: spawn.y} : {x: 320, y: 180};
        arcade.destination = arcadePickDestination();
        arcadeSpawnGhost();
        arcadeSpawnGhost();
        arcadeHud();
        arcadeDraw();
    }

    function arcadeHud(message = null) {
        const panel = q('[data-mha-arcade-panel]');
        if (!panel) return;
        const set = (selector, value) => {
            const element = q(selector, panel);
            if (element && element.textContent !== value)
                element.textContent = value;
        };
        set('[data-mha-arcade-score]', String(arcade.score));
        set('[data-mha-arcade-best]', String(arcade.best));
        set('[data-mha-arcade-hearts]', '♥'.repeat(arcade.hearts) +
            '♡'.repeat(3 - arcade.hearts));
        set('[data-mha-arcade-time]', String(Math.ceil(arcade.seconds)));
        set('[data-mha-arcade-target]',
            arcade.destination?.name || '—');
        const button = q('[data-mha-arcade-start]', panel);
        if (button) button.textContent = tr(
            arcade.running ? 'arcade.restart' :
                arcade.paused ? 'arcade.resume' : 'arcade.start');
        if (message !== null) set('[data-mha-arcade-message]', message);
    }

    function arcadeDraw() {
        const ctx = arcade.context;
        if (!ctx || !arcade.canvas?.isConnected) return;
        const w = ARCADE_WIDTH, h = ARCADE_HEIGHT;
        ctx.fillStyle = '#0a1324';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(127,177,210,.075)';
        ctx.lineWidth = 1;
        for (let x = 0; x <= w; x += 32) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y <= h; y += 32) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(120,196,221,.13)';
        for (const [a, b] of arcade.edges) {
            ctx.beginPath();
            ctx.moveTo(arcade.markers[a].x, arcade.markers[a].y);
            ctx.lineTo(arcade.markers[b].x, arcade.markers[b].y);
            ctx.stroke();
        }
        ctx.fillStyle = 'rgba(120,191,215,.45)';
        for (const row of arcade.markers) {
            ctx.beginPath(); ctx.arc(row.x, row.y, 2.6, 0, Math.PI * 2);
            ctx.fill();
        }
        if (arcade.destination) {
            const target = arcade.destination;
            ctx.strokeStyle = 'rgba(253,211,98,.9)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(target.x, target.y, 17, 0, Math.PI * 2);
            ctx.stroke();
            ctx.font = '24px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('📮', target.x, target.y + 8);
            ctx.font = 'bold 12px sans-serif';
            ctx.fillStyle = '#ffe598';
            ctx.fillText(target.name.slice(0, 30),
                Math.max(92, Math.min(w - 92, target.x)),
                target.y < 65 ? target.y + 38 : target.y - 25, 180);
        }
        for (const ghost of arcade.ghosts) {
            ctx.font = '23px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('👻', ghost.x, ghost.y + 8);
        }
        for (const spark of arcade.sparks) {
            ctx.globalAlpha = Math.max(0, spark.life);
            ctx.fillStyle = '#ffdf74';
            ctx.fillRect(spark.x, spark.y, 5, 5);
        }
        ctx.globalAlpha = 1;
        if (arcade.invulnerable <= 0 ||
            Math.floor(arcade.invulnerable * 10) % 2 === 0) {
            ctx.font = '27px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🚚', arcade.player.x, arcade.player.y + 9);
        }
        if (!arcade.running) {
            ctx.fillStyle = 'rgba(5,12,27,.50)';
            ctx.fillRect(0, h - 47, w, 47);
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#e9f3fc';
            ctx.fillText(arcade.paused ? tr('arcade.paused') :
                arcade.hearts === 0 || arcade.seconds === 0
                    ? tr('arcade.gameOver') : tr('arcade.ready'),
                w / 2, h - 19);
        }
    }

    function arcadeGameOver() {
        arcadeRememberBest();
        arcadeStop();
        arcade.paused = false;
        arcadeHud(tr('arcade.finished', {score: arcade.score}));
        arcadeDraw();
    }

    function arcadeFrame(now) {
        arcade.raf = 0;
        if (!arcade.open || !arcade.running ||
            !arcade.canvas?.isConnected ||
            !state.atlasEnabled || !isMapModalOpen()) {
            arcadeStop();
            return;
        }
        if (document.hidden) {
            arcadeStop();
            arcade.paused = true;
            arcadeHud(tr('arcade.paused'));
            arcadeDraw();
            return;
        }
        const dt = arcade.lastFrame
            ? Math.min(.05, (now - arcade.lastFrame) / 1000) : 0;
        arcade.lastFrame = now;
        arcade.seconds = Math.max(0, arcade.seconds - dt);
        if (arcade.seconds <= 0) {
            arcadeGameOver();
            return;
        }
        let dx = 0, dy = 0;
        const held = arcade.keys;
        if (held.has('arrowleft') || held.has('a')) dx--;
        if (held.has('arrowright') || held.has('d')) dx++;
        if (held.has('arrowup') || held.has('w')) dy--;
        if (held.has('arrowdown') || held.has('s')) dy++;
        if (arcade.pointer && dx === 0 && dy === 0) {
            dx = arcade.pointer.x - arcade.player.x;
            dy = arcade.pointer.y - arcade.player.y;
            if (Math.hypot(dx, dy) < 8) { dx = 0; dy = 0; }
        }
        const length = Math.hypot(dx, dy) || 1;
        arcade.player.x = Math.max(16, Math.min(624,
            arcade.player.x + dx / length * 192 * dt));
        arcade.player.y = Math.max(16, Math.min(344,
            arcade.player.y + dy / length * 192 * dt));
        if (arcade.destination &&
            arcadeDistance(arcade.player, arcade.destination) < 20) {
            const old = arcade.destination;
            arcade.score++;
            arcadeRememberBest();
            arcade.seconds = Math.min(90, arcade.seconds + 5);
            arcade.destination = arcadePickDestination();
            if (arcade.score % 3 === 0) arcadeSpawnGhost();
            for (let i = 0; i < 9; i++) {
                arcade.sparks.push({
                    x: old.x + (Math.random() -.5) * 36,
                    y: old.y + (Math.random() -.5) * 36, life: 1
                });
            }
            arcadeHud(tr('arcade.delivered', {hunt: old.name}));
        }
        arcade.invulnerable = Math.max(0, arcade.invulnerable - dt);
        for (const ghost of arcade.ghosts) {
            const vx = arcade.player.x - ghost.x;
            const vy = arcade.player.y - ghost.y;
            const len = Math.hypot(vx, vy) || 1;
            const speed = Math.min(74, 34 + arcade.score * 2);
            ghost.x += (vx / len + Math.sin(now / 750 + ghost.phase) * .28) *
                speed * dt;
            ghost.y += (vy / len + Math.cos(now / 900 + ghost.phase) * .28) *
                speed * dt;
            if (len < 20 && arcade.invulnerable <= 0) {
                arcade.hearts--;
                arcade.invulnerable = 1.6;
                arcadeHud(tr('arcade.ouch'));
                if (arcade.hearts <= 0) {
                    arcadeGameOver();
                    return;
                }
            }
        }
        for (const spark of arcade.sparks) spark.life -= dt * 1.8;
        arcade.sparks = arcade.sparks.filter(spark => spark.life > 0);
        if (now - arcade.hudAt > 180) {
            arcade.hudAt = now;
            arcadeHud();
        }
        arcadeDraw();
        arcade.raf = requestAnimationFrame(arcadeFrame);
    }

    function arcadeStart() {
        if (!arcade.open || !arcade.markers.length) return;
        if (!arcade.paused) arcadePrepare(arcade.region);
        arcade.paused = false;
        arcade.running = true;
        arcade.lastFrame = 0;
        arcadeHud(tr('arcade.running'));
        arcade.canvas?.focus({preventScroll: true});
        arcade.raf = requestAnimationFrame(arcadeFrame);
    }

    function arcadeCanvasPointer(event) {
        if (!arcade.running || !arcade.canvas) return;
        const rect = arcade.canvas.getBoundingClientRect();
        arcade.pointer = {
            x: (event.clientX - rect.left) / rect.width * ARCADE_WIDTH,
            y: (event.clientY - rect.top) / rect.height * ARCADE_HEIGHT
        };
    }

    function arcadeBind(canvas) {
        if (arcade.canvas === canvas) return;
        arcadeStop();
        arcade.canvas = canvas;
        arcade.context = canvas.getContext('2d');
        canvas.addEventListener('keydown', event => {
            const key = event.key.toLowerCase();
            if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright',
                'w', 'a', 's', 'd'].includes(key)) {
                event.preventDefault();
                arcade.keys.add(key);
            }
        });
        canvas.addEventListener('keyup', event => {
            arcade.keys.delete(event.key.toLowerCase());
        });
        canvas.addEventListener('blur', () => arcade.keys.clear());
        canvas.addEventListener('pointerdown', event => {
            if (!arcade.running) return;
            event.preventDefault();
            canvas.focus({preventScroll: true});
            canvas.setPointerCapture(event.pointerId);
            arcadeCanvasPointer(event);
        });
        canvas.addEventListener('pointermove', event => {
            if (arcade.pointer) arcadeCanvasPointer(event);
        });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
            canvas.addEventListener(type, () => { arcade.pointer = null; });
        }
    }

    function arcadeRender(drawer) {
        const button = q('[data-mha-arcade-toggle]', drawer);
        if (button) {
            button.textContent = tr(arcade.open ? 'arcade.back' : 'arcade.open');
            button.setAttribute('aria-pressed', String(arcade.open));
        }
        drawer.dataset.arcadeOpen = arcade.open ? '1' : '0';
        const panel = q('[data-mha-arcade-panel]', drawer);
        if (!panel) return;
        panel.hidden = !arcade.open;
        if (!arcade.open) return;
        const regions = arcadeRegions();
        const select = q('[data-mha-arcade-region]', panel);
        const html = regions.map(region =>
            '<option value="' + escapeHtml(region) + '">' +
            escapeHtml(region.toUpperCase()) + '</option>').join('');
        if (select.innerHTML !== html) select.innerHTML = html;
        if (!regions.includes(arcade.region)) {
            arcadePrepare(regions.includes('outland') ? 'outland' :
                regions[0] || '');
        }
        select.disabled = !regions.length;
        if (regions.length) select.value = arcade.region;
        const start = q('[data-mha-arcade-start]', panel);
        start.disabled = arcade.markers.length < 3;
        arcadeBind(q('[data-mha-arcade-canvas]', panel));
        if (!arcade.running) {
            arcadeHud(!regions.length
                ? tr(state.locationIndexStatus === 'error'
                    ? 'arcade.unavailable' : 'arcade.loading')
                : arcade.paused
                    ? tr('arcade.paused')
                    : arcade.hearts === 0 || arcade.seconds === 0
                        ? tr('arcade.finished', {score: arcade.score})
                        : tr('arcade.instructions'));
        } else arcadeHud();
        arcadeDraw();
    }

    // ------------------------------------------------------------------
    // UI
    // ------------------------------------------------------------------

    function injectStyles() {
        if (
            q('#' + STYLE_ID)
        ) {
            return;
        }

        const style =
            document.createElement(
                'style'
            );

        style.id =
            STYLE_ID;

        style.textContent = `
            #${BUTTON_ID} {
                display: none !important;
            }

            #mha-map-toggle {
                margin-left: 8px;
                padding: 3px 8px;
                border: 1px solid rgba(255,255,255,.14);
                border-radius: 999px;
                background: rgba(255,255,255,.06);
                color: #a99fa3;
                cursor: pointer;
                font: 700 9px/1 system-ui,sans-serif;
                white-space: nowrap;
            }

            #mha-map-toggle[data-enabled="1"] {
                border-color: rgba(104,190,130,.28);
                background: rgba(104,190,130,.10);
                color: #a8ddb7;
            }

            #modal .modal-caixa[data-mha-atlas-active="1"] {
                width: min(1180px, 96vw) !important;
                max-width: 96vw !important;
                height: min(880px, 92vh) !important;
                max-height: 92vh !important;
            }

            #modal .modal-caixa[data-mha-atlas-active="1"] #modal-corpo {
                display: flex !important;
                flex-direction: column !important;
                min-height: 0 !important;
                height: auto !important;
                flex: 1 1 auto !important;
                overflow: hidden !important;
                padding: 0 !important;
            }

            #modal .modal-caixa[data-mha-atlas-active="1"]
            #modal-corpo > :not(#${DRAWER_ID}) {
                display: none !important;
            }

            #${DRAWER_ID} {
                width: 100% !important;
                min-width: 0 !important;
                min-height: 0 !important;
                flex: 1 1 auto !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                background: #171316 !important;
                color: #eee7ea !important;
                font: 11px/1.35 system-ui,sans-serif !important;
            }

            #${DRAWER_ID}[hidden] {
                display: none !important;
            }

            #${DRAWER_ID},
            #${DRAWER_ID} * {
                box-sizing: border-box !important;
            }

            #mha-native-credit {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                margin-left: 8px;
                margin-right: auto;
                min-width: 0;
            }

            #mha-native-credit .mha-credit {
                margin: 0;
            }

            .mha-go {
                border: 1px solid rgba(255,255,255,.13);
                border-radius: 5px;
                background: rgba(255,255,255,.06);
                color: #eee;
                cursor: pointer;
                font: inherit;
            }

            .mha-filters {
                display: grid;
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 8px;
                padding: 10px 12px;
                border-bottom: 1px solid rgba(255,255,255,.07);
                background: rgba(255,255,255,.015);
            }

            .mha-field {
                display: grid;
                gap: 3px;
                min-width: 0;
                color: #8f858a;
                font-size: 8px;
                font-weight: 700;
                letter-spacing: .02em;
            }

            .mha-field > span {
                padding-left: 1px;
            }

            .mha-filters input,
            .mha-filters select,
            .mha-filter-actions button,
            .mha-sort-control button {
                width: 100%;
                min-width: 0;
                height: 30px;
                padding: 4px 6px;
                border: 1px solid rgba(255,255,255,.12);
                border-radius: 5px;
                background: #211a1e;
                color: #fff;
                font: inherit;
            }

            .mha-search {
                grid-column: span 2;
            }

            .mha-weakness-options {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 4px;
                max-height: 96px;
                overflow-y: auto;
                padding: 2px;
                border: 1px solid rgba(255,255,255,.12);
                border-radius: 5px;
                background: rgba(0,0,0,.12);
            }

            .mha-weakness-option {
                width: 100%;
                min-width: 0;
                min-height: 24px;
                padding: 3px 4px;
                border: 1px solid rgba(255,255,255,.10);
                border-radius: 4px;
                background: #211a1e;
                color: #c8bec3;
                font: inherit;
                font-size: 8px;
                line-height: 1.15;
                cursor: pointer;
            }

            .mha-weakness-option.active {
                border-color: rgba(102,176,255,.65);
                background: rgba(102,176,255,.20);
                color: #fff;
                font-weight: 750;
            }

            .mha-weakness-option:focus-visible {
                outline: 2px solid #66b0ff;
                outline-offset: 1px;
            }

            .mha-weakness-mode {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
                margin-top: 2px;
                font-size: 8px;
            }

            .mha-weakness-mode button {
                width: auto;
                min-width: 0;
                height: 22px;
                padding: 2px 6px;
                font-size: 8px;
                opacity: .65;
            }

            .mha-weakness-mode button.active {
                opacity: 1;
                font-weight: 700;
                box-shadow: inset 0 0 0 1px rgba(255,255,255,.18);
            }

            .mha-weakness-mode button:disabled {
                opacity: .25;
                cursor: default;
            }

            .mha-level-inputs {
                display: grid;
                grid-template-columns: 1fr auto 1fr;
                align-items: center;
                gap: 4px;
            }

            .mha-sort-control {
                display: grid;
                grid-template-columns: minmax(0,1fr) 31px;
                gap: 4px;
            }

            .mha-sort-dir {
                width: 31px !important;
                padding: 0 !important;
                cursor: pointer;
                font-size: 15px !important;
                font-weight: 800 !important;
                line-height: 1 !important;
            }

            .mha-level-inputs > span {
                color: #71686c;
                font-size: 10px;
            }

            .mha-filter-actions {
                grid-column: span 3;
                display: grid;
                grid-template-columns: minmax(0,1fr) auto;
                align-items: end;
                gap: 6px;
            }

            .mha-filter-state {
                align-self: center;
                min-width: 0;
                overflow: hidden;
                color: #93898e;
                font-size: 9px;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .mha-filter-actions button {
                width: auto;
                padding-inline: 9px;
                cursor: pointer;
            }

            .mha-filter-actions button:disabled {
                cursor: default;
                opacity: .45;
            }

            .mha-xp-summary {
                padding: 8px 10px;
                border-bottom: 1px solid rgba(255,255,255,.07);
                background: rgba(102,176,255,.055);
            }

            .mha-xp-heading {
                display: flex;
                align-items: baseline;
                gap: 8px;
                margin-bottom: 6px;
            }

            .mha-xp-heading strong {
                color: #e8e1e4;
                font-size: 11px;
            }

            .mha-xp-heading span {
                min-width: 0;
                overflow: hidden;
                color: #93898e;
                font-size: 8px;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .mha-xp-primary {
                display: grid;
                grid-template-columns: minmax(0,1fr) auto auto;
                gap: 6px;
                align-items: center;
            }

            .mha-xp-primary-main {
                min-width: 0;
            }

            .mha-xp-primary-main strong {
                display: block;
                overflow: hidden;
                color: #e8e1e4;
                font-size: 10px;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .mha-xp-primary-main span,
            .mha-xp-note {
                color: #9e9398;
                font-size: 8px;
            }

            .mha-xp-toggle {
                border: 0;
                background: transparent;
                color: #a9d2ff;
                cursor: pointer;
                font: inherit;
                font-size: 9px;
            }

            .mha-xp-details {
                margin-top: 6px;
                padding-top: 6px;
                border-top: 1px solid rgba(255,255,255,.07);
            }

            .mha-xp-details[hidden] {
                display: none;
            }

            .mha-xp-list-title {
                margin-bottom: 4px;
                color: #b9d8fb;
                font-size: 9px;
                font-weight: 750;
            }

            .mha-best-list {
                display: grid;
                gap: 3px;
                margin-top: 0;
                margin-bottom: 6px;
            }

            .mha-best-row {
                display: grid;
                grid-template-columns: 18px minmax(0,1fr) auto auto;
                gap: 5px;
                align-items: center;
                min-height: 26px;
                padding: 3px 5px;
                border-radius: 5px;
                background: rgba(0,0,0,.18);
            }

            .mha-best-rank {
                color: #7f7479;
                font-size: 9px;
                text-align: center;
            }

            .mha-best-name {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .mha-xp-value {
                color: #a9d2ff;
                font-size: 9px;
                white-space: nowrap;
            }

            .mha-meta {
                display: flex;
                align-items: center;
                gap: 8px;
                min-height: 29px;
                padding: 5px 8px;
                border-bottom: 1px solid rgba(255,255,255,.07);
                color: #a99fa3;
                font-size: 9px;
            }

            .mha-meta .mha-status {
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .mha-credit {
                display: flex;
                align-items: center;
                gap: 5px;
                min-width: 0;
                color: #8f858a;
                font-size: 8px;
                white-space: nowrap;
            }

            .mha-credit a {
                color: #9c9196;
                text-decoration: none;
            }

            .mha-credit a:hover,
            .mha-credit a:focus-visible {
                color: #d2c7cc;
                text-decoration: underline;
            }

            .mha-credit-icon {
                display: inline-grid;
                width: 18px;
                height: 18px;
                place-items: center;
                border: 1px solid rgba(255,255,255,.11);
                border-radius: 50%;
                color: #a1979c;
                text-decoration: none !important;
            }

            .mha-credit-icon svg {
                width: 11px;
                height: 11px;
                fill: currentColor;
            }

            .mha-credit-sep {
                color: #62595e;
            }

            .mha-body {
                flex: 1;
                min-height: 0;
                overflow: auto;
                padding: 10px 12px;
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 9px;
                align-content: start;
            }

            .mha-species {
                margin-bottom: 0;
                padding: 7px;
                border: 1px solid rgba(255,255,255,.08);
                border-radius: 7px;
                background: rgba(255,255,255,.035);
            }

            .mha-species-head {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-bottom: 6px;
                flex-wrap: wrap;
            }

            .mha-species-name {
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-weight: 750;
                font-size: 12px;
            }

            .mha-caught {
                padding: 2px 5px;
                border-radius: 999px;
                background: rgba(88,190,112,.13);
                color: #93e3a8;
                font-size: 9px;
                white-space: nowrap;
            }

            .mha-uncaught {
                padding: 2px 5px;
                border-radius: 999px;
                background: rgba(235,178,74,.11);
                color: #ffd27d;
                font-size: 9px;
                white-space: nowrap;
            }

            .mha-market,
            .mha-npc-value {
                padding: 2px 5px;
                border: 1px solid rgba(236,198,98,.16);
                border-radius: 999px;
                background: rgba(236,198,98,.07);
                color: #d8c58c;
                font-size: 8px;
                white-space: nowrap;
            }

            .mha-market {
                border-color: rgba(123,171,230,.15);
                background: rgba(123,171,230,.06);
                color: #adc9ec;
            }

            .mha-matchups {
                display: inline-flex;
                gap: 3px;
                flex-wrap: wrap;
            }

            .mha-matchup {
                padding: 2px 5px;
                border: 1px solid rgba(255,255,255,.08);
                border-radius: 999px;
                background: rgba(255,255,255,.05);
                color: #b8adb2;
                font-size: 8px;
                white-space: nowrap;
            }

            .mha-matchup.good {
                border-color: rgba(91,190,119,.22);
                background: rgba(91,190,119,.10);
                color: #9be3ae;
            }

            .mha-matchup.bad {
                border-color: rgba(225,102,102,.22);
                background: rgba(225,102,102,.09);
                color: #f0a0a0;
            }

            .mha-matchup.immune {
                font-weight: 750;
            }

            .mha-types {
                display: inline-flex;
                gap: 3px;
                flex-wrap: wrap;
            }

            .mha-type {
                padding: 2px 4px;
                border-radius: 4px;
                background: rgba(255,255,255,.07);
                color: #cfc4c9;
                font-size: 8px;
            }

            .mha-hunts {
                display: grid;
                gap: 4px;
            }

            .mha-hunt {
                display: grid;
                grid-template-columns: minmax(0,1fr) auto;
                gap: 6px;
                align-items: center;
                min-height: 33px;
                padding: 5px 6px;
                border-radius: 5px;
                background: rgba(0,0,0,.18);
            }

            .mha-hunt.current {
                outline: 1px solid rgba(100,210,130,.24);
                background: rgba(88,190,112,.08);
            }

            .mha-hunt.locked {
                opacity: .72;
            }

            .mha-hunt-main {
                min-width: 0;
            }

            .mha-hunt-title {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: #e7dfe2;
                font-size: 10px;
            }

            .mha-hunt-sub {
                margin-top: 2px;
                color: #93898e;
                font-size: 8px;
            }

            .mha-go {
                min-width: 58px;
                padding: 5px 7px;
            }

            .mha-go:hover:not(:disabled) {
                background: rgba(255,255,255,.12);
            }

            .mha-go:disabled {
                cursor: default;
                opacity: .46;
            }

            .mha-go.current {
                color: #8fdda4;
                border-color: rgba(100,210,130,.28);
            }

            .mha-empty {
                grid-column: 1 / -1;
                padding: 28px 12px;
                color: #9d9397;
                text-align: center;
            }

            .mha-show-more {
                grid-column: 1 / -1;
                width: 100%;
                margin-top: 2px;
                padding: 8px;
                border: 1px solid rgba(255,255,255,.12);
                border-radius: 6px;
                background: rgba(255,255,255,.05);
                color: #d9d0d4;
                cursor: pointer;
                font: inherit;
            }

            .mha-show-more:hover {
                background: rgba(255,255,255,.09);
            }


            /* Parcel Panic is a separate toy view, not a map replacement.
               Only the game canvas is animated while the player is active. */
            .mha-arcade-toggle {
                flex: 0 0 auto;
                padding: 5px 10px;
                border: 1px solid #4c758c;
                border-radius: 7px;
                color: #b8e7ff;
                background: #223546;
                font: 700 12px/1.2 system-ui, sans-serif;
                cursor: pointer;
            }

            .mha-arcade-toggle:hover,
            .mha-arcade-start:hover {
                filter: brightness(1.13);
            }

            #moth-hunt-atlas-drawer[data-arcade-open="1"] .mha-filters,
            #moth-hunt-atlas-drawer[data-arcade-open="1"] .mha-xp-summary,
            #moth-hunt-atlas-drawer[data-arcade-open="1"] .mha-body,
            #moth-hunt-atlas-drawer[data-arcade-open="1"] .mha-meta .mha-status,
            #moth-hunt-atlas-drawer[data-arcade-open="1"] .mha-meta .mha-count {
                display: none !important;
            }

            #moth-hunt-atlas-drawer .mha-arcade-panel[hidden] {
                display: none !important;
            }

            #moth-hunt-atlas-drawer .mha-arcade-panel {
                display: flex;
                flex-direction: column;
                align-items: center;
                flex: 1 1 auto;
                min-height: 0;
                gap: 10px;
                padding: 16px;
                overflow: auto;
                background: radial-gradient(ellipse at 50% 0%, #202d45, #141b29 75%);
                color: #e4f3ff;
                font: 13px/1.4 system-ui, sans-serif;
            }

            .mha-arcade-heading {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
                width: min(100%, 870px);
            }

            .mha-arcade-heading h3 {
                margin: 0;
                font-size: 21px;
                letter-spacing: -.3px;
                color: #ffdfa0;
            }

            .mha-arcade-heading p {
                margin: 4px 0 0;
                color: #aabfd3;
                font-size: 12px;
            }

            .mha-arcade-heading label {
                display: grid;
                gap: 4px;
                color: #9cbed3;
                font-weight: 700;
                white-space: nowrap;
            }

            .mha-arcade-heading select {
                padding: 7px 10px;
                border: 1px solid #4b627a;
                border-radius: 7px;
                color: #e9f2ff;
                background: #1b2b42;
                font: inherit;
            }

            .mha-arcade-stats {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: center;
                gap: 12px;
                width: min(100%, 870px);
            }

            .mha-arcade-stats span {
                padding: 6px 12px;
                border: 1px solid #35465f;
                border-radius: 8px;
                background: #19283d;
            }

            .mha-arcade-stats b {
                margin-left: 6px;
                color: #ffdb74;
                font-size: 17px;
                font-variant-numeric: tabular-nums;
            }

            .mha-arcade-destination {
                color: #c9d7e5;
                font-size: 14px;
                text-align: center;
            }

            .mha-arcade-destination strong {
                color: #ffe78d;
            }

            .mha-arcade-board {
                width: min(100%, 760px);
                border: 2px solid #496682;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 14px 35px rgba(0,0,0,.35);
                line-height: 0;
                flex: 0 0 auto;
            }

            .mha-arcade-board canvas {
                width: 100%;
                height: auto;
                aspect-ratio: 16 / 9;
                display: block;
                background: #0a1324;
                cursor: crosshair;
                touch-action: none;
            }

            .mha-arcade-board canvas:focus-visible {
                outline: 3px solid #ffdf75;
                outline-offset: -3px;
            }

            .mha-arcade-bottom {
                width: min(100%, 760px);
                display: flex;
                align-items: center;
                justify-content: center;
                flex-wrap: wrap;
                gap: 12px;
                min-height: 34px;
                color: #bcd0e1;
            }

            .mha-arcade-start {
                padding: 9px 15px;
                border: 1px solid #efc976;
                border-radius: 9px;
                background: #65491f;
                color: #ffe8a6;
                font: 800 13px system-ui, sans-serif;
                cursor: pointer;
            }

            .mha-arcade-start:disabled {
                opacity: .4;
                cursor: not-allowed;
            }

            .mha-arcade-pad {
                display: flex;
                flex-wrap: wrap;
                justify-content: center;
                gap: 10px;
            }

            .mha-arcade-pad button {
                min-width: 53px;
                min-height: 45px;
                border: 1px solid #456483;
                border-radius: 9px;
                color: #e3effc;
                background: #263a51;
                cursor: pointer;
                touch-action: none;
                user-select: none;
                font-size: 17px;
            }

            .mha-arcade-pad button:active {
                background: #547da4;
            }

            .mha-arcade-disclaimer {
                max-width: 760px;
                margin: 0;
                text-align: center;
                color: #91a6bb;
                font-size: 11px;
            }

            @media (max-width: 620px) {
                #moth-hunt-atlas-drawer .mha-arcade-panel {
                    padding: 10px;
                    gap: 8px;
                }

                .mha-arcade-heading h3 { font-size: 16px; }
                .mha-arcade-heading { gap: 8px; }
                .mha-arcade-heading p { font-size: 10px; }
                .mha-arcade-stats { gap: 5px; }
                .mha-arcade-stats span { padding: 4px 6px; }
                .mha-arcade-stats b { font-size: 14px; }
                .mha-arcade-heading select { padding: 5px; }
            }

            @media (max-width: 900px) {
                .mha-body {
                    grid-template-columns: 1fr;
                }
            }

            @media (max-width: 620px) {
                #modal .modal-caixa[data-mha-atlas-active="1"] {
                    width: 100vw !important;
                    max-width: 100vw !important;
                    height: 100dvh !important;
                    max-height: 100dvh !important;
                }

                .mha-filters {
                    grid-template-columns: 1fr 1fr;
                    padding: 8px;
                }

                .mha-search,
                .mha-filter-actions {
                    grid-column: 1 / -1;
                }

                .mha-body {
                    padding: 7px;
                }

                .mha-xp-primary {
                    grid-template-columns: minmax(0,1fr) auto;
                }

                .mha-xp-toggle {
                    grid-column: 1 / -1;
                    justify-self: start;
                    padding: 0;
                }

                #mha-native-credit {
                    gap: 4px;
                    overflow-x: auto;
                }
            }
        `;

        (
            document.head ||
            document.documentElement
        ).appendChild(
            style
        );
    }

    function isMapModalOpen() {
        const modal =
            q('#modal');

        const box =
            q(
                '#modal .modal-caixa'
            );

        return Boolean(
            modal &&
            box &&
            !modal.classList.contains(
                'hidden'
            ) &&
            box.dataset.modal ===
                'mapa'
        );
    }

    function authorLinksMarkup() {
        return `
            <span class="mha-credit">
                <span>${tr('footer.by')}</span>

                <a
                    class="mha-credit-icon"
                    href="https://play.google.com/store/apps/developer?id=MOTHblank"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="${escapeHtml(tr('footer.play'))}"
                    aria-label="${escapeHtml(tr('footer.play'))}"
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3.7 2.7c-.45.48-.7 1.2-.7 2.1v14.4c0 .9.25 1.62.7 2.1l.08.08L12.9 12 3.78 2.62l-.08.08Zm10.42 10.52-2.05-2.1L4.7 3.55c.17-.03.36-.01.57.1l11.7 6.65-2.85 2.92Zm-9.42 7.23 7.38-7.57 2.04-2.1 2.9 2.95-11.75 6.62c-.2.11-.4.13-.57.1Zm13.72-7.43-1.98-1.12 1.98-2.02c.95.54 1.48 1.08 1.48 1.57 0 .5-.53 1.03-1.48 1.57Z"/>
                    </svg>
                </a>

                <a
                    class="mha-credit-icon"
                    href="https://x.com/MOTHblank"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="${escapeHtml(tr('footer.x'))}"
                    aria-label="${escapeHtml(tr('footer.x'))}"
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M18.9 2H22l-6.77 7.74L23.2 22h-6.24l-4.89-6.39L6.48 22H3.36l7.25-8.29L2.96 2H9.36l4.42 5.84L18.9 2Zm-1.1 17.84h1.72L8.42 4.05H6.57L17.8 19.84Z"/>
                    </svg>
                </a>

                <a
                    class="mha-credit-icon"
                    href="https://wa.me/+5537999933376"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="${escapeHtml(tr('footer.whatsapp'))}"
                    aria-label="${escapeHtml(tr('footer.whatsapp'))}"
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 2a9.8 9.8 0 0 0-8.43 14.8L2 22l5.35-1.52A9.95 9.95 0 1 0 12 2Zm0 17.94a8 8 0 0 1-4.08-1.12l-.29-.17-3.18.9.86-3.1-.19-.3A7.9 7.9 0 1 1 12 19.94Zm4.35-5.9c-.24-.12-1.4-.69-1.62-.77-.22-.08-.38-.12-.54.12-.16.24-.62.77-.76.93-.14.16-.28.18-.52.06-.24-.12-1-.37-1.91-1.18-.7-.63-1.18-1.41-1.32-1.65-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.39-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.69 2.58 4.1 3.62.57.25 1.02.4 1.37.51.58.18 1.1.16 1.51.1.46-.07 1.4-.57 1.6-1.13.2-.55.2-1.03.14-1.13-.06-.1-.22-.16-.46-.28Z"/>
                    </svg>
                </a>

                <span class="mha-credit-sep">·</span>

                <a
                    href="https://github.com/MOTHblank/pokeidle-addons-premium/tree/main/huntatlas"
                    target="_blank"
                    rel="noopener noreferrer"
                >${tr('footer.source')}</a>
            </span>
        `;
    }

    function ensureNativeBranding() {
        const title =
            q('#modal-titulo');

        if (!title) {
            return;
        }

        if (
            !state.nativeMapTitle &&
            title.textContent !==
                tr('title')
        ) {
            state.nativeMapTitle =
                title.textContent;
        }

        title.textContent =
            tr('title');

        let host =
            q('#mha-native-credit');

        if (
            !host ||
            host.parentElement !==
                title.parentElement
        ) {
            host?.remove();

            host =
                document.createElement(
                    'span'
                );

            host.id =
                'mha-native-credit';
            host.innerHTML =
                authorLinksMarkup();

            title.insertAdjacentElement(
                'afterend',
                host
            );
        }
    }

    function restoreNativeMapView() {
        if (arcade.open || arcade.running) arcadeClose();
        const box =
            q(
                '#modal .modal-caixa'
            );

        box?.removeAttribute(
            'data-mha-atlas-active'
        );

        const drawer =
            q(
                '#' + DRAWER_ID
            );

        if (drawer) {
            drawer.hidden =
                true;
        }

        q(
            '#mha-native-credit'
        )?.remove();

        const title =
            q('#modal-titulo');

        if (
            title &&
            state.nativeMapTitle
        ) {
            title.textContent =
                state.nativeMapTitle;
        }
    }

    function cleanupMapIntegration() {
        restoreNativeMapView();

        q(
            '#mha-map-toggle'
        )?.remove();

        state.drawerOpen =
            false;
        state.nativeMapTitle =
            null;
    }

    function ensureMapToggle() {
        if (!isMapModalOpen()) {
            return null;
        }

        const title =
            q('#modal-titulo');

        if (!title) {
            return null;
        }

        if (
            state.atlasEnabled
        ) {
            ensureNativeBranding();
        }

        let toggle =
            q('#mha-map-toggle');

        if (
            !toggle ||
            toggle.parentElement !==
                title.parentElement
        ) {
            toggle?.remove();

            toggle =
                document.createElement(
                    'button'
                );

            toggle.type =
                'button';
            toggle.id =
                'mha-map-toggle';

            const credit =
                q(
                    '#mha-native-credit'
                );

            (
                credit ||
                title
            ).insertAdjacentElement(
                'afterend',
                toggle
            );

            toggle.addEventListener(
                'click',
                () => {
                    state.atlasEnabled =
                        !state.atlasEnabled;

                    saveAtlasEnabled(
                        state.atlasEnabled
                    );

                    if (
                        !state.atlasEnabled
                    ) {
                        restoreNativeMapView();
                    }

                    scheduleMapSync();
                }
            );
        }

        toggle.dataset.enabled =
            state.atlasEnabled
                ? '1'
                : '0';

        toggle.textContent =
            tr(
                state.atlasEnabled
                    ? 'toggle.on'
                    : 'toggle.off'
            );

        toggle.title =
            tr(
                state.atlasEnabled
                    ? 'toggle.onTitle'
                    : 'toggle.offTitle'
            );

        toggle.setAttribute(
            'aria-pressed',
            state.atlasEnabled
                ? 'true'
                : 'false'
        );

        return toggle;
    }

    function scheduleMapSync() {
        if (
            state.mapSyncQueued
        ) {
            return;
        }

        state.mapSyncQueued =
            true;

        queueMicrotask(
            () => {
                state.mapSyncQueued =
                    false;

                const open =
                    isMapModalOpen();

                const wasOpen =
                    state.drawerOpen;

                if (!open) {
                    cleanupMapIntegration();
                    return;
                }

                ensureMapToggle();

                if (
                    !state.atlasEnabled
                ) {
                    state.drawerOpen =
                        false;
                    restoreNativeMapView();
                    return;
                }

                state.drawerOpen =
                    true;

                if (!wasOpen) {
                    ensureTypeData();
                    ensureCombatCatalog();
                    ensureLocationIndex();
                    ensureMoveIndex();
                    ensureMarketValues();
                }

                renderDrawer();

                if (!wasOpen) {
                    queueMicrotask(
                        () =>
                            q(
                                '[data-mha-filter="search"]',
                                q(
                                    '#' +
                                    DRAWER_ID
                                )
                            )?.focus()
                    );
                }
            }
        );
    }

    function installMapObserver() {
        if (
            state.mapObserver
        ) {
            return;
        }

        const modal =
            q('#modal');

        const box =
            q(
                '#modal .modal-caixa'
            );

        const body =
            q('#modal-corpo');

        if (
            !modal ||
            !box ||
            !body
        ) {
            return;
        }

        state.mapObserver =
            new MutationObserver(
                scheduleMapSync
            );

        state.mapObserver.observe(
            modal,
            {
                attributes: true,
                attributeFilter: [
                    'class'
                ]
            }
        );

        state.mapObserver.observe(
            box,
            {
                attributes: true,
                attributeFilter: [
                    'data-modal'
                ]
            }
        );

        state.mapObserver.observe(
            body,
            {
                childList: true
            }
        );
    }

    function ensureButton() {
        q(
            '#' + BUTTON_ID
        )?.remove();

        return true;
    }

    function ensureDrawer() {
        if (
            !document.body ||
            !isMapModalOpen() ||
            !state.atlasEnabled
        ) {
            return null;
        }

        injectStyles();

        const modalBody =
            q('#modal-corpo');

        const modalBox =
            q(
                '#modal .modal-caixa'
            );

        if (
            !modalBody ||
            !modalBox
        ) {
            return null;
        }

        modalBox.setAttribute(
            'data-mha-atlas-active',
            '1'
        );

        let drawer =
            q('#' + DRAWER_ID);

        if (drawer) {
            if (
                drawer.parentElement !==
                    modalBody
            ) {
                modalBody.appendChild(
                    drawer
                );
            }

            return drawer;
        }

        drawer =
            document.createElement(
                'aside'
            );

        drawer.id =
            DRAWER_ID;

        drawer.hidden =
            true;

        drawer.innerHTML = `
            <div class="mha-filters">
                <label class="mha-field mha-search">
                    <span>${tr('filter.search')}</span>
                    <input data-mha-filter="search" type="search" placeholder="${escapeHtml(tr('filter.searchPlaceholder'))}">
                </label>

                <label class="mha-field">
                    <span>${tr('filter.region')}</span>
                    <select data-mha-filter="region"></select>
                </label>

                <div class="mha-field">
                    <span>${tr('filter.level')}</span>
                    <div class="mha-level-inputs">
                        <input data-mha-filter="minLevel" type="number" min="1" step="1" inputmode="numeric" placeholder="${escapeHtml(tr('filter.min'))}" aria-label="${escapeHtml(tr('filter.minLevelAria'))}">
                        <span>–</span>
                        <input data-mha-filter="maxLevel" type="number" min="1" step="1" inputmode="numeric" placeholder="${escapeHtml(tr('filter.max'))}" aria-label="${escapeHtml(tr('filter.maxLevelAria'))}">
                    </div>
                </div>

                <label class="mha-field">
                    <span>${tr('filter.availability')}</span>
                    <select data-mha-filter="availability">
                        <option value="all">${tr('filter.all')}</option>
                        <option value="unlocked">${tr('filter.unlocked')}</option>
                        <option value="locked">${tr('filter.locked')}</option>
                    </select>
                </label>

                <label class="mha-field">
                    <span>${tr('filter.type')}</span>
                    <select data-mha-filter="type"></select>
                </label>

                <div class="mha-field">
                    <span>${tr('filter.weakTo')}</span>
                    <div
                        class="mha-weakness-options"
                        data-mha-weakness-options
                        role="group"
                        aria-label="${escapeHtml(tr('filter.weakTo'))}"
                    ></div>
                    <div class="mha-weakness-mode">
                        <button type="button" data-mha-weakness-mode="any">${tr('filter.matchAnyWeaknesses')}</button>
                        <button type="button" data-mha-weakness-mode="all">${tr('filter.matchAllWeaknesses')}</button>
                        <button type="button" data-mha-clear-weakness>${tr('filter.clearWeakness')}</button>
                    </div>
                </div>

                <label class="mha-field">
                    <span>${tr('filter.collection')}</span>
                    <select data-mha-filter="captured">
                        <option value="all">${tr('filter.caughtAndUncaught')}</option>
                        <option value="uncaught">${tr('filter.uncaughtOnly')}</option>
                        <option value="captured">${tr('filter.caughtOnly')}</option>
                    </select>
                </label>

                <label class="mha-field">
                    <span>${tr('filter.sort')}</span>
                    <div class="mha-sort-control">
                        <select data-mha-filter="sort">
                            <option value="xp">${tr('sort.xp')}</option>
                            <option value="pokemonXp">${tr('sort.pokemonXp')}</option>
                            <option value="coins">${tr('sort.coins')}</option>
                            <option value="netCoins">${tr('sort.netCoins')}</option>
                            <option value="npcLoot">${tr('sort.npcLoot')}</option>
                            <option value="rare">${tr('sort.rare')}</option>
                            <option value="ballEfficiency">${tr('sort.ballEfficiency')}</option>
                            <option value="capture">${tr('sort.capture')}</option>
                            <option value="shinyCatch">${tr('sort.shinyCatch')}</option>
                            <option value="name">${tr('sort.name')}</option>
                            <option value="pokedex">${tr('sort.pokedex')}</option>
                            <option value="level">${tr('sort.level')}</option>
                            <option value="npc">${tr('sort.npc')}</option>
                            <option value="player_market">${tr('sort.player')}</option>
                            <option value="matchup">${tr('sort.matchup')}</option>
                        </select>

                        <button
                            type="button"
                            class="mha-sort-dir"
                            data-mha-sort-dir
                        ></button>
                    </div>
                </label>

                <div class="mha-filter-actions">
                    <span class="mha-filter-state"></span>
                    <button type="button" data-mha-clear>${tr('filter.clear')}</button>
                </div>
            </div>

            <div class="mha-xp-summary"></div>

            <div class="mha-meta">
                <span class="mha-status"></span>
                <span class="mha-count"></span>
                <button type="button" class="mha-arcade-toggle" data-mha-arcade-toggle
                    aria-pressed="false">${tr('arcade.open')}</button>
            </div>

            <section class="mha-arcade-panel" data-mha-arcade-panel hidden>
                <header class="mha-arcade-heading">
                    <div>
                        <h3>${tr('arcade.title')}</h3>
                        <p>${tr('arcade.subtitle')}</p>
                    </div>
                    <label>${tr('arcade.region')}
                        <select data-mha-arcade-region aria-label="${tr('arcade.region')}"></select>
                    </label>
                </header>
                <div class="mha-arcade-stats">
                    <span>${tr('arcade.score')} <b data-mha-arcade-score>0</b></span>
                    <span>${tr('arcade.best')} <b data-mha-arcade-best>0</b></span>
                    <span>${tr('arcade.hearts')} <b data-mha-arcade-hearts>♥♥♥</b></span>
                    <span>${tr('arcade.time')} <b data-mha-arcade-time>60</b>s</span>
                </div>
                <div class="mha-arcade-destination">${tr('arcade.target')}: <strong data-mha-arcade-target>—</strong></div>
                <div class="mha-arcade-board">
                    <canvas data-mha-arcade-canvas width="640" height="360" tabindex="0"
                        aria-label="${tr('arcade.instructions')}"></canvas>
                </div>
                <div class="mha-arcade-bottom">
                    <button type="button" class="mha-arcade-start" data-mha-arcade-start>${tr('arcade.start')}</button>
                    <span data-mha-arcade-message role="status">${tr('arcade.loading')}</span>
                </div>
                <div class="mha-arcade-pad" aria-label="${tr('arcade.instructions')}">
                    <button type="button" data-mha-arcade-dir="arrowleft" aria-label="${tr('arcade.left')}">◀</button>
                    <button type="button" data-mha-arcade-dir="arrowup" aria-label="${tr('arcade.up')}">▲</button>
                    <button type="button" data-mha-arcade-dir="arrowdown" aria-label="${tr('arcade.down')}">▼</button>
                    <button type="button" data-mha-arcade-dir="arrowright" aria-label="${tr('arcade.right')}">▶</button>
                </div>
                <p class="mha-arcade-disclaimer">${tr('arcade.disclaimer')}</p>
            </section>

            <div class="mha-body"></div>


        `;

        modalBody.appendChild(
            drawer
        );
        q('[data-mha-arcade-toggle]', drawer)?.addEventListener('click', () => {
            if (arcade.open) arcadeClose();
            else arcade.open = true;
            renderDrawer();
        });
        q('[data-mha-arcade-region]', drawer)?.addEventListener('change', event => {
            arcadePrepare(String(event.currentTarget.value || ''));
            arcadeRender(drawer);
        });
        q('[data-mha-arcade-start]', drawer)?.addEventListener('click', arcadeStart);
        for (const button of qa('[data-mha-arcade-dir]', drawer)) {
            const key = button.dataset.mhaArcadeDir;
            button.addEventListener('pointerdown', event => {
                event.preventDefault();
                if (!arcade.running) return;
                arcade.keys.add(key);
                button.setPointerCapture(event.pointerId);
            });
            for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
                button.addEventListener(type, () => arcade.keys.delete(key));
            }
        }



        q(
            '[data-mha-clear]',
            drawer
        ).addEventListener(
            'click',
            () => {
                const sort =
                    state.filters.sort;

                const sortDirection =
                    state.filters
                        .sortDirection;

                state.filters = {
                    ...defaultFilters(),
                    sort,
                    sortDirection
                };
                state.resultLimit =
                    120;
                saveFilters();
                renderDrawer();

                q(
                    '[data-mha-filter="search"]',
                    drawer
                )?.focus();
            }
        );

        if (
            !state.keyboardBound
        ) {
            state.keyboardBound =
                true;

            document.addEventListener(
                'keydown',
                event => {
                    if (
                        !isMapModalOpen() ||
                        event.key !== '/' ||
                        [
                            'INPUT',
                            'SELECT',
                            'TEXTAREA'
                        ].includes(
                            document.activeElement
                                ?.tagName
                        )
                    ) {
                        return;
                    }

                    event.preventDefault();

                    q(
                        '[data-mha-filter="search"]',
                        q(
                            '#' +
                            DRAWER_ID
                        )
                    )?.focus();
                }
            );
        }

        q(
            '[data-mha-sort-dir]',
            drawer
        )?.addEventListener(
            'click',
            () => {
                state.filters
                    .sortDirection =
                    state.filters
                        .sortDirection ===
                    'asc'
                        ? 'desc'
                        : 'asc';

                state.resultLimit =
                    120;

                saveFilters();
                renderDrawer();
            }
        );

        const weaknessAnyMode =
            q('[data-mha-weakness-mode="any"]', drawer);
        const weaknessAllMode =
            q('[data-mha-weakness-mode="all"]', drawer);

        weaknessAnyMode?.addEventListener('click', () => {
            if (state.filters.weaknessMatchAll) {
                state.filters.weaknessMatchAll = false;
                state.resultLimit = 120;
                saveFilters();
                renderDrawer();
            }
        });

        weaknessAllMode?.addEventListener('click', () => {
            if (state.filters.weakness.length > 1 && !state.filters.weaknessMatchAll) {
                state.filters.weaknessMatchAll = true;
                state.resultLimit = 120;
                saveFilters();
                renderDrawer();
            }
        });

        q('[data-mha-weakness-options]', drawer)?.addEventListener('click', event => {
            const option = event.target.closest('[data-mha-weakness-option]');
            if (!option) {
                return;
            }

            const type = String(option.dataset.mhaWeaknessOption || '').toUpperCase();
            if (!STANDARD_TYPES.includes(type)) {
                return;
            }

            const selected = new Set(
                Array.isArray(state.filters.weakness)
                    ? state.filters.weakness
                    : []
            );

            if (selected.has(type)) {
                selected.delete(type);
            } else {
                selected.add(type);
            }

            state.filters.weakness = STANDARD_TYPES.filter(value => selected.has(value));
            if (state.filters.weakness.length < 2) {
                state.filters.weaknessMatchAll = false;
            }

            state.resultLimit = 120;
            saveFilters();
            renderDrawer();
        });

        q('[data-mha-clear-weakness]', drawer)?.addEventListener('click', () => {
            state.filters.weakness = [];
            state.filters.weaknessMatchAll = false;
            state.resultLimit = 120;
            saveFilters();
            renderDrawer();
        });

        for (
            const control of
            qa(
                '[data-mha-filter]',
                drawer
            )
        ) {
            const key =
                control.dataset
                    .mhaFilter;

            const eventName =
                (
                    key === 'search' ||
                    key === 'minLevel' ||
                    key === 'maxLevel'
                )
                    ? 'input'
                    : 'change';

            control.addEventListener(
                eventName,
                () => {
                    if (key === 'weakness') {
                        const selected =
                            [...control.selectedOptions]
                                .map(option => String(option.value).toUpperCase())
                                .filter(value => STANDARD_TYPES.includes(value));

                        state.filters.weakness = [...new Set(selected)];

                        if (state.filters.weakness.length < 2) {
                            state.filters.weaknessMatchAll = false;
                        }
                    } else {
                        state.filters[key] = control.value;
                    }

                    state.resultLimit = 120;
                    saveFilters();
                    renderDrawer();
                }
            );
        }

        return drawer;
    }

    function selectOptions(
        values,
        selected,
        allValue,
        allLabel,
        labelForValue =
            value => value
    ) {
        return [
            `<option value="${escapeHtml(allValue)}">${escapeHtml(allLabel)}</option>`,
            ...values.map(
                value =>
                    `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(labelForValue(value))}</option>`
            )
        ].join('');
    }

    function renderFilterControls(
        drawer
    ) {
        const search =
            q(
                '[data-mha-filter="search"]',
                drawer
            );

        if (
            search &&
            search.value !==
                state.filters.search
        ) {
            search.value =
                state.filters.search;
        }

        const region =
            q(
                '[data-mha-filter="region"]',
                drawer
            );

        const regionHtml =
            selectOptions(
                regionOptions(),
                state.filters.region,
                'all',
                tr(
                    'filter.allRegions'
                )
            );

        if (
            region.innerHTML !==
            regionHtml
        ) {
            region.innerHTML =
                regionHtml;
        }

        region.value =
            state.filters.region;

        for (
            const key of [
                'minLevel',
                'maxLevel'
            ]
        ) {
            const control =
                q(
                    `[data-mha-filter="${key}"]`,
                    drawer
                );

            if (
                control &&
                control.value !==
                    String(
                        state.filters[key] ??
                        ''
                    )
            ) {
                control.value =
                    state.filters[key] ??
                    '';
            }
        }

        const type =
            q(
                '[data-mha-filter="type"]',
                drawer
            );

        const typeHtml =
            selectOptions(
                STANDARD_TYPES,
                state.filters.type,
                'all',
                state.typeStatus ===
                    'loading'
                    ? tr(
                        'filter.typeLoading'
                    )
                    : tr(
                        'filter.allTypes'
                    ),
                typeLabel
            );

        if (
            type.innerHTML !==
            typeHtml
        ) {
            type.innerHTML =
                typeHtml;
        }

        type.value =
            state.filters.type;

        const weaknessOptions =
            q(
                '[data-mha-weakness-options]',
                drawer
            );

        const weaknessSelected =
            Array.isArray(state.filters.weakness)
                ? state.filters.weakness
                : [];

        const selectedWeaknessSet =
            new Set(weaknessSelected);

        const weaknessHtml =
            STANDARD_TYPES
                .map(value => {
                    const selected = selectedWeaknessSet.has(value);
                    return `<button
                        type="button"
                        class="mha-weakness-option${selected ? ' active' : ''}"
                        data-mha-weakness-option="${escapeHtml(value)}"
                        aria-pressed="${selected ? 'true' : 'false'}"
                    >${escapeHtml(typeLabel(value))}</button>`;
                })
                .join('');

        if (weaknessOptions && weaknessOptions.innerHTML !== weaknessHtml) {
            weaknessOptions.innerHTML = weaknessHtml;
        }

        if (weaknessOptions) {
            weaknessOptions.title =
                weaknessSelected.length
                    ? tr('filter.weaknessSelected').replace('{count}', String(weaknessSelected.length))
                    : tr('filter.anyWeakness');
        }

        const weaknessAnyMode = q('[data-mha-weakness-mode="any"]', drawer);
        const weaknessAllMode = q('[data-mha-weakness-mode="all"]', drawer);
        const matchAll = Boolean(state.filters.weaknessMatchAll) && weaknessSelected.length > 1;

        if (weaknessAnyMode) {
            weaknessAnyMode.classList.toggle('active', !matchAll);
        }
        if (weaknessAllMode) {
            weaknessAllMode.classList.toggle('active', matchAll);
            weaknessAllMode.disabled = weaknessSelected.length < 2;
        }
        for (
            const key of [
                'availability',
                'captured',
                'sort'
            ]
        ) {
            const control =
                q(
                    `[data-mha-filter="${key}"]`,
                    drawer
                );

            if (control) {
                control.value =
                    state.filters[key];
            }
        }

        const sortDirection =
            q(
                '[data-mha-sort-dir]',
                drawer
            );

        if (sortDirection) {
            const ascending =
                state.filters
                    .sortDirection ===
                'asc';

            sortDirection.textContent =
                ascending
                    ? '↑'
                    : '↓';

            sortDirection.title =
                tr(
                    ascending
                        ? 'sort.asc'
                        : 'sort.desc'
                );

            sortDirection.setAttribute(
                'aria-label',
                sortDirection.title
            );
        }

        const activeCount =
            activeFilterCount();

        const filterState =
            q(
                '.mha-filter-state',
                drawer
            );

        if (filterState) {
            filterState.textContent =
                activeCount
                    ? tr(
                        activeCount === 1
                            ? 'filter.changedOne'
                            : 'filter.changedMany',
                        {
                            count:
                                activeCount
                        }
                    )
                    : tr(
                        'filter.defaults'
                    );
        }

        const clearButton =
            q(
                '[data-mha-clear]',
                drawer
            );

        if (clearButton) {
            clearButton.disabled =
                activeCount === 0;
        }
    }



    function speciesMarkup(
        species
    ) {
        const capturedMarkup =
            species.captured
                ? `<span class="mha-caught">✓ ${escapeHtml(
                    tr(
                        'capture.caught'
                    )
                )}${species.captureCount > 1 ? ' ×' + species.captureCount : ''}</span>`
                : `<span class="mha-uncaught">○ ${escapeHtml(
                    tr(
                        'capture.notCaught'
                    )
                )}</span>`;

        const typeMarkup =
            species.types.length
                ? `<span class="mha-types">${species.types.map(type => `<span class="mha-type">${escapeHtml(typeLabel(type))}</span>`).join('')}</span>`
                : `<span class="mha-types"><span class="mha-type">${escapeHtml(
                    tr(
                        'capture.typeUnknown'
                    )
                )}</span></span>`;

        const selectedWeaknesses =
            Array.isArray(state.filters.weakness)
                ? state.filters.weakness
                : [];

        const weaknessMarkup =
            selectedWeaknesses
                .map(attackType => {
                    const multiplier = weaknessMultiplier(species.types, attackType);
                    if (multiplier <= 1) {
                        return '';
                    }
                    return '<span class="mha-matchup good mha-selected-weakness">' +
                        escapeHtml(typeLabel(attackType)) + ' ' +
                        escapeHtml(formatMultiplier(multiplier)) + '</span>';
                })
                .filter(Boolean)
                .join('');
        const matchup =
            speciesMatchup(
                species
            );

        const leadName =
            matchup?.lead?.nome ||
            tr(
                'common.lead'
            );

        const npcStats =
            npcSellStatsForSpecies(
                species
            );

        const npcRange =
            npcStats &&
            npcStats.min !==
                npcStats.max
                ? tr(
                    'price.range',
                    {
                        min:
                            localizedNumber(
                                Math.round(
                                    npcStats.min
                                )
                            ),
                        max:
                            localizedNumber(
                                Math.round(
                                    npcStats.max
                                )
                            )
                    }
                )
                : '';

        const npcMarkup =
            `
                <span
                    class="mha-npc-value"
                    title="${escapeHtml(
                        npcStats?.average > 0
                            ? tr(
                                'price.npcTip',
                                {
                                    plural:
                                        npcStats.count === 1
                                            ? ''
                                            : 's',
                                    range:
                                        npcRange
                                }
                            )
                            : tr(
                                'price.npcMissingTip'
                            )
                    )}"
                >${escapeHtml(
                    npcStats?.average > 0
                        ? tr(
                            'price.npc',
                            {
                                value:
                                    formatRate(
                                        npcStats.average
                                    )
                            }
                        )
                        : tr(
                            'price.npcMissing'
                        )
                )}</span>
            `;

        const market =
            species.market;

        const marketMarkup =
            `
                <span
                    class="mha-market"
                    title="${escapeHtml(
                        market?.source ===
                            'listing'
                            ? tr(
                                'price.playerListingTip'
                            )
                            : market?.count
                                ? tr(
                                    'price.playerTip',
                                    {
                                        count:
                                            market.count,
                                        sample:
                                            tr(
                                                market.count === 1
                                                    ? 'price.sample'
                                                    : 'price.samples'
                                            ),
                                        min:
                                            localizedNumber(
                                                Math.round(
                                                    market.min
                                                )
                                            ),
                                        max:
                                            localizedNumber(
                                                Math.round(
                                                    market.max
                                                )
                                            )
                                    }
                                )
                                : tr(
                                    'price.playerMissingTip'
                                )
                    )}"
                >${escapeHtml(
                    Number(
                        market?.average ||
                        0
                    ) > 0
                        ? tr(
                            'price.players',
                            {
                                value:
                                    formatRate(
                                        market.average
                                    )
                            }
                        )
                        : tr(
                            'price.playersMissing'
                        )
                )}</span>
            `;

        const matchupMarkup =
            matchup
                ? `
                    <span class="mha-matchups">
                        ${matchupBadgeMarkup(
                            'deal',
                            matchup.offense,
                            leadName,
                            species.name
                        )}
                        ${matchupBadgeMarkup(
                            'take',
                            matchup.defense,
                            leadName,
                            species.name
                        )}
                    </span>
                `
                : '';

        const hunt =
            species.hunt;

        const unlocked =
            isUnlocked(
                hunt
            );

        const current =
            isHuntHere(
                hunt.slug
            );

        const xpInfo =
            huntXpEstimate(
                hunt
            );

        const economicInfo = huntEconomyEstimate(hunt,xpInfo);
        const xpLabel =
            xpInfo?.value
                ? tr(
                    xpInfo.observed
                        ? 'hunt.measuredXp'
                        : 'hunt.modeledXp',
                    {
                        value:
                            formatRate(
                                xpInfo.value
                            )
                    }
                )
                : tr(
                    'xp.baseline'
                );

        const meta=speciesCombatMeta(species.id);
        const rarity=captureRarityFromCatalog(meta);
        const ultraPct=captureWikiChance(rarity,
            captureInfoForBall(4)?.efficiency??4);
        const beastPct=captureWikiChance(rarity,
            captureInfoForBall(5)?.efficiency??8);
        const catchCard=ultraPct!==null&&beastPct!==null ?
            tr('catch.card',{ultra:(100*ultraPct).toFixed(2),
                beast:(100*beastPct).toFixed(2)}):
            tr('catch.cardUnknown');

        const chosenSpeciesPlan=capturePlanForSpecies(species,
            state.filters.captureBall==='beast'?5:4,xpInfo);
        const shinyCard=chosenSpeciesPlan?
            tr('catch.targetRate',{captures:chosenSpeciesPlan.catchesH.toFixed(2),
                shiny:chosenSpeciesPlan.shinyCaughtH===null?'—':
                    chosenSpeciesPlan.shinyCaughtH<.000001 &&
                    chosenSpeciesPlan.shinyCaughtH>0?
                        chosenSpeciesPlan.shinyCaughtH.toExponential(2):
                        chosenSpeciesPlan.shinyCaughtH.toFixed(6),
                hours:chosenSpeciesPlan.meanHoursShiny===null?'—':
                    formatRate(chosenSpeciesPlan.meanHoursShiny),
                source:tr(chosenSpeciesPlan.acceptedSource==='observed'
                    ?'catch.targetObserved':'catch.targetCeiling')}) :
            null;

        const worldLocation = locationForHunt(hunt);
        const sharedHunts = sharedWorldLocation(hunt);
        const sub =
            [
                String(
                    hunt.area ||
                    worldLocation?.area ||
                    ''
                ).toUpperCase(),
                tr(
                    'hunt.level',
                    {
                        level:
                            Number(
                                hunt.nivel ||
                                0
                            )
                    }
                ),
                tr(
                    unlocked
                        ? 'hunt.unlocked'
                        : 'hunt.locked'
                ),
                xpLabel,
                catchCard,
                shinyCard,
                meta?.captureLevelCeiling ? tr('catch.levelCap',{
                    level:Math.min(Number(hunt.nivel)||1,
                        meta.captureLevelCeiling)}):null,
                typeof economicInfo.killCoinsH === 'number'
                    ? tr('econ.kill') + ': ' + formatRate(economicInfo.killCoinsH)
                        + ' (' + (economicInfo.killSource === 'observed-server/event'
                            ? tr('econ.observed') : tr('econ.model')) + ')'
                    : null,
                typeof economicInfo.netH === 'number'
                    ? tr('econ.net') + ': ' + formatRate(economicInfo.netH)
                    : null,
                xpInfo?.incomplete ? tr('xp.incompleteShort', { percentage: xpInfo.coverage }) : null,
                sharedHunts.length ? tr('location.shared', { hunts: sharedHunts.join(', ') }) : null
            ]
                .filter(Boolean)
                .join(' · ');

        const label =
            tr(
                current
                    ? 'hunt.here'
                    : unlocked
                        ? 'hunt.go'
                        : 'hunt.locked'
            );

        const huntMarkup =
            `
                <div class="mha-hunt ${current ? 'current' : ''} ${!unlocked ? 'locked' : ''}">
                    <div class="mha-hunt-main">
                        <div class="mha-hunt-title" ${worldLocation ? 'title="' + escapeHtml(tr('location.coordinates', { region: worldLocation.area, x: worldLocation.pixel[0], y: worldLocation.pixel[1] })) + '"' : ''}>${escapeHtml(hunt.nome || hunt.slug)}</div>
                        <div class="mha-hunt-sub">${escapeHtml(sub)}</div>
                    </div>

                    <button
                        type="button"
                        class="mha-go ${current ? 'current' : ''}"
                        data-mha-go="${escapeHtml(hunt.slug)}"
                        ${!unlocked || current ? 'disabled' : ''}
                        title="${escapeHtml(
                            !unlocked
                                ? tr(
                                    'hunt.requiresLevel',
                                    {
                                        level:
                                            Number(
                                                hunt.nivel ||
                                                0
                                            )
                                    }
                                )
                                : current
                                    ? tr(
                                        'hunt.current'
                                    )
                                    : tr(
                                        'hunt.travel'
                                    )
                        )}"
                    >${label}</button>
                </div>
            `;

        return `
            <section class="mha-species">
                <div class="mha-species-head">
                    <span class="mha-species-name">${escapeHtml(species.name)}</span>
                    ${npcMarkup}
                    ${marketMarkup}
                    ${matchupMarkup}
                    ${typeMarkup}
                    ${weaknessMarkup}
                    ${capturedMarkup}
                </div>

                <div class="mha-hunts">
                    ${huntMarkup}
                </div>
            </section>
        `;
    }

    function renderXpSummary(
        drawer,
        results
    ) {
        const host =
            q(
                '.mha-xp-summary',
                drawer
            );

        if (!host) {
            return;
        }

        const lead =
            leadPokemon();

        const ranked =
            rankedUnlockedHunts(
                results
            );

        const usable =
            ranked.filter(
                row =>
                    Number(
                        row.xp?.value ||
                        0
                    ) > 0
            );

        const best = usable[0] || null;
        const xpSourceLabel = estimate => estimate?.observed
            ? tr('xp.sourceMeasured')
            : estimate?.source === 'immune combat model'
                ? tr('xp.sourceImmunity')
                : estimate?.source === 'baseline model'
                    ? tr('xp.sourceBaseline')
                    : tr('xp.sourceModel');
        const rangeLabel = estimate => estimate?.range
            ? tr('xp.ranged', {low: formatRate(estimate.range.low),
                high: formatRate(estimate.range.high)}) : '';
        const displayEvidence = estimate => [
            tr('xp.sourceLabel', {source: xpSourceLabel(estimate)}),
            rangeLabel(estimate),
            estimate?.observed ? null : tr('xp.unboosted'),
            estimate?.fallbackReason
                ? tr('xp.fallback', {reason: estimate.fallbackReason}) : null
        ].filter(Boolean).join(' · ');

        const current =
            currentHunt();

        const currentXp =
            current
                ? huntXpEstimate(
                    current
                )
                : null;

        const profile =
            combatProfile();

        const measuredHunts =
            recordsForLead()
                .filter(
                    record =>
                        observedRates(
                            record
                        )
                )
                .length;

        const leadText =
            lead
                ? tr(
                    'xp.lead',
                    {
                        name:
                            lead.nome ||
                            lead.name ||
                            'Pokémon',
                        level:
                            Number(
                                lead.level ||
                                0
                            ),
                        power:
                            Math.round(
                                pokemonPower(
                                    lead
                                )
                            )
                    }
                )
                : tr('xp.baseline');

        const profileDetails =
            profile
                ? [
                    profile.warmStart
                        ? tr(
                            'xp.warmStart'
                        )
                        : null,
                    profile.kills
                        ? tr(
                            'xp.kills',
                            {
                                count:
                                    profile.kills
                            }
                        )
                        : null,
                    profile.attacks
                        ? tr(
                            'xp.attacks',
                            {
                                count:
                                    profile.attacks
                            }
                        )
                        : null,
                    profile.cadenceMs
                        ? tr(
                            'xp.cadence',
                            {
                                seconds:
                                    (
                                        profile.cadenceMs /
                                        1000
                                    ).toFixed(2),
                                detail:
                                    profile.cadenceMeasured
                                        ? ''
                                        : profile.cadenceFromThroughput
                                            ? tr(
                                                'xp.throughput'
                                            )
                                            : tr(
                                                'xp.floor'
                                            )
                            }
                        )
                        : null,
                    profile.movementMs
                        ? tr(
                            'xp.travel',
                            {
                                seconds:
                                    (
                                        profile.movementMs /
                                        1000
                                    ).toFixed(2)
                            }
                        )
                        : null,
                    profile.hpSamples
                        ? tr(
                            'xp.hpSamples',
                            {
                                count:
                                    profile.hpSamples
                            }
                        )
                        : null,
                    movesForLead().length
                        ? tr('xp.possibleMoves', { count: movesForLead().length })
                        : null,
                    moveSourceForLead() === 'catalog'
                        ? tr('xp.catalogMoves', { count: movesForLead().length }) : null,
                    indexConflictsForLead().length
                        ? tr('xp.moveDisagreements', {
                            count: indexConflictsForLead().length
                        }) : null,
                    profile.namedMoveSamples
                        ? tr('xp.knownMoves', {
                            count: Object.keys(profile.observedNamedMoves || {}).length
                        })
                        : profile.attacks && movesForLead().length
                            ? tr('xp.namesUnavailable') : null,
                    profile.namedMoveSamples
                        ? tr('xp.moveConfidence', {
                            confidence: tr('xp.confidence.' + moveModelConfidence(profile))
                        })
                        : null,
                    tr('xp.protocol', {
                        total: state.battleDiagnostics.playerEvents,
                        named: state.battleDiagnostics.namedEvents,
                        unnamed: state.battleDiagnostics.unnamedEvents
                    }),
                    state.battleDiagnostics.lastUnnamedKeys.length
                        ? tr('xp.protocolKeys', {
                            keys: state.battleDiagnostics.lastUnnamedKeys.join(', ')
                        }) : null
                ]
                    .filter(Boolean)
                    .join(' · ')
                : '';

        const calibrationText =
            profile?.attacks
                ? (
                    measuredHunts
                        ? tr(
                            measuredHunts === 1
                                ? 'xp.measuredHunt'
                                : 'xp.measuredHunts',
                            {
                                count:
                                    measuredHunts
                            }
                        )
                        : tr('xp.baseline')
                ) +
                  (
                      profileDetails
                          ? ' · ' +
                            profileDetails
                          : ''
                  )
                : tr('xp.baseline');
        const movesSummary = (profile?.namedMoveSamples
            ? Object.values(profile.observedNamedMoves || {})
                .sort((a, b) => b.samples - a.samples)
                .slice(0, 4)
                .map(row => row.name + ' (' + row.type + ', ' + row.samples + ')')
            : movesForLead().filter(move => move.category !== 'STATUS')
                .sort((a, b) => b.power - a.power)
                .slice(0, 3)
                .map(move => move.name + ' (' + move.type + ')'));
        const moveSummaryText = movesSummary.length
            ? tr(profile?.namedMoveSamples
                ? 'xp.observedMoveSummary' : 'xp.indexedMoveSummary',
                { moves: movesSummary.join(', ') })
            : '';

        const bestRows =
            usable
                .slice(0, 5)
                .map(
                    (row, index) => {
                        const here =
                            isHuntHere(
                                row.hunt.slug
                            );

                        return `
                            <div class="mha-best-row">
                                <span class="mha-best-rank">${index + 1}</span>
                                <span class="mha-best-name">${escapeHtml(row.hunt.nome || row.hunt.slug)} · ${escapeHtml(
                                    tr(
                                        'hunt.level',
                                        {
                                            level:
                                                Number(
                                                    row.hunt.nivel ||
                                                    0
                                                )
                                        }
                                    )
                                )}</span>
                                <span class="mha-xp-value" title="${escapeHtml([
                                    row.xp.killsH
                                        ? tr(
                                            'xp.killsPerHour',
                                            {
                                                count:
                                                    Math.round(
                                                        row.xp.killsH
                                                    )
                                            }
                                        )
                                        : null,
                                    row.xp.pokemonValue
                                        ? tr(
                                            'xp.pokemonPerHour',
                                            {
                                                value:
                                                    formatRate(
                                                        row.xp.pokemonValue
                                                    )
                                            }
                                        )
                                        : null
                                ].filter(Boolean).join(' · '))}">${escapeHtml(
                                    tr(
                                        row.xp.observed
                                            ? 'xp.measuredShort'
                                            : 'xp.modelShort',
                                        {
                                            value:
                                                formatRate(
                                                    row.xp.value
                                                )
                                        }
                                    )
                                )}${row.xp.incomplete ? ' · ' + escapeHtml(tr('xp.incompleteShort', {percentage: row.xp.coverage})) : ''} · ${escapeHtml(rangeLabel(row.xp))}</span>
                                <button
                                    type="button"
                                    class="mha-go ${here ? 'current' : ''}"
                                    data-mha-best-go="${escapeHtml(row.hunt.slug)}"
                                    ${here ? 'disabled' : ''}
                                >${tr(
                                    here
                                        ? 'hunt.here'
                                        : 'hunt.go'
                                )}</button>
                            </div>
                        `;
                    }
                )
                .join('');

        const bestHere =
            best?.hunt?.slug
                ? isHuntHere(
                    best.hunt.slug
                )
                : false;

        const economicHunt = current || best?.hunt || null;
        const economic = economicHunt ? huntEconomyEstimate(economicHunt,
            economicHunt.slug === best?.hunt?.slug
                ? best.xp : huntXpEstimate(economicHunt)) : null;
        const econValue = value => typeof value === 'number' &&
            Number.isFinite(value) ? formatRate(value) : tr('econ.unknown');
        const econLine = (label,value,source) => '<div class="mha-xp-note"><strong>' +
            escapeHtml(label) + ': ' + escapeHtml(econValue(value)) +
            '</strong>' + (source ? ' · ' + escapeHtml(source) : '') + '</div>';
        const economyHtml = economic ? [
            '<div class="mha-xp-list-title">' +
                escapeHtml(tr('econ.title',{hunt:economicHunt.nome ||
                    economicHunt.slug})) + '</div>',
            econLine(tr('econ.kill'),economic.killCoinsH,
                tr(economic.killSource === 'observed-server/event' ?
                    'econ.observed':'econ.model')),
            econLine(tr('econ.loot'),economic.npcLootEvH,
                tr('econ.estimatedLoot',{coverage:economic.lootCoverage})),
            econLine(tr('econ.realized'),economic.realizedH,
                tr('econ.observed')),
            econLine(tr('econ.net'),economic.netH,
                tr('econ.cost')),
            econLine(tr('econ.cost'),economic.replacementCostH,
                tr('econ.observed')),
            economic.diamondsH ? econLine(tr('econ.diamonds'),
                economic.diamondsH,tr('econ.observed')) : '',
            ...economic.useEvidence.filter(row=>
                row.remaining !== null && row.hoursRemaining !== null
            ).slice(0,3).map(row=>'<div class="mha-xp-note">' +
                escapeHtml((row.type==='ball'?'Ball ':'Item ') + row.id) +
                ': ' + escapeHtml(tr('econ.stock', {
                    count:row.remaining,
                    hours:row.hoursRemaining.toFixed(1)
                })) + '</div>'),
            '<div class="mha-xp-note">' +
                escapeHtml(tr('econ.netCaveat')) + '</div>',
            economic.unknownCosts ? '<div class="mha-xp-note">' +
                escapeHtml(tr('econ.noPrice',
                    {count:economic.unknownCosts})) + '</div>' : '',
            economic.unlinkedCosts ? '<div class="mha-xp-note">' +
                escapeHtml(tr('econ.unlinked',
                    {count:economic.unlinkedCosts})) + '</div>' : ''
        ].join('') : '';


        const selectedTier=state.filters.outlandPreviewTier;
        const reportedTier=state.outlandTierSeen
            ? state.farmingSnapshot.outlandTier : null;
        const nativeTier=reportedTier===null ? null :
            outlandNativeTier(reportedTier,state.playerLevel);
        const tierInfo=farmingTier(selectedTier,state.playerLevel);
        const tierGate=FARM_OUTLAND_TIERS[selectedTier-1][0];
        const previewHunt=rareOutlandHunt();
        const outlandModel=previewHunt
            ? rareModelForHunt(previewHunt,selectedTier) : null;
        const eggHunt=(current && current.area!=='outland' &&
            Number(current.nivel)>=5000) ? current
            : ranked.map(row=>row.hunt).find(hunt=>
                hunt.area!=='outland' && Number(hunt.nivel)>=5000) || null;
        const eggModel=eggHunt?rareModelForHunt(eggHunt,1):null;
        const fmtChance=value=>(value*100).toFixed(6)+'%';
        const fmtHours=value=>value===null?'—':
            value>=1000?formatRate(value):value.toFixed(value>=10?1:2);
        const fmtUnits=value=>Number.isFinite(value)?
            (value>=1?value.toFixed(2):value.toFixed(5)):'—';
        const modelRows=model=>model?.drops?.length
            ? model.drops.map(row=>{
                const observed=model.observedDrops?.[row.id];
                const descriptions=[
                    fmtChance(row.probability)+' '+tr('rare.kills'),
                    tr('rare.units',{value:fmtUnits(row.unitsH)}),
                    tr('rare.mean',{hours:fmtHours(row.meanHours)}),
                    row.craft>1 ? tr('rare.craft',{hours:fmtHours(row.craftHours)}) : null,
                    tr('rare.chances',{hour:(100*row.chance1h).toFixed(4),
                        day:(100*row.chance24h).toFixed(4)}),
                    observed===undefined ? null:
                        tr('rare.observed',{count:observed})
                ].filter(Boolean).join(' · ');
                return '<div class="mha-xp-note"><strong>'+
                    escapeHtml(row.name)+'</strong> · '+escapeHtml(descriptions)+
                    ' · '+escapeHtml(row.source)+'</div>';
            }).join('') :
                '<div class="mha-xp-note">'+escapeHtml(tr(
                    model?.reason==='unknown-kill-rate'?'rare.noRate':'rare.notEligible'
                ))+'</div>';
        const previewOptions=FARM_OUTLAND_TIERS.map(([level],i)=>
            '<option value="'+(i+1)+'" '+
                (selectedTier===i+1?'selected':'')+
                '>Outland '+(i+1)+' · Lv '+level+'</option>').join('');
        const activateTier=Boolean(tierInfo && state.outlandTierSeen &&
            nativeTier!==null && nativeTier!==selectedTier &&
            !state.pendingOutlandTier && socketReady());
        const rareHtml=[
            '<div class="mha-xp-list-title">'+escapeHtml(tr('rare.heading'))+'</div>',
            '<div class="mha-xp-note"><label>'+escapeHtml(tr('rare.preview'))+
                ' <select data-mha-outland-preview aria-label="'+
                escapeHtml(tr('rare.preview'))+'">'+previewOptions+
                '</select></label></div>',
            '<div class="mha-xp-note">'+escapeHtml(nativeTier!==null
                ? tr('rare.active',{tier:nativeTier}):
                tr('rare.activeUnknown'))+' · '+escapeHtml(tr('rare.previewOnly'))+'</div>',
            !tierInfo ? '<div class="mha-xp-note">'+escapeHtml(
                tr('rare.locked',{level:tierGate}))+'</div>' : '',
            reportedTier!==null && nativeTier!==reportedTier ?
                '<div class="mha-xp-note">'+escapeHtml(tr('rare.fallback',{
                    reported:reportedTier,effective:nativeTier
                }))+'</div>' : '',
            '<div class="mha-xp-note">'+
                (activateTier ? '<button type="button" data-mha-activate-tier>'+
                    escapeHtml(tr('rare.select'))+'</button>' :
                escapeHtml(state.pendingOutlandTier?tr('rare.pending'):
                    !state.outlandTierSeen?tr('rare.noCommand'):
                    nativeTier===selectedTier?'':tr('rare.previewOnly')))+'</div>',
            '<div class="mha-xp-note"><strong>'+
                escapeHtml(tr('rare.outland'))+'</strong> · '+
                escapeHtml(previewHunt?
                    tr('rare.huntContext',{hunt:previewHunt.nome||previewHunt.slug}):
                    tr('rare.notEligible'))+'</div>',
            previewHunt && tierInfo && outlandModel?
                '<div class="mha-xp-note">'+escapeHtml(tr('rare.source',{
                    source:outlandModel.source,
                    rate:Math.round(outlandModel.killsH??0),
                    rateSource:outlandModel.rateSource
                }))+'</div>' + modelRows(outlandModel):'',
            '<div class="mha-xp-note"><strong>'+escapeHtml(tr('rare.egg'))+
                '</strong> · '+escapeHtml(eggHunt?.nome||tr('rare.notEligible'))+'</div>',
            eggHunt?modelRows(eggModel):'',
            eggModel?.drops?.length?
                '<div class="mha-xp-note">'+escapeHtml(tr('rare.incubation'))+'</div>':'',
            '<div class="mha-xp-note">'+escapeHtml(tr('rare.marketUnknown'))+'</div>',
            '<div class="mha-xp-note">'+escapeHtml(tr('rare.uncertainty'))+'</div>'
        ].join('');


        const captureHunt=String(state.filters.search||'').trim()&&results.length?
            results[0].hunt : current && isUnlocked(current) ?
            current : best?.hunt??null;
        const activeCaptureId=state.filters.captureBall==='beast'?5:4;
        const capXp=captureHunt?huntXpEstimate(captureHunt):null;
        const ultra=captureHunt?capturePlanForHunt(captureHunt,4,capXp):null;
        const beast=captureHunt?capturePlanForHunt(captureHunt,5,capXp):null;
        const chosen=activeCaptureId===5?beast:ultra;
        const pct=value=>typeof value==='number'&&Number.isFinite(value)
            ?(100*value).toFixed(3)+'%':tr('catch.unknown');
        const rate=value=>typeof value==='number'&&Number.isFinite(value)
            ?value.toFixed(value<1?5:2):tr('catch.unknown');
        const captureLine=(label,value)=>'<div class="mha-xp-note">'+
            '<strong>'+escapeHtml(label)+'</strong> · '+
            escapeHtml(value)+'</div>';
        const observedCapture=chosen?.observed;
        const capEvidence=chosen?
            tr('catch.source',{coverage:chosen.coverage,
                source:chosen.source}):tr('catch.unknown');
        const captureHtml=[
            '<div class="mha-xp-list-title">'+escapeHtml(tr('catch.title'))+'</div>',
            '<div class="mha-xp-note"><label>'+escapeHtml(tr('catch.ball'))+
                ' <select data-mha-capture-ball>'+
                '<option value="ultra" '+(activeCaptureId===4?'selected':'')+'>'+
                escapeHtml(tr('catch.ultra'))+'</option>'+
                '<option value="beast" '+(activeCaptureId===5?'selected':'')+'>'+
                escapeHtml(tr('catch.beast'))+'</option></select></label></div>',
            '<div class="mha-xp-note"><label><input type="checkbox" '+
                'data-mha-shiny-lure-preview '+
                (state.filters.shinyLurePreview?'checked':'')+
                ' /> '+escapeHtml(tr('catch.lure'))+'</label></div>',
            captureLine(tr('catch.current',{hunt:captureHunt?.nome||
                captureHunt?.slug||'?'}),[
                    'Ultra '+pct(ultra?.chance),
                    'Beast '+pct(beast?.chance),
                    chosen?.ball?.source
                ].filter(Boolean).join(' · ')),
            chosen ? captureLine(tr('catch.percent',{
                chance:chosen.chance===null?'—':(100*chosen.chance).toFixed(3)
            }),tr('catch.expected',{
                count:rate(chosen.catchesH),
                balls:rate(chosen.ballsPerCapture)
            })):'',
            chosen && chosen.shinyCaughtH>0 ? captureLine(tr('catch.shinyMean',{
                hours:formatRate(1/chosen.shinyCaughtH),
                throws:formatRate(1/(chosen.chance*chosen.shinyP))
            }),tr('catch.limit')):'',
            chosen ? captureLine(tr('catch.seen',{
                count:rate(chosen.shinySeenH),
                caught:rate(chosen.shinyCaughtH)
            }),tr('catch.oneDay',{
                chance:chosen.shinyCaught24hChance===null?'—':
                    (100*chosen.shinyCaught24hChance).toFixed(5)
            })):'',
            chosen && chosen.ball.id===4 && chosen.coinsPerCapture!==null ?
                captureLine(tr('catch.cost',{
                    coins:formatRate(chosen.coinsPerCapture)}),
                    chosen.ball.priceSource):'',
            chosen && chosen.ball.id===5 ?
                captureLine(tr('catch.diamondCost'),
                    chosen.diamondsPerCapture!==null?
                        rate(chosen.diamondsPerCapture)+' Diamonds/capture':
                        'Diamonds price unknown'):'',
            chosen && chosen.ball.stock!==null ?
                captureLine(tr('catch.stock',{count:chosen.ball.stock,
                    hours:chosen.stockHours===null?'—':
                        rate(chosen.stockHours)}),
                    chosen.observed?'observed usage':'usage unknown'):'',
            observedCapture?.byBall?.[activeCaptureId] ?
                captureLine(tr('catch.observedBall',{
                    throws:observedCapture.byBall[activeCaptureId],
                    caught:observedCapture.byBallCaught[activeCaptureId]??0
                }),tr('econ.observed')):'',
            observedCapture ?
                captureLine(tr('catch.observed',{
                    throws:observedCapture.throws,
                    caught:observedCapture.captures,
                    seen:observedCapture.shinySeen??'—',
                    shiny:observedCapture.shinyCaught??'—',
                    fraction:(100*Math.min(1,
                        observedCapture.targetableFraction)).toFixed(1)
                }),tr('econ.observed')):'',
            '<div class="mha-xp-note">'+escapeHtml(capEvidence)+'</div>',
            '<div class="mha-xp-note">'+escapeHtml(tr('catch.limit'))+'</div>',
            '<div class="mha-xp-note">'+escapeHtml(tr('catch.shiny'))+'</div>',
            chosen?.shinyEligible===null ?
                '<div class="mha-xp-note">'+escapeHtml(tr('catch.outland'))+
                '</div>':'',
            '<div class="mha-xp-note">'+escapeHtml(tr('catch.clamp'))+'</div>',
            '<div class="mha-xp-note">'+escapeHtml(tr('catch.mystic'))+'</div>'
        ].join('');

        const html = `
            <div class="mha-xp-heading">
                <strong>${escapeHtml(
                    tr(
                        'xp.sectionTitle'
                    )
                )}</strong>
                <span>${escapeHtml(
                    tr(
                        'xp.sectionSubtitle',
                        {
                            lead:
                                lead?.nome ||
                                lead?.name ||
                                'Pokémon'
                        }
                    )
                )}</span>
            </div>

            <div class="mha-xp-primary">
                <div class="mha-xp-primary-main">
                    <strong>${best
                        ? escapeHtml(
                            tr(
                                best.xp.observed ? 'xp.best' : 'xp.uncertainLeader',
                                {
                                    hunt:
                                        best.hunt.nome ||
                                        best.hunt.slug
                                }
                            )
                        ) +
                          ' · ' +
                          escapeHtml(
                              tr(
                                  'hunt.level',
                                  {
                                      level:
                                          Number(
                                              best.hunt.nivel ||
                                              0
                                          )
                                  }
                              )
                          )
                        : escapeHtml(
                            tr(
                                'xp.noEstimate'
                            )
                        )}</strong>
                    <span>${best
                        ? escapeHtml(
                            tr(
                                best.xp.observed
                                    ? 'xp.measuredTrainer'
                                    : 'xp.modeledTrainer',
                                {
                                    value:
                                        formatRate(
                                            best.xp.value
                                        )
                                }
                            )
                        ) + (best.xp.incomplete ? ' · ' + escapeHtml(tr('xp.incompleteShort', {percentage: best.xp.coverage})) : '')
                        : ''}</span>
                </div>

                ${best ? `
                    <button
                        type="button"
                        class="mha-go ${bestHere ? 'current' : ''}"
                        data-mha-best-go="${escapeHtml(best.hunt.slug)}"
                        ${bestHere ? 'disabled' : ''}
                    >${tr(
                        bestHere
                            ? 'hunt.here'
                            : 'hunt.go'
                    )}</button>
                ` : ''}

                <button type="button" class="mha-xp-toggle" data-mha-xp-toggle>
                    ${tr(
                        state.xpDetailsOpen
                            ? 'xp.hideTopFive'
                            : 'xp.showTopFive'
                    )}
                </button>
            </div>

            <div class="mha-xp-details" ${state.xpDetailsOpen ? '' : 'hidden'}>
                <div class="mha-xp-list-title">
                    ${escapeHtml(
                        tr(
                            'xp.topFiveTitle'
                        )
                    )}
                </div>

                <div class="mha-best-list">
                    ${bestRows}
                </div>

                <div class="mha-xp-note">
                    ${escapeHtml(leadText)}
                    · ${escapeHtml(calibrationText)}
                    ${moveSummaryText ? ' · ' + escapeHtml(moveSummaryText) : ''}
                    ${currentXp?.incomplete ? ' · ' + escapeHtml(tr('xp.incompleteDetail', {
                        covered: currentXp.coveredPoints,
                        total: currentXp.totalPoints,
                        percentage: currentXp.coverage
                    })) : ''}
                    ${best ? ' · ' + escapeHtml(displayEvidence(best.xp)) : ''}
                    ${currentXp?.pokemonValue === null ? ' · ' + escapeHtml(tr('xp.unknownPokemon')) : ''}
                    ${currentXp?.warmingUp ? ' · ' + escapeHtml(tr('xp.warmingSession')) : ''}
                    ${currentXp?.observed ? ' · ' + escapeHtml(tr('xp.sessionEvidence', {
                        samples: currentXp.samples,
                        minutes: Math.max(1, Math.round(currentXp.windowMs / 60000))
                    })) : ''}
                    ${currentXp?.value
                        ? escapeHtml(
                            tr(
                                currentXp.observed
                                    ? 'xp.currentMeasured'
                                    : 'xp.currentModeled',
                                {
                                    value:
                                        formatRate(
                                            currentXp.value
                                        )
                                }
                            )
                        )
                        : ''}
                    ${currentXp?.residualErrorPct !== null && currentXp?.residualErrorPct !== undefined ? ' · forecast error ' + escapeHtml(String(currentXp.residualErrorPct)) + '%' : ''}
                    ${currentXp?.calibration?.hunts ? ' · ' + escapeHtml(tr('xp.calibration', {count: currentXp.calibration.hunts, error: currentXp.calibration.medianErrorPct})) : ''}
                    ${escapeHtml(
                        tr(
                            'xp.modelNote'
                        )
                    )}
                </div>
            </div>
            ${captureHtml}
            ${economyHtml}
            ${rareHtml}
        `;

        // This summary is polled with the drawer, but should only replace its
        // DOM when the rendered content changed. Preserving existing nodes
        // prevents needless repaint/focus churn and avoids re-binding handlers.
        if (host.innerHTML === html) return;
        host.innerHTML = html;

        q('[data-mha-capture-ball]',host)?.addEventListener('change',event=>{
            if(!['ultra','beast'].includes(event.target.value))return;
            state.filters.captureBall=event.target.value;
            saveFilters();
            renderDrawer();
        });
        q('[data-mha-shiny-lure-preview]',host)?.addEventListener('change',event=>{
            state.filters.shinyLurePreview=event.target.checked;
            saveFilters();
            renderDrawer();
        });
        q('[data-mha-outland-preview]',host)?.addEventListener('change',event=>{
            const tier=Number(event.target.value);
            if(Number.isInteger(tier)&&tier>=1&&tier<=8){
                state.filters.outlandPreviewTier=tier;
                saveFilters();
                renderXpSummary(drawer,results);
            }
        });
        q('[data-mha-activate-tier]',host)?.addEventListener('click',()=>{
            requestOutlandTier(state.filters.outlandPreviewTier);
            renderXpSummary(drawer,results);
        });

        const detailsToggle =
            q(
                '[data-mha-xp-toggle]',
                host
            );

        detailsToggle?.addEventListener(
            'click',
            () => {
                state.xpDetailsOpen =
                    !state.xpDetailsOpen;

                renderXpSummary(
                    drawer,
                    results
                );
            }
        );

        for (
            const button of
            qa(
                '[data-mha-best-go]',
                host
            )
        ) {
            button.addEventListener(
                'click',
                () => {
                    const hunt =
                        state.hunts.find(
                            item =>
                                item.slug ===
                                button.dataset
                                    .mhaBestGo
                        );

                    if (hunt) {
                        navigateToHunt(
                            hunt
                        );
                    }
                }
            );
        }
    }

    function renderDrawer() {
        const locale =
            currentLocale();

        if (
            state.lastLocale !==
                locale
        ) {
            state.lastLocale =
                locale;

            q(
                '#' + DRAWER_ID
            )?.remove();

            ensureMapToggle();
        }

        const drawer =
            ensureDrawer();

        if (!drawer) {
            return;
        }

        drawer.hidden =
            false;

        arcadeRender(drawer);
        if (arcade.open) return;

        renderFilterControls(
            drawer
        );

        const results =
            filteredSpecies();

        renderXpSummary(
            drawer,
            results
        );

        const body =
            q(
                '.mha-body',
                drawer
            );

        const limit =
            Math.max(
                120,
                Number(
                    state.resultLimit ||
                    120
                )
            );

        const visibleResults =
            results.slice(
                0,
                limit
            );

        const hasMore =
            results.length >
            visibleResults.length;

        const html =
            visibleResults.length
                ? visibleResults
                    .map(
                        speciesMarkup
                    )
                    .join('') +
                  (
                      hasMore
                          ? `
                              <button type="button" class="mha-show-more" data-mha-show-more>
                                  ${escapeHtml(
                                      tr(
                                          'results.showMore',
                                          {
                                              count:
                                                  results.length -
                                                  visibleResults.length
                                          }
                                      )
                                  )}
                              </button>
                          `
                          : ''
                  )
                : `
                    <div class="mha-empty">
                        ${escapeHtml(
                            tr(
                                state.hunts.length
                                    ? 'results.noMatch'
                                    : 'results.waiting'
                            )
                        )}
                    </div>
                `;

        if (
            body.innerHTML !==
            html
        ) {
            body.innerHTML =
                html;

            for (
                const button of
                qa(
                    '[data-mha-go]',
                    body
                )
            ) {
                button.addEventListener(
                    'click',
                    () => {
                        const slug =
                            button.dataset
                                .mhaGo;

                        const hunt =
                            state.hunts.find(
                                item =>
                                    item.slug ===
                                    slug
                            );

                        if (hunt) {
                            navigateToHunt(
                                hunt
                            );
                        }
                    }
                );
            }

            q(
                '[data-mha-show-more]',
                body
            )?.addEventListener(
                'click',
                () => {
                    state.resultLimit =
                        limit + 120;

                    renderDrawer();
                }
            );
        }

        const status =
            q(
                '.mha-status',
                drawer
            );

        const typeSuffix =
            state.typeStatus ===
                'loading'
                ? tr(
                    'status.loadingTypes'
                )
                : state.typeStatus ===
                    'error'
                    ? tr(
                        'status.typesUnavailable'
                    )
                    : '';

        const locationSuffix = state.locationIndexStatus === 'error'
            ? tr('status.locationsUnavailable')
            : state.locationIndexStatus === 'ready' && state.hunts.length
                ? (() => {
                    const coverage = locationCoverage();
                    return ' · ' + tr('location.coverage', {
                        matched: coverage.matched,
                        total: coverage.total,
                        conflicts: coverage.levelConflicts
                    });
                })() : '';
        const moveSuffix = state.moveIndexStatus === 'error' ? tr('status.movesUnavailable') : '';
        const marketSuffix =
            state.marketStatus ===
                'loading'
                ? tr(
                    'status.marketSampling'
                )
                : '';

        const statusText =
            localizedStatus() +
            typeSuffix +
            marketSuffix +
            locationSuffix +
            moveSuffix;

        if (
            status.textContent !==
            statusText
        ) {
            status.textContent =
                statusText;
        }

        const count =
            q(
                '.mha-count',
                drawer
            );

        const countText =
            hasMore
                ? tr(
                    'results.countPartial',
                    {
                        shown:
                            visibleResults.length,
                        pokemon:
                            results.length
                    }
                )
                : tr(
                    'results.count',
                    {
                        pokemon:
                            results.length
                    }
                );

        if (
            count.textContent !==
            countText
        ) {
            count.textContent =
                countText;
        }
    }

    function queueRender() {
        if (
            state.renderQueued
        ) {
            return;
        }

        state.renderQueued =
            true;

        queueMicrotask(
            () => {
                state.renderQueued =
                    false;

                ensureButton();

                if (
                    isMapModalOpen()
                ) {
                    ensureMapToggle();

                    if (
                        state.atlasEnabled
                    ) {
                        state.drawerOpen =
                            true;
                        renderDrawer();
                    } else {
                        state.drawerOpen =
                            false;
                        restoreNativeMapView();
                    }
                } else {
                    cleanupMapIntegration();
                }
            }
        );
    }


    function controllerSnapshot() {
        syncFromControllerBridge();

        const lead = leadPokemon();

        const leadTypes = lead
            ? normalizedTypes(
                lead.tipos ||
                state.typesBySpecies.get(
                    Number(lead.speciesId)
                )
            )
            : [];

        const attackTypes = normalizedTypes(
            attackerTypes()
        );

        const hunts = state.hunts.map(hunt => {
            const xp = huntXpEstimate(hunt);

            const species = (
                Array.isArray(hunt?.especies)
                    ? hunt.especies
                    : []
            ).map(entry => {
                const id = Number(entry?.pokeId) || 0;
                const name = String(
                    entry?.nome ||
                    entry?.name ||
                    ('Pokémon ' + id)
                );

                const types = normalizedTypes(
                    state.typesBySpecies.get(id) || []
                );

                const weaknessMultipliers = types.length
                    ? STANDARD_TYPES
                        .map(attackType => ({
                            type: attackType,
                            multiplier: weaknessMultiplier(types, attackType)
                        }))
                        .filter(entry => entry.multiplier > 1)
                    : [];

                const weakTo = weaknessMultipliers.map(entry => entry.type);

                const view = {
                    id,
                    name,
                    types,
                    hunt
                };

                const matchup = types.length
                    ? speciesMatchup(view)
                    : null;

                const npc = npcSellStatsForSpecies(view);
                const market = marketStatsForSpecies(view);

                return {
                    id,
                    name,
                    points: Math.max(
                        1,
                        Number(entry?.pontos || 1)
                    ),
                    types,
                    weakTo,
                    weaknessMultipliers,
                    captured: isCaptured(id),
                    captureCount: captureCount(id),
                    npcValue: Number(
                        npc?.average || 0
                    ),
                    marketValue: Number(
                        market?.average || 0
                    ),
                    offense: matchup?.offense
                        ? {
                            multiplier: Number(
                                matchup.offense.multiplier
                            ) || 1,
                            attackType: String(
                                matchup.offense.attackType || ''
                            )
                        }
                        : null,
                    defense: matchup?.defense
                        ? {
                            multiplier: Number(
                                matchup.defense.multiplier
                            ) || 1,
                            attackType: String(
                                matchup.defense.attackType || ''
                            )
                        }
                        : null,
                    matchupScore: Number.isFinite(
                        bestMatchupScore(view)
                    )
                        ? bestMatchupScore(view)
                        : null
                };
            });

            return {
                slug: String(
                    hunt?.slug || ''
                ),
                name: String(
                    hunt?.nome ||
                    hunt?.name ||
                    hunt?.slug ||
                    ''
                ),
                level: Number(
                    hunt?.nivel ||
                    hunt?.level ||
                    0
                ) || 0,
                area: String(
                    hunt?.area ||
                    ''
                ),
                unlocked: isUnlocked(hunt),
                current: isHuntHere(
                    hunt?.slug
                ),
                xp: {
                    value: Number(
                        xp?.value || 0
                    ),
                    pokemonValue: Number(
                        xp?.pokemonValue || 0
                    ),
                    killsH: Number(
                        xp?.killsH || 0
                    ),
                    killMs: Number(
                        xp?.killMs || 0
                    ),
                    observed: Boolean(
                        xp?.observed
                    ),
                    source: String(
                        xp?.source ||
                        'learning'
                    ),
                    economy: (() => {
                        const econ=huntEconomyEstimate(hunt,xp);
                        return {
                            killCoinsH:econ.killCoinsH,killSource:econ.killSource,
                            npcLootEvH:econ.npcLootEvH,
                            lootCoverage:econ.lootCoverage,
                            realizedCoinsH:econ.realizedH,netCoinsH:econ.netH,
                            replacementCoinsH:econ.replacementCostH,
                            diamondCostH:econ.diamondsH
                        };
                    })(),
                    confidence: String(xp?.confidence || 'low'),
                    samples: Number(
                        xp?.samples || 0
                    ),
                    coverage: xp?.coverage ?? null,
                    incomplete: Boolean(xp?.incomplete)
                },
                species
            };
        });

        return {
            version: 1,
            playerLevel: Number(
                state.playerLevel || 0
            ),
            currentHuntSlug:
                state.currentHuntSlug || '',
            typeStatus:
                state.typeStatus || 'idle',
            huntAmplification:
                Number(
                    state.huntAmplification || 1.5
                ),
            lead: lead
                ? {
                    id: Number(lead.id) || 0,
                    speciesId: Number(
                        lead.speciesId
                    ) || 0,
                    name: String(
                        lead.nome ||
                        lead.name ||
                        ''
                    ),
                    level: Number(
                        lead.level || 0
                    ) || 0,
                    types: leadTypes,
                    attackTypes
                }
                : null,
            hunts,
            defaultFilters: defaultFilters()
        };
    }

    page.__mothHuntAtlasControllerV1 = {
        version: 1,
        snapshot: controllerSnapshot
    };

    // Experimental, read-only instrumentation for later player tests.
    // No automatic export, background logging or collection of private data.
    page.__mothHuntAtlasExperimentV1 = {
        snapshot() {
            const lead = leadPokemon();
            const profile = combatProfile();
            const here = currentHunt();
            const xp = here ? huntXpEstimate(here) : null;
            return {
                version: '1.9.8',
                indexes: {
                    locations: state.locationIndexStatus,
                    markerCount: state.locationsBySlug.size,
                    huntCoverage: locationCoverage(),
                    moves: state.moveIndexStatus,
                    moveGeneratedAt: state.moveIndexGeneratedAt,
                    speciesWithIndexedMoves: state.movesBySpecies.size,
                    candidateSource: moveSourceForLead(),
                    candidateCount: movesForLead().length,
                    disagreements: indexConflictsForLead().slice(0, 15)
                        .map(row => ({
                            name: row.name, type: row.type,
                            power: row.power, cooldownMs: row.cooldownMs
                        }))
                },
                attacks: {
                    ...state.battleDiagnostics,
                    castsInProfile: profile?.attackObservations?.length || 0,
                    namedCastsInProfile: profile?.namedMoveSamples || 0,
                    confirmedMoves: Object.values(profile?.observedNamedMoves || {})
                        .map(row => ({
                            name: row.name, type: row.type,
                            samples: row.samples,
                            neutralDamage: Math.round(row.neutralDamage || 0)
                        }))
                },
                rareDropEvidence: (() => {
                    const outland=rareOutlandHunt();
                    const tier=state.filters.outlandPreviewTier;
                    const plan=outland?rareModelForHunt(outland,tier):null;
                    return {
                        previewTier:tier,
                        activeTier:state.outlandTierSeen
                            ? state.farmingSnapshot.outlandTier : null,
                        tierSource:state.outlandTierSeen
                            ? 'observed-client':'unknown',
                        publishedTierCatalog:state.outlandCatalogTiers?.length===8,
                        pending:state.pendingOutlandTier?.tier??null,
                        rates:plan?.drops.map(row=>({
                            itemId:row.id,unitsH:row.unitsH,
                            probability:row.probability,
                            source:row.source
                        }))??[],
                        observedItemCounts:Object.fromEntries(
                            [...state.farmingLedger.items].filter(([id])=>
                                RARE_OUTLAND_DROPS.some(row=>row.id===id)
                                || id===RARE_EGG_DROP.id)
                        )
                    };
                })(),
                captureEvidence: (() => {
                    const here=currentHunt();
                    const ultra=here?capturePlanForHunt(here,4):null;
                    const beast=here?capturePlanForHunt(here,5):null;
                    return {
                        model:'wiki-conditional',
                        serverFormulaVerified:false,
                        rawChanceEvidence:{...state.captureChanceEvidence,
                            unit:'unknown-not-applied'},
                        observed:ultra?.observed??null,
                        ultra:ultra?{
                            chance:ultra.chance,
                            catchesH:ultra.catchesH,shinySeenH:ultra.shinySeenH,
                            shinyCaughtH:ultra.shinyCaughtH,
                            source:ultra.source,
                            acceptedSource:ultra.acceptedSource
                        }:null,
                        beast:beast?{
                            chance:beast.chance,
                            catchesH:beast.catchesH,
                            shinyCaughtH:beast.shinyCaughtH,
                            source:beast.source
                        }:null
                    };
                })(),
                farmingEvidence: {
                    schema: state.farmingLedger.schema,
                    // Only allowlisted field names and counters; no event bodies.
                    events: Object.fromEntries(state.farmingLedger.fieldPresence),
                    counts: {...state.farmingLedger.totals},
                    diagnostics: {...state.farmingLedger.diagnostics},
                    tier: state.farmingSnapshot.outlandTier ?? null,
                    tierSource: state.farmingSnapshot.outlandTier === undefined
                        ? 'unknown' : 'observed-client',
                    catalogRevision: state.farmingSnapshot.catalogRevision ?? null,
                    bonusSemantics: 'unverified'
                },
                xpEvidence: {
                    source: 'observed-server/event',
                    activeBonusFields: Object.keys(state.xpBonusState).sort(),
                    bonusScopeKnown: Object.keys(state.xpBonusState).length > 0,
                    serverStackingVerified: false,
                    transitions: performanceRecord(here?.slug, false)
                        ?.xpBonusTransitions?.slice(-6) || []
                },
                prediction: {
                    hunt: here?.slug || null,
                    calibration: calibrationDiagnostics(),
                    bonusSource: xp?.bonusSource ?? 'unknown',
                    fallbackReason: xp?.fallbackReason ?? null,
                    forecastRange: xp?.range
                        ? {low: Math.round(xp.range.low),
                            high: Math.round(xp.range.high),
                            label: 'heuristic-not-confidence-interval'} : null,
                    residualErrorPct: xp?.residualErrorPct ?? null,
                    speedIvRule: 'wiki-derived; runtime scheduling not confirmed',
                    source: xp?.source || 'none',
                    moveConfidence: moveModelConfidence(profile),
                    trainerXpH: Math.round(xp?.value || 0),
                    killsH: Math.round(xp?.killsH || 0),
                    measured: Boolean(xp?.observed),
                    warmingUp: Boolean(xp?.warmingUp),
                    samples: xp?.samples ?? 0,
                    windowMs: xp?.windowMs ?? null,
                    denominator: xp?.observed ? 'wall' : null,
                    coverage: xp?.coverage ?? null,
                    incomplete: Boolean(xp?.incomplete),
                    coveredPoints: xp?.coveredPoints ?? null,
                    totalPoints: xp?.totalPoints ?? null,
                    missingHpPoints: xp?.missingHpPoints ?? null,
                    missingDamagePoints: xp?.missingDamagePoints ?? null
                }
            };
        }
    };

    function bootstrap() {
        injectStyles();
        ensureButton();
        installMapObserver();
        scheduleMapSync();

        setInterval(
            () => {
                syncFromControllerBridge();
                ensureButton();

                if (
                    isMapModalOpen()
                ) {
                    ensureMapToggle();

                    if (
                        state.atlasEnabled
                    ) {
                        state.drawerOpen =
                            true;
                        renderDrawer();
                    } else {
                        state.drawerOpen =
                            false;
                        restoreNativeMapView();
                    }
                } else {
                    cleanupMapIntegration();
                }
            },
            3000
        );

        console.info(
            '[PokéIdle Hunt Atlas] v1.9.8 experimental loaded'
        );
    }

    if (
        document.readyState ===
        'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            bootstrap,
            {
                once: true
            }
        );
    } else {
        bootstrap();
    }
})();
