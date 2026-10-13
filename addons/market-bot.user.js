// ==UserScript==
// @name         PokéIdle Moth Watch
// @namespace    moth.pokeidle
// @version      0.4.0
// @description  Community Market and guarded item, category-wide and Pokémon purchase rules.
// @match        https://pokeidle.io/app*
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/market-bot.user.js
// @downloadURL  https://raw.githubusercontent.com/MOTHblank/pokeidle-addons-premium/main/addons/market-bot.user.js
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    // Report only this script's version to the native monitor (no account data).
    const reportMothAddonVersion = () => {
        document.documentElement?.setAttribute('data-moth-addon-version-market-bot', '0.4.0');
    };
    reportMothAddonVersion();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', reportMothAddonVersion, { once: true });
    }

    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    const CONFIG_KEY = 'moth-pokeidle-market-bot-config-v1';
    const ORDER_JOURNAL_KEY = 'moth-pokeidle-order-journal-v1';
    const ORDER_SESSION_KEY = 'moth-pokeidle-order-session-v1';
    const QUOTE_MAX_AGE_MS = 30000;
    const MAX_DETAIL_QUEUE = 24;
    const MAX_DETAIL_CACHE = 96;
    const MAX_CANDIDATES = 600;
    const MAX_FIRST_SEEN = 1800;
    const BASELINE_KEY = 'moth-pokeidle-market-item-baseline-v1';
    const POKEMON_REFERENCE_KEY = 'moth-pokeidle-market-pokemon-reference-v3';
    const POKEMON_SALE_WINDOW_MS = 90 * 86400000;
    const POKEMON_HISTORY_FRESH_MS = 30 * 86400000;
    const BACKGROUND_MIN_GAP_MS = 3000;
    const BACKGROUND_SCAN_WITH_RULES_MS = 30000;
    const RULE_DETAIL_REFRESH_MS = 30000;
    const RATE_LIMIT_BACKOFF_MS = 15000;
    const ITEM_MARKET_CAP_TTL_MS = 10 * 60 * 1000;
    const ITEM_INVENTORY_COLLAPSED_KEY = 'moth-pokeidle-market-item-inventory-collapsed-v1';

    /*
     * Source-ready price table.
     *
     * This intentionally starts empty. PokéIdle does not ship player-market
     * averages in its static client; the authoritative averages arrive only
     * on an authenticated market.itens response. On the first logged-in run,
     * Moth Watch freezes those server-calculated 7-day weighted averages into
     * BASELINE_KEY. "Export baseline JSON" emits entries in exactly this
     * shape so a verified snapshot can later be pasted here without guessing.
     *
     * Shape:
     *   itemId: {
     *     name: 'Water Stone',
     *     gold: { average: 30000, units: 27 } | null,
     *     orb:  { average: 42, units: 8 } | null
     *   }
     */
    const HARD_CODED_ITEM_AVERAGES = Object.freeze({});

    const DEFAULTS = Object.freeze({
        enabled: true,
        scanSeconds: 5,
        watchPercent: 70,
        scanItems: true,
        scanPokemon: true,
        scanDiamonds: true,
        fixedRulesEnabled: false,
        purchasesPaused: false,
        maxCoinsPerSession: 0,
        maxGemsPerSession: 0,
        maxCoinsPerDay: 0,
        maxGemsPerDay: 0,
        maxPurchasesPerSession: 0,
        maxQuantityPerSession: 0,
        fixedItemRules: [],
        anyItemRules: [],
        pokemonBuyRules: [],
        goldReserve: 0,
        gemReserve: 0,
        maxCoinsPerBuy: 0,
        maxGemsPerBuy: 0,
        minItemUnits: 5,
        minPokemonSamples: 3,
        pokemonHistoryPages: 12,
        pokemonHistoryRefreshMinutes: 60,
        viewCurrency: 'all',
        viewKind: 'all',
        viewSort: 'discount'
    });

    const state = {
        socket: null,
        gameSocket: null,
        observedSockets: new Set(),
        hookInstalled: false,
        nick: '',
        gold: 0,
        orbs: 0,
        catalog: new Map(),
        itemNames: new Map(),
        creatureNames: new Map(),
        itemSummary: {},
        liveItemAverages: {},
        loadedItemKeys: new Set(),
        ruleItemKeys: new Set(),
        anyItemScanCursor: 0,
        anyItemTargetsCache: null,
        pokemonAutoOffers: new Map(),
        liveDiamondAverages: null,
        diamondStatus: 'waiting',
        diamondPendingCurrency: null,
        diamondPendingAt: 0,
        nextDiamondCurrency: 'gold',
        diamondScanTimer: null,
        itemMarketCaps: new Map(),
        candidates: new Map(),
        detailQueue: [],
        detailQueued: new Set(),
        detailPending: null,
        lastDetailRequest: new Map(),
        selectedItemFocus: null,
        itemDetailStatus: null,
        itemOfferDetails: new Map(),
        sellRecommendationKey: null,
        pendingBuy: null,
        lastPurchaseOutcome: 'idle',
        marketReply: null,
        orderJournal: null,
        exposureCache: new Map(),
        automationLastRunAt: 0,
        itemSummaryAt: 0,
        automationNotice: null,
        attemptedListings: new Map(),
        buyLog: [],
        lastScanAt: 0,
        scanTimer: null,
        watchOpen: false,
        watchView: (() => { try { const value = localStorage.getItem('moth-pokeidle-market-watch-view-v1'); return ['opportunities', 'inventory', 'pricing', 'automation', 'activity'].includes(value) ? value : 'opportunities'; } catch { return 'opportunities'; } })(),
        opportunitySearch: (() => { try { return localStorage.getItem('moth-pokeidle-market-watch-search-v1') || ''; } catch { return ''; } })(),
        firstSeenCache: new Map(),
        itemInventoryCollapsed: (() => {
            try { return localStorage.getItem(ITEM_INVENTORY_COLLAPSED_KEY) === '1'; } catch { return false; }
        })(),
        renderQueued: false,
        lastRenderAt: 0,
        lastLocale: null,
        baseline: loadBaseline(),
        forceBaselineNext: false,
        pokemonReference: loadPokemonReference(),
        historyFetch: null,
        pokemonScan: null,
        protocolMessages: 0,
        itemStatus: 'waiting',
        pokemonStatus: 'waiting',
        serverClockOffset: 0,
        lastBotSendAt: 0,
        rateLimitedUntil: 0,
        itemSummaryRetryTimer: null,
        detailPumpTimer: null,
        itemScanStats: {
            goldChecked: 0,
            orbChecked: 0,
            goldSuspicious: 0,
            orbSuspicious: 0
        },
        releaseTimers: new Map(),
        lastControllerResult: null
    };

    let config = loadConfig();
    // Do not load an order journal before the game identifies the account.

    function q(selector, root) {
        return (root || document).querySelector(selector);
    }

    function qa(selector, root) {
        return Array.from((root || document).querySelectorAll(selector));
    }

    function normalize(value) {
        return String(value == null ? '' : value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Use Hunt Atlas's locale priority: game setting ("idioma"), document language, then browser language.
    function currentLocale() {
        let gameLanguage = null;
        try { gameLanguage = localStorage.getItem('idioma'); } catch {}
        if (gameLanguage) return gameLanguage === 'pt' ? 'pt-BR' : 'en';
        const htmlLanguage = String(document.documentElement?.lang || '').toLowerCase();
        if (htmlLanguage) return htmlLanguage.startsWith('pt') ? 'pt-BR' : 'en';
        return String(navigator.language || '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
    }

    const PT_BR = Object.freeze({
        "Underpriced listings and market sniper settings": "Ofertas abaixo do preço e configurações de compra no mercado",
        "Scan now": "Escanear agora",
        "Moth Watch views": "Seções do Moth Watch",
        "Opportunities": "Oportunidades",
        "Market inventory": "Estoque do mercado",
        "Automation & budget": "Automação e orçamento",
        "Activity & references": "Atividade e referências",
        "Search listings": "Buscar ofertas",
        "Search item, Pokémon, seller…": "Buscar item, Pokémon ou vendedor…",
        "Currency": "Moeda",
        "All": "Todas",
        "Coins": "Moedas",
        "Gems": "Gemas",
        "Shiny Pokémon can only be listed for Gems. Old Coin listings are ignored.": "Pokémon Shiny só podem ser anunciados por Gemas. Anúncios antigos em Moedas são ignorados.",
        "Type": "Tipo",
        "Items": "Itens",
        "Diamonds": "Diamantes",
        "Sort": "Ordenar",
        "Biggest discount": "Maior desconto",
        "Newest detected": "Detectadas mais recentemente",
        "Price: low → high": "Preço: menor → maior",
        "Price: high → low": "Preço: maior → menor",
        "Reference: high → low": "Referência: maior → menor",
        "Quantity: high → low": "Quantidade: maior → menor",
        "Name: A → Z": "Nome: A → Z",
        "1 matching listing": "1 oferta correspondente",
        "{count} matching listings": "{count} ofertas correspondentes",
        "{count} matching listings · purchases are serialized while awaiting server confirmation": "{count} ofertas correspondentes · compras são serializadas até a confirmação do servidor",
        "Watch threshold: {value}% of reference": "Limite de alerta: {value}% da referência",
        "ON": "LIGADA",
        "OFF": "DESLIGADA",
        "Items: {items} · Pokémon: {pokemon} · Diamonds: {diamonds}": "Itens: {items} · Pokémon: {pokemon} · Diamantes: {diamonds}",
        "Load Coin offers": "Carregar ofertas em moedas",
        "No Coin offers": "Sem ofertas em moedas",
        "Load Gem offers": "Carregar ofertas em gemas",
        "No Gem offers": "Sem ofertas em gemas",
        "Items for sale": "Itens à venda",
        "item type with active listings": "tipo de item com ofertas ativas",
        "item types with active listings": "tipos de item com ofertas ativas",
        " · showing first {count}": " · mostrando os primeiros {count}",
        "This summary shows the lowest active market price for every item. Use Load Coin/Gem offers to expand all current listings under the selected item. Loaded listings also remain available in Opportunities.": "Este resumo mostra o menor preço ativo de cada item. Use Carregar ofertas em moedas/gemas para expandir todos os anúncios do item selecionado. Os anúncios carregados também ficam disponíveis em Oportunidades.",
        "No market item inventory has arrived yet.": "O inventário de itens do mercado ainda não chegou.",
        "Current market median · {count} listings": "Mediana atual do mercado · {count} ofertas",
        " · server 7d avg {value} ignored": " · média do servidor em 7 dias ({value}) ignorada",
        "live 7d avg / unit": "média real de 7 dias por unidade",
        "frozen fallback / unit": "referência alternativa salva por unidade",
        "no sale-price reference": "sem referência de preço de venda",
        "active market median": "mediana atual do mercado",
        "completed-sale reference": "referência de vendas concluídas",
        "no completed-sale reference": "sem referência de vendas concluídas",
        "sales median · {count} sales": "mediana das vendas · {count} vendas",
        "1 unit sold": "1 unidade vendida",
        "{count} units sold": "{count} unidades vendidas",
        "1 sale": "1 venda",
        "{count} sales": "{count} vendas",
        "1 listing": "1 oferta",
        "{count} listings": "{count} ofertas",
        "units": "unidades",
        "diamonds": "diamantes",
        "total": "total",
        "listed": "anunciado",
        " / unit": " / unidade",
        "watch range": "faixa de alerta",
        "Seller: {seller}": "Vendedor: {seller}",
        "retained · {seconds}s": "reservada · {seconds}s",
        "available": "disponível",
        "Buying…": "Comprando…",
        "Wait": "Aguardar",
        "Tried recently": "Tentativa recente",
        "Buy": "Comprar",
        "No matching opportunities. Try a wider watch threshold or inspect Market inventory.": "Nenhuma oportunidade corresponde aos filtros. Aumente o limite de alerta ou consulte o estoque do mercado.",
        "Browse item types, then load the offers for a selected currency.": "Navegue pelos tipos de item e carregue as ofertas na moeda desejada.",
        "Watch rules": "Regras de monitoramento",
        "Watch price threshold": "Limite de preço para alertas",
        "Scan interval": "Intervalo de varredura",
        "seconds": "segundos",
        "Watch items": "Monitorar itens",
        "Watch Pokémon": "Monitorar Pokémon",
        "Watch diamonds": "Monitorar diamantes",
        "Spending limits": "Limites de gastos",
        "Keep Coins in reserve": "Manter moedas reservadas",
        "Keep Gems in reserve": "Manter gemas reservadas",
        "Maximum Coins per purchase": "Máximo de moedas por compra",
        "Maximum Gems per purchase": "Máximo de gemas por compra",
        "0 = no extra cap": "0 = sem limite adicional",
        "Reference confidence": "Confiabilidade das referências",
        "Minimum sold item units": "Mínimo de unidades de item vendidas",
        "Minimum Pokémon sale samples": "Mínimo de vendas de Pokémon na amostra",
        "Pokémon history pages": "Páginas do histórico de Pokémon",
        "Price references": "Referências de preço",
        "Inspect and refresh reference data used to judge offers.": "Consulte e atualize as referências usadas para avaliar ofertas.",
        "Item references:": "Referências de itens:",
        "live server 7-day averages with a saved fallback captured": "médias do servidor em 7 dias, com referência alternativa salva em",
        " item types; ": " tipos de item; ",
        " Coin references; ": " referências em moedas; ",
        " Gem references.": " referências em gemas.",
        "Suspicious prices: ": "Preços suspeitos: ",
        " Coin · ": " moedas · ",
        " Gem.": " gemas.",
        "Refresh saved fallback": "Atualizar referência alternativa salva",
        "Copy reference data": "Copiar dados de referência",
        "Recent activity": "Atividade recente",
        "Purchase attempts, confirmations, and errors.": "Tentativas de compra, confirmações e erros.",
        "No purchase attempts recorded this session.": "Nenhuma tentativa de compra registrada nesta sessão.",
        "Moth Watch": "Moth Watch",
        "waiting": "aguardando",
        "live": "ao vivo",
        "disabled": "desativado",
        "queued": "na fila",
        "scanning": "analisando",
        "rate-limit backoff": "pausa por limite de requisições",
        "history ready": "histórico pronto",
        "waiting for game": "aguardando o jogo",
        "history cached": "histórico em cache",
        "loading history": "carregando histórico",
        "paused while browsing": "pausado durante a navegação",
        "watching": "monitorando",
        "disconnected": "desconectado",
        "retrying after timeout": "nova tentativa após tempo limite",
        "scanning · Gems": "analisando · gemas",
        "scanning · Coins": "analisando · moedas",
        "live · Gems": "ao vivo · gemas",
        "live · Coins": "ao vivo · moedas",
        "Purchase confirmed · listing #{id}": "Compra confirmada · oferta #{id}",
        "Reference data copied to clipboard": "Dados de referência copiados para a área de transferência",
        "Could not copy reference data": "Não foi possível copiar os dados de referência",
        "Purchase not sent; check balance, reserve, listing availability, and pending purchase status": "Compra não enviada; confira saldo, reservas, disponibilidade da oferta e se há compra pendente",
        "Server rate limit · background scans paused for 15s": "Limite de requisições do servidor · varreduras em segundo plano pausadas por 15 s",
        "Baseline frozen: {count} market items": "Referência inicial salva: {count} itens do mercado",
        "Baseline expanded with {count} missing Coin/Gem reference": "Referência inicial ampliada com {count} referência ausente de moedas/gemas",
        "Baseline expanded with {count} missing Coin/Gem references": "Referência inicial ampliada com {count} referências ausentes de moedas/gemas",
        "Pokémon reference refreshed: {count} buckets": "Referências de Pokémon atualizadas: {count} grupos",
        "Purchase refused: {message}": "Compra recusada: {message}",
        "Skipped: not enough spendable balance for {name}": "Ignorado: saldo disponível insuficiente para {name}",
        "no reference captured yet": "nenhuma referência capturada ainda",
        "loading {name} offers": "carregando ofertas de {name}",
        "Show an offer when its price is at or below this share of the reference. 70% means at least 30% below reference.": "Mostra uma oferta quando o preço estiver nesta proporção ou abaixo da referência. 70% significa pelo menos 30% abaixo da referência.",
        "How often the market scanner checks again. Lower finds changes sooner but sends requests more often. With buying rules active and Watch closed, general scans slow to at least 30 seconds.": "Define a frequência das consultas ao mercado. Intervalos menores encontram mudanças mais cedo, mas enviam mais requisições. Com regras de compra ativas e o Moth Watch fechado, as consultas gerais passam a ocorrer a cada 30 segundos ou mais.",
        "Scan ordinary market items and let you inspect their current offers.": "Analisa itens comuns do mercado e permite consultar as ofertas atuais.",
        "Scan Pokémon listings and compare them with completed-sale history.": "Analisa anúncios de Pokémon e compara os preços com o histórico de vendas concluídas.",
        "Scan diamond listings and compare prices when a reference is available.": "Analisa anúncios de diamantes e compara os preços quando há uma referência disponível.",
        "Money that must remain untouched. This is subtracted before calculating an affordable purchase.": "Quantidade de moedas que deve ficar reservada. Esse valor é descontado antes de calcular uma compra possível.",
        "Gems that must remain untouched. This is subtracted before calculating an affordable purchase.": "Quantidade de gemas que deve ficar reservada. Esse valor é descontado antes de calcular uma compra possível.",
        "Maximum Coin spend on one purchase. Set to 0 for no extra cap beyond your reserve and balance.": "Gasto máximo em moedas por compra. Use 0 para não adicionar um limite além da reserva e do saldo.",
        "Maximum Gem spend on one purchase. Set to 0 for no extra cap beyond your reserve and balance.": "Gasto máximo em gemas por compra. Use 0 para não adicionar um limite além da reserva e do saldo.",
        "How many pages of completed-sale history to read. More pages take longer and use more requests.": "Quantidade de páginas do histórico de vendas concluídas a consultar. Mais páginas demoram mais e fazem mais requisições.",
        "Regular market": "Mercado normal",
        "Return to regular market": "Voltar ao mercado normal",
        "Open Moth Watch": "Abrir Moth Watch",
        "no offers found": "nenhuma oferta encontrada",
        "market request timed out": "tempo limite da consulta ao mercado",
        "Offers": "Ofertas",
        "Hide offers": "Ocultar ofertas",
        "Own listing": "Seu anúncio",
        "Offer count: {count}": "{count} ofertas",
        "Waiting for the market to return offers…": "Aguardando o mercado retornar as ofertas…",
        "No offers found in this currency.": "Nenhuma oferta encontrada nesta moeda.",
        "Market did not respond. Load offers again.": "O mercado não respondeu. Carregue as ofertas novamente.",
        "Refreshing offers…": "Atualizando ofertas…",
        "Moth Watch recommended price": "Preço recomendado pelo Moth Watch",
        "Use recommended price": "Usar preço recomendado",
        "7d sold average": "Média vendida em 7 dias",
        "stable active median": "Mediana dos anúncios estáveis",
        "sold units": "unidades vendidas",
        "current asks": "anúncios atuais",
        "High confidence": "Alta confiança",
        "Medium confidence": "Confiança média",
        "Low confidence": "Baixa confiança",
        "Waiting for market data…": "Aguardando dados do mercado…",
        "No reliable recommendation yet.": "Ainda não há dados suficientes para uma recomendação confiável.",
        "Based on completed sales first; unusually cheap active listings are treated as possible dumps.": "Prioriza vendas concluídas; anúncios ativos excepcionalmente baratos são tratados como possíveis liquidações.",
        "comparable completed sales · {count}": "vendas comparáveis concluídas · {count}",
        "Grade, level, quality, IVs and refinement": "Nota, nível, qualidade, IVs e refino",
        "Grade, level, quality and IVs": "Nota, nível, qualidade e IVs",
        "Grade, level and quality": "Nota, nível e qualidade",
        "Grade and level only": "Somente nota e nível",
        "Wider grade neighborhood": "Faixa de nota ampliada",
        "Broad species history only": "Apenas histórico geral da espécie",
        "N={grade} · Q={quality} · {confidence} confidence": "N={grade} · Q={quality} · confiança {confidence}",
        "sold-price middle range {low}–{high}": "faixa central das vendas {low}–{high}",
        "IV details unavailable": "IVs individuais indisponíveis",
        "IV {total}/192 · ATK {atk} · Sp.Atk {spAtk} · Speed {speed}": "IV {total}/192 · ATQ {atk} · At.Esp {spAtk} · Vel {speed}",
        "high": "alta",
        "medium": "média",
        "low": "baixa",
        "context": "contextual",
        "Any item rules": "Regras para qualquer item",
        "Pokémon purchase rules": "Regras de compra de Pokémon",
        "Any item": "Qualquer item",
        "Any Pokémon": "Qualquer Pokémon",
        "Shiny Pokémon": "Pokémon Shiny",
        "Pokémon price evidence": "Evidências de preços de Pokémon",
        "Read-only completed-sale comparisons. No purchase authorization.": "Comparações de vendas concluídas, somente leitura. Não autorizam compras.",
        "No sampled Pokémon listings yet. Activate Pokémon Watch or scan now.": "Ainda não há ofertas de Pokémon analisadas. Ative o monitoramento ou consulte agora.",
        "This is a bounded market sample, not every listing. Completed-sale evidence cannot authorize a purchase.": "Esta é uma amostra limitada do mercado, não todos os anúncios. Histórico de vendas não autoriza compras.",
        "Insufficient comparable sales": "Vendas comparáveis insuficientes",
        "No defensible completed-sale price range": "Sem faixa de preço de vendas verificável",
        "Completed sales · {count} matched of {total} · {confidence}": "Vendas concluídas · {count} comparáveis de {total} · confiança {confidence}",
        "Sale dates unverified": "Datas das vendas não verificadas",
        "Newest comparable sale: {days} days ago": "Venda comparável mais recente: há {days} dias",
        "Median {median} · IQR {low}–{high} · P10–P90 {p10}–{p90}": "Mediana {median} · intervalo central {low}–{high} · P10–P90 {p10}–{p90}",
        "Role: {role} ({source})": "Papel de combate: {role} ({source})",
        "physical": "físico",
        "special": "especial",
        "mixed": "misto",
        "unknown": "desconhecido",
        "equipped move categories": "categorias de golpes equipados",
        "provided base stats; moves unverified": "atributos-base fornecidos; golpes não verificados",
        "no verified equipped moves or bases": "sem golpes equipados ou atributos-base verificados",
        "Relevant IVs unknown": "IVs relevantes desconhecidos",
        "Form unknown": "Forma desconhecida",
        "Collectibles: {flags}": "Características especiais: {flags}",
        "No confirmed flags": "Nenhuma característica confirmada",
        "Other collectible flags unverified": "Outras características especiais não verificadas",
        "None": "Nenhum",
        "Missing listing fields: {fields}": "Campos ausentes no anúncio: {fields}",
        "Limits: {details}": "Limitações: {details}",
        "Comparison: {stage}": "Comparação: {stage}",
        "Recent listing observation": "Anúncio observado recentemente",
        "Stale listing observation": "Observação do anúncio desatualizada",
        "Asking/reference ratio: {percent}%": "Preço pedido/referência: {percent}%",
        "Asking/reference ratio unavailable": "Relação preço/referência indisponível",
        "Price unverified": "Preço não verificado",
        "No verified completed-sale reference": "Sem referência de venda concluída verificada",
        "Rule preview (not permission): {preview}": "Prévia das regras (não é autorização): {preview}",
        "No matching configured Pokémon rule": "Nenhuma regra de Pokémon correspondente",
        "Above price ceiling": "Acima do preço máximo",
        "Unverified listing price": "Preço do anúncio não verificado",
        "Awaiting reconciliation": "Aguardando reconciliação",
        "Matches absolute-price rule": "Corresponde à regra de preço absoluto",
        "Unknown Pokémon traits": "Atributos de Pokémon desconhecidos",
        "Unverified quantity": "Quantidade não verificada",
        "Unverified listing identity": "Identificador do anúncio não verificado",
        "Your own listing": "Anúncio do próprio jogador",
        "Listing still held": "Oferta ainda retida",
        "P5 Pokémon": "Pokémon P5",
        "Pokémon category": "Categoria de Pokémon",
        "Add any-item rule": "Adicionar regra para qualquer item",
        "Add Pokémon rule": "Adicionar regra de Pokémon",
        "No any-item rules configured.": "Nenhuma regra de qualquer item cadastrada.",
        "No Pokémon rules configured.": "Nenhuma regra de Pokémon cadastrada.",
        "Buy any item at or below this price per unit.": "Comprar qualquer item por este preço máximo por unidade.",
        "Buy matching Pokémon at or below the listed price; no valuation reference required.": "Comprar Pokémon da categoria pelo preço máximo do anúncio, sem exigir avaliação histórica.",
        "These rules scan up to three market pages per currency. Shiny requires Gems.": "Estas regras consultam até três páginas do mercado por moeda. Shiny exige Gemas.",
        "Any-item rules inspect current offers selectively; large catalogs can take time.": "Regras gerais de itens consultam anúncios seletivamente; catálogos grandes podem demorar.",
        "Rule configured — buying remains off until master switch is enabled.": "Regra cadastrada — a compra fica desligada até ativar a chave geral.",
        "An equivalent rule already exists for this currency.": "Já existe uma regra equivalente nesta moeda.",
        "Shiny purchases require Gems.": "Shiny exige Gemas.",
        "Price per Pokémon": "Preço por Pokémon",
        "Fixed item rules": "Regras fixas por item",
        "Buy at or below": "Comprar por até",
        "Add fixed rule": "Adicionar regra fixa",
        "No fixed item rules configured.": "Nenhuma regra fixa configurada.",
        "Enabled": "Ativada",
        "Remove": "Remover",
        "Item": "Item",
        "Market catalog is not loaded yet.": "O catálogo do mercado ainda não foi carregado.",
        "Automation status": "Status da automação",
        "Review the systems that can place market orders, then set spending safeguards and advanced monitoring.": "Revise os sistemas que podem enviar ordens ao mercado e depois ajuste os limites de segurança e o monitoramento avançado.",
        "Automation: {summary}": "Automação: {summary}",
        "Active": "Ativa",
        "Inactive": "Inativa",
        "{count} active rule": "{count} regra ativa",
        "{count} active rules": "{count} regras ativas",
        "No automated market orders are enabled.": "Nenhuma ordem automática de mercado está ativada.",
        "Spending safeguards": "Limites de segurança",
        "Advanced monitoring & references": "Monitoramento e referências avançados",
        "Scanning and reference-quality controls. These do not authorize orders by themselves.": "Controles de varredura e qualidade das referências. Sozinhos, eles não autorizam ordens.",
        "Find item": "Buscar item",
        "Search items…": "Buscar itens…",
        "Rule added: {name}.": "Regra adicionada: {name}.",
        "Rule removed: {name}.": "Regra removida: {name}.",
        "A rule for {name} in this currency already exists.": "Já existe uma regra para {name} nesta moeda.",
        "Choose an item before adding a rule.": "Escolha um item antes de adicionar a regra.",
        "Create a fixed rule": "Criar regra fixa",
        "Configured rules": "Regras cadastradas",
        "Price per unit": "Preços por unidade",
        "Buy every available unit affordable within reserves and purchase limits.": "Compra todas as unidades disponíveis no anúncio que couberem no saldo, nas reservas e no limite por compra.",
        "Automatic buying may use your entire available balance when reserves and spending limits are set to zero.": "Com reservas e limites por compra em zero, as compras automáticas podem gastar todo o saldo disponível. Ajuste esses limites antes de ativar.",
        "Rule-based buying": "Compra automática por regras",
        "Rule-based buying: {status}": "Compra por regras: {status}",
        "No automatic purchases enabled.": "Nenhuma compra automática ativada.",
        "Enable rule-based buying and at least one Buy rule with a maximum unit price. No other buying switches are required. Coin/Gem reserves and per-purchase caps still apply.": "Ative a compra por regras e pelo menos uma regra de compra com preço máximo por unidade. Nenhuma outra chave de compra é necessária. Reservas de Moedas/Gemas e limites por compra continuam valendo.",
        "Rule paused": "Regra pausada",
        "Moth Watch disabled": "Moth Watch desativado",
        "Enable rule-based buying above": "Ative a compra por regras acima",
        "Waiting for game connection": "Aguardando conexão com o jogo",
        "Insufficient spendable balance": "Saldo disponível insuficiente",
        "Checking listings…": "Consultando anúncios…",
        "Eligible listing available": "Anúncio elegível disponível",
        "Monitoring · no eligible listing": "Monitorando · nenhuma oferta elegível",
        "Set an item and its maximum unit price, for example Cocoon Stone at 30,000 Coins. Only matching offers can be purchased.": "Escolha um item e seu preço máximo por unidade, por exemplo Cocoon Stone por 30.000 moedas. Apenas ofertas que atendam à regra poderão ser compradas.",
        "Enable rule-based buying": "Ativar compra por regras",
        "Only a positive buy price activates a rule.": "Somente um preço máximo maior que zero ativa uma regra.",
        "Adding a rule does not turn on rule-based buying; enable the switch above.": "Criar a regra não ativa a automação; ligue a chave acima.",
        "Set a positive maximum buy price.": "Defina um preço máximo de compra maior que zero.",
        "Rule saved: {name}. Turn on rule-based buying to start.": "Regra salva: {name}. Ative a compra por regras para começar.",
        "Rule-based buying is on, but no Buy rules are active. Create or enable a rule first.": "A compra por regras está ativada, mas não há regras de compra ativas. Crie ou ative uma regra primeiro.",
        "Rule-based buying is on. No other purchase switches are required. Spending safeguards still apply.": "Compra por regras ativada. Nenhuma outra chave de compra é necessária. Os limites de segurança continuam valendo.",
        "Pause all purchases (kill switch)": "Pausar todas as compras (interruptor de emergência)",
        "Maximum Coins per session": "Máximo de moedas por sessão",
        "Maximum Gems per session": "Máximo de gemas por sessão",
        "Maximum Coins per UTC day": "Máximo de moedas por dia UTC",
        "Maximum Gems per UTC day": "Máximo de gemas por dia UTC",
        "Maximum purchases per session": "Máximo de compras por sessão",
        "Maximum units per session": "Máximo de unidades por sessão",
        "Session spend cap": "Gasto máximo da regra por sessão",
        "Daily spend cap (UTC)": "Gasto máximo da regra por dia UTC",
        "Purchases per session": "Compras da regra por sessão",
        "Units per session": "Unidades da regra por sessão",
        "Rule cumulative limits": "Limites acumulados da regra",
        "0 = unlimited cumulative limit": "0 = sem limite acumulado",
        "Spend cap is for the selected rule currency. 0 means unlimited.": "O limite de gasto usa a moeda da regra. Zero significa ilimitado.",
        "Budget blocked": "Bloqueado pelo orçamento",
        "Waiting for acknowledgement": "Aguardando confirmação",
        "Unknown purchase outcome": "Resultado da compra não verificado",
        "Purchases paused": "Compras pausadas",
        "Unverified orders: {count}": "Ordens não verificadas: {count}",
        "Session exposure: {gold} Coins · {orb} Gems": "Exposição nesta sessão: {gold} moedas · {orb} gemas",
        "Daily exposure: {gold} Coins · {orb} Gems": "Exposição no dia: {gold} moedas · {orb} gemas",
        "Includes reserved unverified orders. 0 means unlimited; per-purchase caps are separate.": "Inclui reservas de ordens não verificadas. Zero significa ilimitado; limites por compra são separados.",
        "A purchase may remain unverified after timeout or restart. Never retry that listing until authoritative reconciliation.": "Uma compra pode continuar não verificada após timeout ou reinício. Nunca repetir a mesma oferta sem confirmação do servidor.",
        "Stale or unverified quote · refresh listing": "Cotação desatualizada ou não verificada · atualize a oferta",
    });

    function tr(key, params = null) {
        const value = currentLocale() === 'pt-BR' ? (PT_BR[key] ?? key) : key;
        if (!params) return value;
        return value.replace(/\{(\w+)\}/g, (whole, name) =>
            params[name] !== undefined ? String(params[name]) : whole
        );
    }

    function displayStatus(value) {
        const text = String(value || 'waiting');
        if (currentLocale() !== 'pt-BR') return text;
        const loadingOffers = /^loading (.+) offers$/.exec(text);
        if (loadingOffers) return tr('loading {name} offers', { name: loadingOffers[1] });
        if (text === 'scanning · gems') return tr('scanning · Gems');
        if (text === 'scanning · coins') return tr('scanning · Coins');
        if (text === 'live · gems') return tr('live · Gems');
        if (text === 'live · coins') return tr('live · Coins');
        return tr(text);
    }

    function translateLog(value) {
        const text = String(value || '');
        if (currentLocale() !== 'pt-BR') return text;
        if (PT_BR[text]) return PT_BR[text];
        let match = /^Baseline frozen: (\d+) market items$/.exec(text);
        if (match) return tr('Baseline frozen: {count} market items', { count: num(Number(match[1])) });
        match = /^Baseline expanded with (\d+) missing Coin\/Gem references?$/.exec(text);
        if (match) return tr(Number(match[1]) === 1
            ? 'Baseline expanded with {count} missing Coin/Gem reference'
            : 'Baseline expanded with {count} missing Coin/Gem references', { count: num(Number(match[1])) });
        match = /^Pokémon reference refreshed: (\d+) buckets$/.exec(text);
        if (match) return tr('Pokémon reference refreshed: {count} buckets', { count: num(Number(match[1])) });
        match = /^Purchase confirmed · listing #(\d+)$/.exec(text);
        if (match) return tr('Purchase confirmed · listing #{id}', { id: match[1] });
        match = /^Skipped: not enough spendable balance for (.+)$/.exec(text);
        if (match) return tr('Skipped: not enough spendable balance for {name}', { name: match[1] });
        match = /^Purchase refused: (.+)$/.exec(text);
        if (match) return tr('Purchase refused: {message}', { message: match[1] });
        return text;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function num(value) {
        return Number(value || 0).toLocaleString(state.lastLocale || currentLocale());
    }

    function pct(value) {
        if (!Number.isFinite(value)) return '—';
        return (value * 100).toFixed(value < 0.1 ? 1 : 0) + '%';
    }

    function money(value, currency) {
        const src = currency === 'orb'
            ? '/img/moeda-gema.png'
            : '/assets/site/assets/ui/moeda-ouro.png';
        return '<span class="moth-mw-money"><img src="' + src + '" alt="">' + num(value) + '</span>';
    }


    function sanitizeRuleCaps(rule) {
        const number = key => {
            const n = Number(rule?.[key]);
            return Number.isSafeInteger(n) && n > 0 ? n : 0;
        };
        return {
            maxSpendSession: number('maxSpendSession'),
            maxSpendDay: number('maxSpendDay'),
            maxPurchasesSession: number('maxPurchasesSession'),
            maxQuantitySession: number('maxQuantitySession')
        };
    }

    function sanitizeFixedItemRules(value) {
        if (!Array.isArray(value)) return [];
        return value.map((rule, index) => {
            const itemId = Math.floor(Number(rule?.itemId));
            if (!(itemId > 0)) return null;
            return {
                id: String(rule?.id || ('fixed-' + index + '-' + itemId)),
                itemId,
                currency: rule?.currency === 'orb' ? 'orb' : 'gold',
                buyEnabled: rule?.buyEnabled !== false && Number(rule?.buyMax) > 0,
                buyMax: Math.max(0, Math.floor(Number(rule?.buyMax) || 0)),
                ...sanitizeRuleCaps(rule),
            };
        }).filter(Boolean);
    }


    function sanitizeAnyItemRules(value) {
        if (!Array.isArray(value)) return [];
        return value.map((rule, index) => {
            const buyMax = Math.floor(Number(rule?.buyMax));
            if (!Number.isSafeInteger(buyMax) || buyMax <= 0) return null;
            return { id: String(rule?.id || 'any-item-' + index),
                currency: rule?.currency === 'orb' ? 'orb' : 'gold',
                buyMax, buyEnabled: rule?.buyEnabled === true, ...sanitizeRuleCaps(rule) };
        }).filter(Boolean);
    }

    function sanitizePokemonBuyRules(value) {
        if (!Array.isArray(value)) return [];
        return value.map((rule, index) => {
            const buyMax = Math.floor(Number(rule?.buyMax));
            const kind = ['any', 'shiny', 'p5'].includes(rule?.kind) ? rule.kind : null;
            const currency = rule?.currency === 'orb' ? 'orb' : 'gold';
            if (!Number.isSafeInteger(buyMax) || buyMax <= 0 || !kind ||
                (kind === 'shiny' && currency !== 'orb')) return null;
            return { id: String(rule?.id || 'pokemon-' + index), kind, currency,
                buyMax, buyEnabled: rule?.buyEnabled === true, ...sanitizeRuleCaps(rule) };
        }).filter(Boolean);
    }

    function activeAnyItemRules() {
        return config.enabled && config.fixedRulesEnabled
            ? sanitizeAnyItemRules(config.anyItemRules).filter(rule => rule.buyEnabled) : [];
    }

    function activePokemonRules() {
        return config.enabled && config.fixedRulesEnabled
            ? sanitizePokemonBuyRules(config.pokemonBuyRules).filter(rule => rule.buyEnabled) : [];
    }

    function hasAnyBuyingRules() {
        return config.enabled && config.fixedRulesEnabled &&
            (sanitizeFixedItemRules(config.fixedItemRules).some(rule => rule.buyEnabled && rule.buyMax > 0) ||
                activeAnyItemRules().length > 0 || activePokemonRules().length > 0);
    }


    // Account-profile-local journal; unknown orders are retained after reload.
    // Never infer success from a send(), an inventory delta, or a timeout.
    function orderAccountKey() {
        // Storage keys never include the actual nickname.
        const name = normalize(state.nick || '');
        if (!name) return null;
        // Stable 64-bit FNV-1a for local partitioning, not authentication.
        let hash = 0xcbf29ce484222325n;
        for (const char of name) {
            hash = (hash ^ BigInt(char.codePointAt(0))) * 0x100000001b3n &
                0xffffffffffffffffn;
        }
        return hash.toString(16).padStart(16, '0');
    }

    function orderSessionId() {
        try {
            const accountKey = orderAccountKey();
            if (!accountKey) return null;
            const storageKey = ORDER_SESSION_KEY + ':' + accountKey;
            let id = sessionStorage.getItem(storageKey);
            if (!id) {
                id = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
                sessionStorage.setItem(storageKey, id);
            }
            return id;
        } catch { return null; }
    }

    function loadOrderJournal() {
        const accountKey = orderAccountKey();
        if (!accountKey) return null;
        let rows = [];
        try {
            const data = JSON.parse(localStorage.getItem(ORDER_JOURNAL_KEY + ':' + accountKey) || 'null');
            if (data?.version === 1 && Array.isArray(data.orders)) rows = data.orders;
        } catch {}
        const now = Date.now();
        const orders = rows.filter(o =>
            o && Number.isSafeInteger(o.listingId) && o.listingId > 0 &&
            ['gold', 'orb'].includes(o.currency) &&
            Number.isSafeInteger(o.sentAt) && o.sentAt > 0 && o.sentAt <= now + 60000 &&
            Number.isSafeInteger(o.qty) && o.qty > 0 &&
            Number.isSafeInteger(o.spend) && o.spend > 0 &&
            ['prepared', 'submitted', 'confirmed', 'refused', 'unknown'].includes(o.status) &&
            (o.status !== 'refused' && o.status !== 'confirmed' || now - o.sentAt < 3 * 86400000)
        ).map(o => ({
            listingId: o.listingId, currency: o.currency, sentAt: o.sentAt,
            qty: o.qty, spend: o.spend, ruleId: String(o.ruleId || ''),
            kind: String(o.kind || ''), sessionId: String(o.sessionId || ''),
            day: String(o.day || ''),
            status: ['prepared', 'submitted'].includes(o.status) ? 'unknown' : o.status
        })).slice(-2500);
        return { version: 1, accountKey, sessionId: orderSessionId(), orders };
    }

    function saveOrderJournal() {
        state.exposureCache?.clear();
        if (!state.orderJournal?.sessionId ||
            state.orderJournal.accountKey !== orderAccountKey()) return false;
        try {
            localStorage.setItem(ORDER_JOURNAL_KEY + ':' + state.orderJournal.accountKey,
                JSON.stringify(state.orderJournal));
            return true;
        } catch { return false; }
    }

    function orderDay(timestamp) {
        return new Date(timestamp).toISOString().slice(0, 10); // UTC day
    }

    function unresolvedListing(id) {
        return !!state.orderJournal?.orders.some(order =>
            order.listingId === id && order.status === 'unknown');
    }

    function unverifiedOrdersExist() {
        return !!state.orderJournal?.orders.some(order => order.status === 'unknown');
    }

    // Confirmed orders are charged at the quoted maximum for safety when
    // the acknowledgement omits actual settlement price or filled quantity.
    function orderExposure(scope, currency = null, ruleId = '') {
        const cache = state.exposureCache || (state.exposureCache = new Map());
        const key = scope + ':' + (currency || '*') + ':' + ruleId + ':' + orderDay(Date.now());
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < 1000) return hit.value;
        let spent = 0, count = 0, quantity = 0;
        for (const o of state.orderJournal?.orders || []) {
            if (o.status === 'refused' || currency && o.currency !== currency ||
                ruleId && o.ruleId !== ruleId ||
                scope === 'day' && o.day !== orderDay(Date.now()) ||
                scope === 'session' && o.sessionId !== state.orderJournal.sessionId) continue;
            spent += o.spend; count++; quantity += o.qty;
        }
        const value = { spent, count, quantity };
        cache.set(key, { at: Date.now(), value });
        return value;
    }

    function activeRuleById(id) {
        if (!id || !config.enabled || !config.fixedRulesEnabled || config.purchasesPaused) return null;
        const fixed = sanitizeFixedItemRules(config.fixedItemRules).find(r => r.id === id);
        if (fixed?.buyEnabled) return { ...fixed, type: 'fixed' };
        const any = sanitizeAnyItemRules(config.anyItemRules).find(r => r.id === id);
        if (any?.buyEnabled) return { ...any, type: 'any' };
        const pokemon = sanitizePokemonBuyRules(config.pokemonBuyRules).find(r => r.id === id);
        return pokemon?.buyEnabled ? { ...pokemon, type: 'pokemon' } : null;
    }

    function remainingBudget(currency, ruleId = '') {
        const limits = [
            [currency === 'orb' ? config.maxGemsPerSession : config.maxCoinsPerSession,
                orderExposure('session', currency).spent],
            [currency === 'orb' ? config.maxGemsPerDay : config.maxCoinsPerDay,
                orderExposure('day', currency).spent]
        ];
        const rule = ruleId ? activeRuleById(ruleId) : null;
        if (ruleId && !rule) return { spend: 0, quantity: 0 };
        if (rule) {
            limits.push([rule.maxSpendSession, orderExposure('session', currency, ruleId).spent],
                [rule.maxSpendDay, orderExposure('day', currency, ruleId).spent]);
        }
        let spend = Infinity;
        for (const [cap, used] of limits) {
            if (Number(cap) > 0) spend = Math.min(spend, Math.max(0, cap - used));
        }
        const session = orderExposure('session'), own = rule && orderExposure('session', null, ruleId);
        const maxCount = Math.min(
            Number(config.maxPurchasesPerSession) > 0
                ? Math.max(0, config.maxPurchasesPerSession - session.count) : Infinity,
            rule?.maxPurchasesSession > 0
                ? Math.max(0, rule.maxPurchasesSession - own.count) : Infinity
        );
        const quantity = Math.min(
            Number(config.maxQuantityPerSession) > 0
                ? Math.max(0, config.maxQuantityPerSession - session.quantity) : Infinity,
            rule?.maxQuantitySession > 0
                ? Math.max(0, rule.maxQuantitySession - own.quantity) : Infinity
        );
        return { spend: maxCount > 0 ? spend : 0, quantity };
    }

    function reserveOrder(order) {
        if (!state.orderJournal?.sessionId || state.orderJournal.orders.length >= 2500) return false;
        state.orderJournal.orders.push(order);
        if (saveOrderJournal()) return true;
        state.orderJournal.orders.pop();
        return false;
    }

    function settleOrder(order, status) {
        if (!order || !['confirmed', 'refused', 'unknown'].includes(status) ||
            ['confirmed', 'refused'].includes(order.status)) return false;
        order.status = status;
        saveOrderJournal();
        state.lastPurchaseOutcome = status;
        if (status === 'confirmed') {
            state.attemptedListings.set(order.listingId, Date.now() + 30 * 60000);
            addLog('Purchase confirmed · listing #' + order.listingId);
        } else if (status === 'refused') {
            state.attemptedListings.set(order.listingId, Date.now() + 5000);
        } else {
            state.attemptedListings.set(order.listingId, Number.MAX_SAFE_INTEGER);
            addLog('Purchase outcome unverified · listing #' + order.listingId);
        }
        queueRender();
        return true;
    }

    function resolveOrder(listingId, status) {
        if (state.pendingBuy?.listingId === listingId) {
            finishPendingBuy(status === 'confirmed' ? 'server-confirmed' : 'refused');
            return true;
        }
        const order = [...(state.orderJournal?.orders || [])].reverse().find(o =>
            o.listingId === listingId && o.status === 'unknown');
        if (order) return settleOrder(order, status);
        return false;
    }

    function currentRuleMatches(rule, candidate, price) {
        if (!rule || rule.currency !== candidate.currency || price > rule.buyMax) return false;
        if (rule.type === 'fixed') return candidate.kind === 'item' && candidate.itemId === rule.itemId;
        if (rule.type === 'any') return candidate.kind === 'item';
        return candidate.kind === 'pokemon' &&
            pokemonRuleMatches(rule, candidate.ficha, candidate.currency);
    }

    function freshQuote(candidate, manual) {
        const id = Number(candidate?.listingId), price = Number(candidate?.unitPrice || candidate?.price);
        const qty = Number(candidate?.qty), age = Date.now() - Number(candidate?.seenAt);
        return Number.isSafeInteger(id) && id > 0 &&
            ['gold', 'orb'].includes(candidate.currency) &&
            Number.isSafeInteger(price) && price > 0 &&
            Number.isSafeInteger(qty) && qty > 0 &&
            Number.isFinite(age) && age >= 0 && age <= QUOTE_MAX_AGE_MS &&
            !!state.nick && typeof candidate.seller === 'string' &&
            !!candidate.seller.trim() && candidate.seller !== '—' &&
            !isOwnListing({ vendedor: candidate.seller }) &&
            !(candidate.retainedUntil > serverNow()) && !unresolvedListing(id) &&
            (manual || candidate.kind !== 'pokemon' ||
                candidate.ficha && typeof candidate.ficha.shiny === 'boolean' &&
                Number.isSafeInteger(Number(candidate.ficha.potencia)) &&
                Number(candidate.ficha.potencia) >= 1 && Number(candidate.ficha.potencia) <= 5);
    }

    function loadConfig() {
        let saved = {};
        try {
            saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {};
        } catch {}

        // Retired configurations never re-enable removed automation.
        const loaded = { ...DEFAULTS };
        for (const key of Object.keys(DEFAULTS)) {
            if (Object.prototype.hasOwnProperty.call(saved, key)) loaded[key] = saved[key];
        }
        loaded.fixedItemRules = sanitizeFixedItemRules(saved.fixedItemRules);
        loaded.anyItemRules = sanitizeAnyItemRules(saved.anyItemRules);
        loaded.pokemonBuyRules = sanitizePokemonBuyRules(saved.pokemonBuyRules);
        return loaded;
    }

    function saveConfig() {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    }

    function emptyBaseline() {
        return { version: 1, capturedAt: 0, source: 'none', items: {} };
    }

    function loadBaseline() {
        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null');
        } catch {}

        if (saved && saved.items && typeof saved.items === 'object') {
            return saved;
        }

        const sourceEntries = Object.entries(HARD_CODED_ITEM_AVERAGES);
        if (sourceEntries.length) {
            return {
                version: 1,
                capturedAt: 0,
                source: 'hardcoded',
                items: Object.fromEntries(sourceEntries)
            };
        }

        return emptyBaseline();
    }

    function saveBaseline() {
        try {
            localStorage.setItem(BASELINE_KEY, JSON.stringify(state.baseline));
        } catch {}
    }

    function loadPokemonReference() {
        try {
            const raw = JSON.parse(localStorage.getItem(POKEMON_REFERENCE_KEY) || 'null');
            if (raw && raw.version === 3 && raw.values && typeof raw.values === 'object') return raw;
        } catch {}
        // v1/v2 caches lacked sale-date provenance and form separation; never reuse them as current prices.
        return { version: 3, capturedAt: 0, values: {} };
    }

    function savePokemonReference() {
        try {
            localStorage.setItem(POKEMON_REFERENCE_KEY, JSON.stringify(state.pokemonReference));
        } catch {}
    }

    function backgroundDelayMs() {
        const now = Date.now();
        return Math.max(
            0,
            Number(state.rateLimitedUntil || 0) - now,
            Number(state.lastBotSendAt || 0) + BACKGROUND_MIN_GAP_MS - now
        );
    }

    function send(payload) {
        const socket = state.gameSocket || state.socket;
        if (!socket || socket.readyState !== 1) return false;
        try {
            socket.send(JSON.stringify(payload));
            state.lastBotSendAt = Date.now();
            return true;
        } catch {
            return false;
        }
    }

    function sendBackground(payload) {
        if (backgroundDelayMs() > 0) return false;
        return send(payload);
    }

    function isRateLimitError(message) {
        const text = normalize([
            message && message.chave,
            message && message.msg,
            message && message.message
        ].filter(Boolean).join(' '));

        return (
            text.includes('muitas mensagens') ||
            text.includes('too many messages') ||
            text.includes('rate limit')
        );
    }

    function enterRateLimitBackoff() {
        state.rateLimitedUntil = Math.max(
            Number(state.rateLimitedUntil || 0),
            Date.now() + RATE_LIMIT_BACKOFF_MS
        );
        state.itemStatus = 'rate-limit backoff';
        state.pokemonStatus = 'rate-limit backoff';
        addLog('Server rate limit · background scans paused for 15s');
        queueRender();
    }

    function serverNow() {
        return Date.now() - Number(state.serverClockOffset || 0);
    }

    function mergePlayer(snapshot, full) {
        if (!snapshot || typeof snapshot !== 'object') return;

        const previousGold = state.gold;
        const previousOrbs = state.orbs;

        if (Number(snapshot.servidorAgora) > 0) {
            state.serverClockOffset = Date.now() - Number(snapshot.servidorAgora);
        }

        if (full || Object.prototype.hasOwnProperty.call(snapshot, 'nick')) {
            if (snapshot.nick) state.nick = String(snapshot.nick);
        }
        if (full || Object.prototype.hasOwnProperty.call(snapshot, 'gold')) {
            if (Number.isFinite(Number(snapshot.gold))) state.gold = Number(snapshot.gold);
        }
        if (full || Object.prototype.hasOwnProperty.call(snapshot, 'orbs')) {
            if (Number.isFinite(Number(snapshot.orbs))) state.orbs = Number(snapshot.orbs);
        }
        // Balance snapshots cannot settle orders.

        if (state.watchOpen && (previousGold !== state.gold || previousOrbs !== state.orbs)) {
            queueRender();
        }
    }

    function catalogName(itemId) {
        const id = Number(itemId);
        const item = state.catalog.get(id);
        const liveName = item && (item.nome || item.name);
        const assetName = state.itemNames.get(id);
        return liveName
            ? String(liveName)
            : assetName || 'Item #' + itemId;
    }

    function catalogRows(payload, keys) {
        if (Array.isArray(payload)) return payload;
        for (const key of keys) {
            if (Array.isArray(payload && payload[key])) return payload[key];
        }
        return [];
    }

    function refreshCatalogNames() {
        for (const candidate of state.candidates.values()) {
            if (candidate.kind === 'item') {
                candidate.name = catalogName(candidate.itemId);
            } else if (candidate.kind === 'pokemon' && candidate.ficha) {
                candidate.name = pokemonListingName(candidate.ficha);
            }
        }
        queueRender();
    }

    async function loadNameCatalogs() {
        const loadJson = async url => {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Catalog HTTP ' + response.status);
            return response.json();
        };

        try {
            const payload = await loadJson('/assets/items.json');
            for (const item of catalogRows(payload, ['items'])) {
                const id = Number(item && (item.itemId ?? item.id));
                const name = String(item && (item.nome || item.name) || '').trim();
                if (Number.isFinite(id) && id > 0 && name) {
                    state.itemNames.set(id, name);
                }
            }
        } catch (error) {
            console.warn('[Moth Watch] item-name catalog unavailable', error);
        }

        for (const url of [
            '/assets/creatures.json',
            '/assets/creatures-outland-novos.json'
        ]) {
            try {
                const payload = await loadJson(url);
                for (const creature of catalogRows(payload, ['creatures', 'pokemon', 'pokemons', 'patches'])) {
                    const id = Number(
                        creature && (
                            creature.pokeId ??
                            creature.speciesId ??
                            creature.id
                        )
                    );
                    const name = String(
                        creature && (
                            creature.name ||
                            creature.nome ||
                            creature.speciesName ||
                            creature.nomePokemon
                        ) || ''
                    ).trim();
                    if (Number.isFinite(id) && id > 0 && name) {
                        state.creatureNames.set(id, name);
                    }
                }
            } catch (error) {
                console.warn('[Moth Watch] Pokémon-name catalog unavailable at ' + url, error);
            }
        }

        refreshCatalogNames();
    }

    function freezeItemBaseline(medias, force) {
        if (!medias || typeof medias !== 'object') return false;
        if (!force && state.baseline && state.baseline.capturedAt) return false;

        const ids = new Set([
            ...Array.from(state.catalog.keys()).map(String),
            ...Object.keys(medias)
        ]);

        const items = {};
        for (const rawId of ids) {
            const id = Number(rawId);
            if (!Number.isFinite(id) || id <= 0) continue;
            const m = medias[id] || medias[String(id)] || null;
            const gold = m && m.gold && Number(m.gold.media) > 0
                ? { average: Number(m.gold.media), units: Number(m.gold.unidades || 0) }
                : null;
            const orb = m && m.orb && Number(m.orb.media) > 0
                ? { average: Number(m.orb.media), units: Number(m.orb.unidades || 0) }
                : null;

            items[id] = {
                name: catalogName(id),
                gold: gold,
                orb: orb
            };
        }

        state.baseline = {
            version: 1,
            capturedAt: Date.now(),
            source: 'server-7d-weighted-average',
            items: items
        };
        state.forceBaselineNext = false;
        saveBaseline();
        addLog('Baseline frozen: ' + Object.keys(items).length + ' market items');
        queueRender();
        return true;
    }

    function supplementItemBaseline(medias) {
        if (!state.baseline?.capturedAt || !medias || typeof medias !== 'object') return false;

        let added = 0;
        const items = state.baseline.items || (state.baseline.items = {});

        for (const [rawId, m] of Object.entries(medias)) {
            const id = Number(rawId);
            if (!Number.isFinite(id) || id <= 0 || !m) continue;

            const row = items[id] || items[String(id)] || {
                name: catalogName(id),
                gold: null,
                orb: null
            };

            for (const currency of ['gold', 'orb']) {
                if (row[currency] && Number(row[currency].average) > 0) continue;
                const src = m[currency];
                if (!src || !(Number(src.media) > 0)) continue;
                row[currency] = {
                    average: Number(src.media),
                    units: Number(src.unidades || 0)
                };
                added++;
            }

            items[id] = row;
        }

        if (!added) return false;

        saveBaseline();
        addLog('Baseline expanded with ' + added + ' missing Coin/Gem reference' + (added === 1 ? '' : 's'));
        return true;
    }

    function itemReference(itemId, currency) {
        /*
         * The server's 7-day weighted mean is useful, but a single extreme
         * trade can distort a mean. Once we have at least three current
         * listings for this item/currency, cap that historical reference at
         * the median active unit price. This is deliberately conservative:
         * Moth Watch may miss a deal, but it will not call a normal 70k
         * market a 99% discount because one historical mean says 6M.
         */
        let historical = null;

        const liveRow = itemMediaFor(itemId);
        const live = liveRow ? liveRow[currency] : null;
        if (
            live &&
            Number.isFinite(Number(live.media)) &&
            Number(live.media) > 0
        ) {
            historical = {
                average: Number(live.media),
                units: Number(live.unidades || 0),
                name: catalogName(itemId),
                source: 'live-7d'
            };
        }

        if (!historical) {
            const row = state.baseline && state.baseline.items
                ? state.baseline.items[itemId] || state.baseline.items[String(itemId)]
                : null;
            const ref = row ? row[currency] : null;
            if (ref && Number.isFinite(Number(ref.average)) && Number(ref.average) > 0) {
                historical = {
                    average: Number(ref.average),
                    units: Number(ref.units || 0),
                    name: row.name || catalogName(itemId),
                    source: 'frozen-fallback'
                };
            }
        }

        if (!historical) return null;

        const capKey = String(itemId) + ':' + currency;
        const cap = state.itemMarketCaps.get(capKey);
        if (
            cap &&
            Date.now() - Number(cap.updatedAt || 0) <= ITEM_MARKET_CAP_TTL_MS &&
            Number(cap.count) >= 3 &&
            Number.isFinite(Number(cap.median)) &&
            Number(cap.median) > 0 &&
            Number(cap.median) < historical.average
        ) {
            return {
                average: Number(cap.median),
                units: historical.units,
                name: historical.name,
                source: 'active-median',
                activeListings: Number(cap.count),
                serverAverage: historical.average
            };
        }

        return historical;
    }


    function roundSellRecommendation(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return 0;
        let step = 1;
        if (n >= 1000000000) step = 10000000;
        else if (n >= 100000000) step = 1000000;
        else if (n >= 10000000) step = 100000;
        else if (n >= 1000000) step = 10000;
        else if (n >= 100000) step = 1000;
        else if (n >= 10000) step = 500;
        else if (n >= 1000) step = 100;
        else if (n >= 100) step = 10;
        return Math.max(1, Math.round(n / step) * step);
    }

    function sellPriceRecommendation(itemId, currency) {
        const liveRow = itemMediaFor(itemId);
        const sold = liveRow ? liveRow[currency] : null;
        const soldAverage = Number(sold?.media);
        const soldUnits = Number(sold?.unidades || 0);
        const hasSoldAverage = Number.isFinite(soldAverage) && soldAverage > 0;

        const key = String(itemId) + ':' + currency;
        const detail = state.itemOfferDetails.get(key);
        const asks = (detail?.offers || [])
            .filter(offer => offer && !isOwnListing(offer))
            .map(offer => Number(offer.preco))
            .filter(price => Number.isFinite(price) && price > 0)
            .sort((a, b) => a - b);

        let stableAsks = asks;
        if (hasSoldAverage && asks.length) {
            const band = asks.filter(price =>
                price >= soldAverage * 0.65 &&
                price <= soldAverage * 1.60
            );
            if (band.length >= 2) stableAsks = band;
        } else if (asks.length >= 5) {
            const trim = Math.max(1, Math.floor(asks.length * 0.20));
            stableAsks = asks.slice(trim, asks.length - trim);
            if (!stableAsks.length) stableAsks = asks;
        }

        const activeMedian = stableAsks.length ? median(stableAsks) : 0;
        const activeP75 = stableAsks.length
            ? stableAsks[Math.min(stableAsks.length - 1, Math.floor((stableAsks.length - 1) * 0.75))]
            : 0;
        let raw = 0;
        let confidence = 'low';

        if (hasSoldAverage) {
            // Completed sales are the primary signal. A stronger current market can raise
            // the target, but only modestly; cheap dump listings never drag it downward.
            raw = soldAverage;
            if (activeMedian > soldAverage) {
                raw = Math.min(activeMedian, soldAverage * 1.15);
            }
            if (soldUnits >= Math.max(10, Number(config.minItemUnits || 5)) && stableAsks.length >= 3) {
                confidence = 'high';
            } else if (soldUnits >= Number(config.minItemUnits || 5) || stableAsks.length >= 3) {
                confidence = 'medium';
            }
        } else if (activeMedian > 0) {
            raw = activeMedian;
            confidence = stableAsks.length >= 4 ? 'medium' : 'low';
        }

        let patientRaw = raw;
        if (hasSoldAverage) {
            patientRaw = Math.max(
                raw,
                Math.min(Math.max(soldAverage * 1.10, activeP75 || 0), soldAverage * 1.25)
            );
        } else if (activeP75 > 0) {
            patientRaw = Math.max(raw, activeP75);
        }

        return {
            price: roundSellRecommendation(raw),
            patientPrice: roundSellRecommendation(patientRaw),
            soldAverage: hasSoldAverage ? soldAverage : 0,
            soldUnits,
            activeMedian: Number(activeMedian) || 0,
            activeCount: asks.length,
            stableCount: stableAsks.length,
            confidence
        };
    }

    function sellRecommendationCurrency(corpo) {
        const active = corpo?.querySelector('.cm-moeda.on[data-moeda]');
        return active?.dataset?.moeda === 'orb' ? 'orb' : 'gold';
    }

    function ensureSellPriceRecommendation() {
        const corpo = q('#modal .cm-folha-corpo');
        const input = corpo?.querySelector('#cm-preco');
        const itemNode = corpo?.querySelector('.dlg-ator-fig[data-dlg-item]');
        const refs = corpo?.querySelector('#cm-preco-refs');

        if (!corpo || !input || !itemNode || !refs) {
            state.sellRecommendationKey = null;
            return;
        }

        const itemId = Number(itemNode.dataset.dlgItem);
        if (!Number.isFinite(itemId) || itemId <= 0) {
            state.sellRecommendationKey = null;
            return;
        }

        const currency = sellRecommendationCurrency(corpo);
        const key = String(itemId) + ':' + currency;
        if (state.sellRecommendationKey !== key) {
            state.sellRecommendationKey = key;
            state.lastDetailRequest.delete(key);
            queueItemDetail(itemId, currency);
        }

        let host = corpo.querySelector('#moth-sell-recommendation');
        if (!host) {
            host = document.createElement('div');
            host.id = 'moth-sell-recommendation';
            host.className = 'moth-sell-recommendation';
            refs.insertAdjacentElement('afterend', host);
        }

        const recommendation = sellPriceRecommendation(itemId, currency);
        const currencyIcon = currency === 'orb'
            ? '/img/moeda-gema.png'
            : '/assets/site/assets/ui/moeda-ouro.png';
        const confidenceLabel =
            recommendation.confidence === 'high'
                ? tr('High confidence')
                : recommendation.confidence === 'medium'
                    ? tr('Medium confidence')
                    : tr('Low confidence');

        if (!(recommendation.price > 0)) {
            host.innerHTML =
                '<div class="moth-sell-rec-head"><b>' + escapeHtml(tr('Moth Watch recommended price')) + '</b>' +
                '<span>' + escapeHtml(tr('Waiting for market data…')) + '</span></div>' +
                '<div class="moth-sell-rec-note">' + escapeHtml(tr('No reliable recommendation yet.')) + '</div>';
        } else {
            const evidence = [];
            if (recommendation.soldAverage > 0) {
                evidence.push(
                    tr('7d sold average') + ': ' + num(Math.round(recommendation.soldAverage)) +
                    ' · ' + num(recommendation.soldUnits) + ' ' + tr('sold units')
                );
            }
            if (recommendation.activeMedian > 0) {
                evidence.push(
                    tr('stable active median') + ': ' + num(Math.round(recommendation.activeMedian)) +
                    ' · ' + num(recommendation.activeCount) + ' ' + tr('current asks')
                );
            }

            host.innerHTML =
                '<div class="moth-sell-rec-head"><b>' + escapeHtml(tr('Moth Watch recommended price')) + '</b>' +
                '<span class="moth-sell-confidence ' + escapeHtml(recommendation.confidence) + '">' +
                escapeHtml(confidenceLabel) + '</span></div>' +
                '<button type="button" class="moth-sell-rec-price" data-moth-sell-price="' + recommendation.price + '">' +
                '<img src="' + escapeHtml(currencyIcon) + '" alt="">' +
                '<strong>' + num(recommendation.price) + '</strong>' +
                '<span>' + escapeHtml(tr('Use recommended price')) + '</span></button>' +
                (evidence.length
                    ? '<div class="moth-sell-rec-evidence">' + evidence.map(escapeHtml).join('<br>') + '</div>'
                    : '') +
                '<div class="moth-sell-rec-note">' +
                escapeHtml(tr('Based on completed sales first; unusually cheap active listings are treated as possible dumps.')) +
                '</div>';

            const useButton = host.querySelector('[data-moth-sell-price]');
            if (useButton) {
                useButton.onclick = () => {
                    const value = Number(useButton.dataset.mothSellPrice);
                    if (!(value > 0)) return;
                    input.value = String(value);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                };
            }
        }

        if (!corpo.dataset.mothSellCurrencyWatch) {
            corpo.dataset.mothSellCurrencyWatch = '1';
            corpo.querySelector('.cm-moedas')?.addEventListener('click', () => {
                setTimeout(() => {
                    state.sellRecommendationKey = null;
                    ensureSellPriceRecommendation();
                }, 0);
            });
        }
    }

    function queueItemDetail(itemId, currency) {
        const key = String(itemId) + ':' + currency;
        const now = Date.now();
        if (state.detailPending?.key === key) return;
        const urgent = state.selectedItemFocus?.key === key || state.sellRecommendationKey === key;
        const rulePriority = state.ruleItemKeys.has(key);
        const priorityIndex = () => {
            if (urgent) return 0;
            const index = state.detailQueue.findIndex(job =>
                !state.ruleItemKeys.has(job.key) &&
                state.selectedItemFocus?.key !== job.key &&
                state.sellRecommendationKey !== job.key);
            return index < 0 ? state.detailQueue.length : index;
        };
        const queuedIndex = state.detailQueue.findIndex(job => job.key === key);
        if (queuedIndex >= 0) {
            if ((urgent && queuedIndex > 0) || (rulePriority && queuedIndex > priorityIndex())) {
                const [job] = state.detailQueue.splice(queuedIndex, 1);
                state.detailQueue.splice(priorityIndex(), 0, job);
                scheduleItemDetailPump(0);
            }
            return;
        }
        if (now - Number(state.lastDetailRequest.get(key) || 0) < Math.max(1000, config.scanSeconds * 800)) return;
        if (state.detailQueue.length >= MAX_DETAIL_QUEUE && !urgent) return;
        state.detailQueued.add(key);
        const job = { itemId: Number(itemId), currency: currency, key: key, enqueuedAt: now };
        if (urgent || rulePriority) state.detailQueue.splice(priorityIndex(), 0, job);
        else state.detailQueue.push(job);
        scheduleItemDetailPump(0);
    }

    function scheduleItemDetailPump(delay) {
        if (state.detailPumpTimer) return;
        state.detailPumpTimer = setTimeout(() => {
            state.detailPumpTimer = null;
            pumpItemDetails();
        }, Math.max(0, Number(delay) || 0));
    }

    function finishItemDetailRequest(pending, result) {
        if (!pending || state.detailPending?.key !== pending.key) return;
        state.detailPending = null;
        if (state.detailPumpTimer) {
            clearTimeout(state.detailPumpTimer);
            state.detailPumpTimer = null;
        }
        if (state.selectedItemFocus?.key === pending.key) {
            state.itemDetailStatus = {
                key: pending.key,
                itemId: pending.itemId,
                currency: pending.currency,
                status: result,
                at: Date.now()
            };
            if (result === 'loaded') {
                state.itemStatus = 'live';
            } else if (result === 'empty') {
                state.itemStatus = 'no offers found';
            }
        }
        queueRender();
        if (state.detailQueue.length) {
            scheduleItemDetailPump(BACKGROUND_MIN_GAP_MS);
        }
    }

    function pumpItemDetails() {
        if (state.detailPending) {
            const pending = state.detailPending;
            const elapsed = Date.now() - Number(pending.sentAt || 0);
            const remaining = 6500 - elapsed;
            if (remaining > 0) {
                scheduleItemDetailPump(remaining + 25);
                return;
            }
            finishItemDetailRequest(pending, 'timeout');
            return;
        }

        if (!state.detailQueue.length) return;
        const queuedJob = state.detailQueue[0];
        if (
            state.selectedItemFocus?.key === queuedJob.key &&
            Date.now() - Number(queuedJob.enqueuedAt || Date.now()) >= 20000
        ) {
            state.detailQueue.shift();
            state.detailQueued.delete(queuedJob.key);
            state.itemDetailStatus = {
                key: queuedJob.key,
                itemId: queuedJob.itemId,
                currency: queuedJob.currency,
                status: 'timeout',
                at: Date.now()
            };
            state.itemStatus = 'market request timed out';
            queueRender();
            if (state.detailQueue.length) scheduleItemDetailPump(0);
            return;
        }

        if (!state.socket || state.socket.readyState !== 1) {
            scheduleItemDetailPump(BACKGROUND_MIN_GAP_MS);
            return;
        }

        const delay = backgroundDelayMs();
        if (delay > 0) {
            scheduleItemDetailPump(delay + 25);
            return;
        }

        const job = state.detailQueue[0];
        if (!sendBackground({ t: 'market.item', itemId: job.itemId, moeda: job.currency })) {
            scheduleItemDetailPump(BACKGROUND_MIN_GAP_MS);
            return;
        }

        state.detailQueue.shift();
        state.detailQueued.delete(job.key);
        state.lastDetailRequest.set(job.key, Date.now());
        state.detailPending = {
            itemId: job.itemId,
            currency: job.currency,
            key: job.key,
            sentAt: Date.now()
        };
        scheduleItemDetailPump(6525);
    }

    function discoveryRatio() {
        return Math.max(0.01, Number(config.watchPercent) / 100);
    }

    function scanSuspiciousItemSummaries() {
        const summary = state.itemSummary || {};
        const scanRatio = discoveryRatio();
        const stats = {
            goldChecked: 0,
            orbChecked: 0,
            goldSuspicious: 0,
            orbSuspicious: 0
        };
        const ids = new Set([
            ...Object.keys(state.liveItemAverages || {}),
            ...Object.keys(state.baseline.items || {})
        ]);

        for (const rawId of ids) {
            const id = Number(rawId);
            if (!Number.isFinite(id) || id <= 0) continue;

            const r = summary[id] || summary[rawId];
            if (!r || !r.anuncios) continue;

            for (const currency of ['gold', 'orb']) {
                const ref = itemReference(id, currency);
                if (!ref || !(Number(ref.average) > 0)) continue;

                const checkedKey = currency === 'orb' ? 'orbChecked' : 'goldChecked';
                const suspiciousKey = currency === 'orb' ? 'orbSuspicious' : 'goldSuspicious';
                stats[checkedKey]++;

                const min = currency === 'orb' ? Number(r.minOrb) : Number(r.minGold);
                if (!Number.isFinite(min) || min <= 0) continue;
                if (min <= Number(ref.average) * scanRatio) {
                    stats[suspiciousKey]++;
                    // Prioritize configured purchases when the Watch panel is
                    // closed. Opportunity discovery resumes when opened.
                    if (state.watchOpen || !config.fixedRulesEnabled || !state.ruleItemKeys.size) {
                        queueItemDetail(id, currency);
                    }
                }
            }
        }

        state.itemScanStats = stats;
    }

    function removeCandidateGroup(prefix) {
        const now = serverNow();
        for (const [key, candidate] of Array.from(state.candidates.entries())) {
            if (!key.startsWith(prefix)) continue;
            /*
             * A recent-list page can move a new listing off page 0 long
             * before its market retention expires. Keep it locally until
             * unlock; the purchase request itself is still validated by the
             * server if the seller cancels or somebody else wins it.
             */
            if (candidate.retainedUntil && candidate.retainedUntil > now) continue;
            state.candidates.delete(key);
        }
    }

    function retentionUntil(listing) {
        const t = Number(listing && listing.compravelEm);
        return Number.isFinite(t) && t > serverNow() ? t : 0;
    }

    function scheduleCandidateRelease(candidate) {
        if (!candidate || !candidate.retainedUntil) return;
        if (candidate.retainedUntil <= serverNow()) return;

        const existing = state.releaseTimers.get(candidate.listingId);
        if (existing && existing.at === candidate.retainedUntil) return;
        if (existing) clearTimeout(existing.timer);

        const delay = Math.max(
            0,
            Math.min(
                2_147_000_000,
                candidate.retainedUntil - serverNow() + 500
            )
        );

        const timer = setTimeout(() => {
            state.releaseTimers.delete(candidate.listingId);
            const current = state.candidates.get(candidate.key);
            if (!current) return;

            /*
             * Adding stock to a live listing restarts retention upstream.
             * A fresher scan may therefore have moved the timestamp after
             * this timer was created. Never erase that newer hold.
             */
            if (current.retainedUntil > serverNow()) {
                scheduleCandidateRelease(current);
                queueRender();
                return;
            }

            current.retainedUntil = 0;
            queueRender();
        }, delay);

        state.releaseTimers.set(candidate.listingId, {
            timer: timer,
            at: candidate.retainedUntil
        });
    }

    function isOwnListing(listing) {
        return !!state.nick &&
            normalize(listing && listing.vendedor) === normalize(state.nick);
    }

    function addCandidate(candidate) {
        const now = Date.now();
        const previous = state.candidates.get(candidate.key);
        const cached = state.firstSeenCache.get(candidate.key);
        const cachedIsFresh = cached && now - Number(cached.lastSeenAt || 0) <= 60 * 60 * 1000;
        if (previous && Number(previous.firstSeenAt) > 0) candidate.firstSeenAt = previous.firstSeenAt;
        else if (cachedIsFresh && Number(cached.firstSeenAt) > 0) candidate.firstSeenAt = cached.firstSeenAt;
        candidate.firstSeenAt = Number(candidate.firstSeenAt) > 0 ? Number(candidate.firstSeenAt) : now;
        state.firstSeenCache.set(candidate.key, { firstSeenAt: candidate.firstSeenAt, lastSeenAt: now });
        state.candidates.set(candidate.key, candidate);
        while (state.candidates.size > MAX_CANDIDATES) {
            const oldest = state.candidates.keys().next().value;
            const evicted = state.candidates.get(oldest);
            state.candidates.delete(oldest);
            if (evicted) {
                const release = state.releaseTimers.get(evicted.listingId);
                if (release) clearTimeout(release.timer);
                state.releaseTimers.delete(evicted.listingId);
            }
        }
        while (state.firstSeenCache.size > MAX_FIRST_SEEN) {
            state.firstSeenCache.delete(state.firstSeenCache.keys().next().value);
        }
        scheduleCandidateRelease(candidate);
        queueRender();
    }

    function pruneDetailCache() {
        for (const [key, record] of state.itemOfferDetails) {
            if (record.updatedAt < Date.now() - 300000 &&
                state.selectedItemFocus?.key !== key) state.itemOfferDetails.delete(key);
        }
        if (state.itemOfferDetails.size > MAX_DETAIL_CACHE) {
            const sorted = [...state.itemOfferDetails].sort((a,b) => a[1].updatedAt - b[1].updatedAt);
            for (const [key] of sorted.slice(0, state.itemOfferDetails.size - MAX_DETAIL_CACHE)) {
                if (state.selectedItemFocus?.key !== key) state.itemOfferDetails.delete(key);
            }
        }
    }

    function handleItemListings(message) {
        // Matches upstream Community Market response fields: itemId, moeda and linhas.
        const itemId = Number(message.itemId);
        const currency = message.moeda === 'orb' || message.moeda === 'gold' ? message.moeda : null;
        if (!Number.isSafeInteger(itemId) || itemId <= 0 || !currency) return;
        if (!state.detailPending || state.detailPending.itemId !== itemId ||
            state.detailPending.currency !== currency || communityMarketIsOpen()) return;
        const lines = Array.isArray(message.linhas) ? message.linhas : [];
        const pending = state.detailPending;
        if (pending && pending.itemId === itemId && pending.currency === currency) {
            finishItemDetailRequest(pending, lines.length ? 'loaded' : 'empty');
        }
        processItemListingPayload(itemId, currency, lines);
    }

    function processItemListingPayload(itemId, currency, lines) {
        const detailKey = String(itemId) + ':' + currency;
        const offers = Array.isArray(lines) ? lines.slice(0, 120) : [];
        const explicitlyLoaded = state.loadedItemKeys.has(detailKey);
        const selected = state.selectedItemFocus?.key === detailKey;
        const neededForRecommendation = state.sellRecommendationKey === detailKey;
        if (explicitlyLoaded || selected || neededForRecommendation || state.ruleItemKeys.has(detailKey)) {
            state.itemOfferDetails.set(detailKey, { itemId, currency, offers, updatedAt: Date.now() });
            pruneDetailCache();
            state.itemDetailStatus = {
                key: detailKey,
                itemId,
                currency,
                status: offers.length ? 'loaded' : 'empty',
                at: Date.now()
            };
        }

        const activePrices = offers
            .map(listing => Number(listing && listing.preco))
            .filter(price => Number.isFinite(price) && price > 0);
        if (activePrices.length >= 3) {
            state.itemMarketCaps.set(detailKey, {
                median: median(activePrices),
                count: activePrices.length,
                updatedAt: Date.now()
            });
        } else {
            state.itemMarketCaps.delete(detailKey);
        }

        const ref = itemReference(itemId, currency);
        if (!ref && !explicitlyLoaded) {
            queueRender();
            return;
        }

        const group = 'item:' + itemId + ':' + currency + ':';
        removeCandidateGroup(group);
        const scanRatio = discoveryRatio();
        for (const listing of offers) {
            if (!listing || isOwnListing(listing)) continue;
            const price = Number(listing.preco);
            const qty = Number(listing.qtd);
            if (!Number.isSafeInteger(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) continue;
            const ratio = ref && Number(ref.average) > 0 ? price / Number(ref.average) : 1;
            if (ref && ratio > scanRatio && !explicitlyLoaded) continue;
            addCandidate({
                key: group + listing.id,
                kind: 'item',
                listingId: Number(listing.id),
                itemId,
                name: ref && ref.name || catalogName(itemId),
                currency,
                price,
                average: ref ? Number(ref.average) || 0 : 0,
                samples: ref ? Number(ref.units) || 0 : 0,
                referenceSource: ref ? ref.source : 'none',
                activeReferenceListings: ref ? Number(ref.activeListings || 0) : 0,
                serverAverage: ref ? Number(ref.serverAverage || 0) : 0,
                ratio,
                qty,
                seller: String(listing.vendedor || '—'),
                retainedUntil: retentionUntil(listing),
                firstSeenAt: Date.now(),
                seenAt: Date.now()
            });
        }
        queueRender();
    }

    function itemMediaFor(id) {
        return state.liveItemAverages[id] || state.liveItemAverages[String(id)] || null;
    }

    function handleItemSummary(message) {
        state.itemSummary = message.resumo || {};
        state.liveItemAverages = message.medias || {};
        state.itemSummaryAt = Date.now();
        state.itemStatus = 'live';

        if (!state.baseline.capturedAt || state.forceBaselineNext) {
            freezeItemBaseline(state.liveItemAverages, true);
        } else {
            supplementItemBaseline(state.liveItemAverages);
        }

        scanSuspiciousItemSummaries();
        queueRender();
    }

    function levelBand(level) {
        const n = Number(level || 0);
        if (n < 100) return 'lt100';
        if (n < 500) return '100-499';
        if (n < 1000) return '500-999';
        if (n < 5000) return '1000-4999';
        if (n < 10000) return '5000-9999';
        if (n < 25000) return '10000-24999';
        return '25000+';
    }

    function speciesIdOf(ficha) {
        const id = Number(ficha && (ficha.speciesId != null ? ficha.speciesId : ficha.pokeId));
        return Number.isFinite(id) && id > 0 ? id : null;
    }

    function pokemonSpeciesName(ficha) {
        const suppliedName = String(
            ficha && (
                ficha.nome ||
                ficha.name ||
                ficha.speciesName ||
                ficha.pokemonNome ||
                ficha.especie?.nome ||
                ficha.pokemon?.nome ||
                ficha.pokemon?.name
            ) || ''
        ).trim();
        if (suppliedName) return suppliedName;

        const speciesId = speciesIdOf(ficha);
        return (speciesId && state.creatureNames.get(speciesId)) ||
            'Pokémon #' + (speciesId || '?');
    }

    function pokemonListingName(ficha) {
        const shiny = ficha?.shiny === true ? 'Shiny ' : '';
        const facts = pokemonFacts(ficha);
        return shiny + pokemonSpeciesName(ficha) +
            ' · P' + (facts.potency ?? '?') +
            ' · Lv ' + (facts.level ?? '?');
    }

    // PokéIdle v1.269.5: shiny Pokémon cannot be listed for Coins.
    // Do not mix historical Coin sales into shiny price references.
    function pokemonCurrencyAllowed(ficha, currency) {
        return currency === 'orb' || !ficha?.shiny;
    }

    // Non-identifying valuation facts. Missing metadata stays unknown.
    // Explicit forms are separate; absent form information is not assumed base.
    function pokemonForm(ficha) {
        const raw = ficha?.formId ?? ficha?.formaId;
        return (typeof raw === 'string' || Number.isSafeInteger(raw)) &&
            /^[a-z0-9_-]{1,36}$/i.test(String(raw)) ? String(raw) : null;
    }

    function pokemonIdentityKey(ficha, currency) {
        if (!['gold', 'orb'].includes(currency) || !pokemonCurrencyAllowed(ficha, currency)) return null;
        const speciesId = speciesIdOf(ficha);
        const potency = Number(ficha?.potencia);
        // Missing shiny is *not* non-Shiny. Require explicit server facts.
        if (!speciesId || typeof ficha?.shiny !== 'boolean' ||
            !Number.isSafeInteger(potency) || potency < 1 || potency > 5) return null;
        const form = pokemonForm(ficha);
        return currency + '|s:' + speciesId + '|f:' + (form == null ? '?' : form) +
            '|sh:' + (ficha.shiny ? 1 : 0) + '|p:' + potency;
    }

    function pokemonScore(ficha) {
        const raw = ficha?.nota;
        if (raw == null || raw === '') return null;
        const score = Number(raw);
        return Number.isFinite(score) && score >= 0 && score <= 10
            ? Math.round(score * 1000) / 1000 : null;
    }

    function pokemonQuality(ficha) {
        const raw = ficha?.qualidade ?? ficha?.quality;
        if (raw == null || raw === '') return null;
        const quality = Number(raw);
        return Number.isFinite(quality) && quality >= 0.8 && quality <= 1.8
            ? quality : null;
    }

    function pokemonIVs(ficha) {
        const raw = ficha?.ivs ?? ficha?.IVs;
        if (!raw || Array.isArray(raw) || typeof raw !== 'object') return null;
        const aliases = [
            ['hp', 'HP'], ['atk', 'attack', 'ataque'], ['def', 'defense', 'defesa'],
            ['spAtk', 'spa', 'sp_atk', 'specialAttack', 'atkEsp'],
            ['spDef', 'spd', 'sp_def', 'specialDefense', 'defEsp'],
            ['speed', 'spe', 'velocidade']
        ];
        const values = aliases.map(names => {
            const name = names.find(key => Object.prototype.hasOwnProperty.call(raw, key));
            return name == null ? NaN : Number(raw[name]);
        });
        return values.every(iv => Number.isInteger(iv) && iv >= 1 && iv <= 32) ? values : null;
    }

    function pokemonRefinement(ficha) {
        const raw = ficha?.refino;
        if (!raw || Array.isArray(raw) || typeof raw !== 'object') return null;
        const keys = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
        if (!keys.every(key => Number.isSafeInteger(Number(raw[key])) && Number(raw[key]) >= 0)) return null;
        return keys.map(key => Number(raw[key]));
    }

    function pokemonCollectibles(ficha) {
        const flag = (...keys) => {
            const value = keys.map(key => ficha?.[key]).find(v => typeof v === 'boolean');
            return typeof value === 'boolean' ? value : null;
        };
        return {
            legendary: flag('lendario', 'legendary'),
            mythical: flag('mitico', 'mythical'),
            mega: flag('mega'),
            tmElemental: flag('tmElemental', 'tmElementalEquipada'),
            tmAoe: flag('tmAoe', 'tmAoeEquipada'),
            held: flag('heldItem', 'itemEquipado')
        };
    }

    function pokemonFacts(ficha) {
        const level = Number(ficha?.level);
        const ivs = pokemonIVs(ficha);
        const missing = [];
        if (!speciesIdOf(ficha)) missing.push('species');
        if (pokemonForm(ficha) == null) missing.push('form');
        if (typeof ficha?.shiny !== 'boolean') missing.push('shiny');
        if (!Number.isInteger(Number(ficha?.potencia)) || Number(ficha?.potencia) < 1 ||
            Number(ficha?.potencia) > 5) missing.push('potency');
        if (pokemonScore(ficha) == null) missing.push('N');
        if (pokemonQuality(ficha) == null) missing.push('Q');
        if (!ivs) missing.push('six named IVs');
        if (!pokemonRefinement(ficha)) missing.push('refinement');
        if (!(ficha?.level != null && Number.isFinite(level) && level > 0)) missing.push('level');
        return {
            speciesId: speciesIdOf(ficha), form: pokemonForm(ficha),
            shiny: typeof ficha?.shiny === 'boolean' ? ficha.shiny : null,
            potency: Number.isSafeInteger(Number(ficha?.potencia)) &&
                Number(ficha?.potencia) >= 1 && Number(ficha?.potencia) <= 5
                ? Number(ficha.potencia) : null,
            level: ficha?.level != null && Number.isFinite(level) && level > 0 ? level : null,
            levelBand: ficha?.level != null && Number.isFinite(level) && level > 0
                ? levelBand(level) : null,
            score: pokemonScore(ficha), quality: pokemonQuality(ficha), ivs,
            refinement: pokemonRefinement(ficha),
            traits: pokemonCollectibles(ficha), missing
        };
    }

    // Role is an annotation only: actual equipped move categories if provided,
    // otherwise explicitly supplied base attacking stats. Never infer from a name
    // or use this to set an absolute buy ceiling.
    function pokemonCombatRole(ficha) {
        const rows = Array.isArray(ficha?.movimentosEquipados) ? ficha.movimentosEquipados :
            Array.isArray(ficha?.equippedMoves) ? ficha.equippedMoves : null;
        const categories = rows?.map(move =>
            String(move?.categoria ?? move?.category ?? '').toUpperCase());
        if (categories?.length && categories.every(c => c === 'PHYSICAL' || c === 'SPECIAL')) {
            const physical = categories.filter(c => c === 'PHYSICAL').length;
            const special = categories.length - physical;
            const role = physical && special ? 'mixed' : physical ? 'physical' : 'special';
            return { role, source: 'equipped move categories', confidence: 'observed',
                focus: role === 'mixed' ? ['atk', 'spAtk', 'speed'] :
                    role === 'physical' ? ['atk', 'speed'] : ['spAtk', 'speed'] };
        }
        const atk = Number(ficha?.baseAtk), special = Number(ficha?.baseSpAtk);
        if (Number.isFinite(atk) && atk > 0 && Number.isFinite(special) && special > 0) {
            const ratio = atk / special;
            const role = ratio >= 1.4 ? 'physical' : ratio <= 1 / 1.4 ? 'special' : 'mixed';
            return { role, source: 'provided base stats; moves unverified',
                confidence: 'indicative', focus: role === 'mixed' ? ['atk', 'spAtk', 'speed'] :
                    role === 'physical' ? ['atk', 'speed'] : ['spAtk', 'speed'] };
        }
        return { role: 'unknown', source: 'no verified equipped moves or bases',
            confidence: 'unknown', focus: [] };
    }

    // Date aliases are hypotheses until verified against deployed packets.
    // Do not substitute listing creation time or the time we fetched history.
    function pokemonSaleTime(line) {
        const raw = line?.vendidoEm ?? line?.soldAt;
        const value = typeof raw === 'string' && !/^\d+$/.test(raw)
            ? Date.parse(raw) : Number(raw);
        const millis = value > 1e9 && value < 1e11 ? value * 1000 : value;
        return Number.isFinite(millis) && millis > 1451606400000 &&
            millis <= Date.now() + 300000 ? millis : null;
    }

    function median(values) {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function percentile(values, p) {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const position = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * p));
        const lower = Math.floor(position), upper = Math.ceil(position);
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
    }

    function addPokemonHistorySample(line, working) {
        if (!line || line.tipo !== 'pokemon' || !line.ficha ||
            !['gold', 'orb'].includes(line.moeda)) return;
        const key = pokemonIdentityKey(line.ficha, line.moeda);
        if (!key) return;
        const price = Number(line.bruto != null ? line.bruto : line.preco);
        if (!Number.isSafeInteger(price) || price <= 0) return;
        const soldAt = pokemonSaleTime(line);
        if (soldAt && Date.now() - soldAt > POKEMON_SALE_WINDOW_MS) return;
        let sales = working.get(key);
        if (!sales) {
            sales = []; working.set(key, sales);
        }
        if (sales.length < 200) {
            sales.push({ price, ...pokemonFacts(line.ficha), soldAt,
                observedAt: Date.now(), source: 'completed-sale packet' });
        }
    }

    function finalizePokemonHistory(working) {
        const values = {};
        for (const [key, sales] of working) if (sales.length) values[key] = sales;
        state.pokemonReference = { version: 3, capturedAt: Date.now(), values };
        savePokemonReference();
        state.pokemonStatus = 'history ready';
        addLog('Pokémon reference refreshed: ' + Object.keys(values).length + ' buckets');
        queueRender();
    }

    function pokemonComparableSales(sales, listing, options) {
        const { level = true, grade = true, quality = false, ivs = false, refinement = false,
            gradeTolerance = 0.125, qualityTolerance = 0.15, traits = true } = options;
        return sales.filter(sale => {
            if (sale.soldAt && (Date.now() - sale.soldAt > POKEMON_SALE_WINDOW_MS ||
                sale.soldAt > Date.now() + 300000)) return false;
            if (traits) {
                for (const [field, value] of Object.entries(listing.traits || {})) {
                    const soldValue = sale.traits?.[field];
                    if (value != null && soldValue != null && value !== soldValue) return false;
                }
            }
            if (level && (!sale.levelBand || !listing.levelBand ||
                sale.levelBand !== listing.levelBand)) return false;
            if (grade) {
                if (listing.score == null || sale.score == null) return false;
                // Never cross the N=3.5 / 4.0 boundary (or any half-point grade boundary).
                if (Math.floor(listing.score * 2) !== Math.floor(sale.score * 2)) return false;
                if (Math.abs(listing.score - sale.score) > gradeTolerance) return false;
            }
            if (quality) {
                if (listing.quality == null || sale.quality == null ||
                    Math.abs(listing.quality - sale.quality) > qualityTolerance) return false;
            }
            if (ivs) {
                if (!listing.ivs || !sale.ivs ||
                    sale.ivs.some((iv, index) => Math.abs(iv - listing.ivs[index]) > 5)) return false;
            }
            if (refinement) {
                if (!listing.refinement || !sale.refinement ||
                    sale.refinement.some((value, index) => value !== listing.refinement[index])) return false;
            }
            return true;
        });
    }

    function pokemonReferenceFor(ficha, currency) {
        const key = pokemonIdentityKey(ficha, currency);
        if (!key) return null;
        const sales = state.pokemonReference?.version === 3
            ? state.pokemonReference.values?.[key] : null;
        if (!Array.isArray(sales) || !sales.length) return null;
        const requestedSamples = Number(config.minPokemonSamples);
        const minSamples = Number.isFinite(requestedSamples) && requestedSamples >= 1
            ? Math.max(1, Math.floor(requestedSamples)) : 3;
        const listing = pokemonFacts(ficha);
        const stages = [
            { name: 'Grade, level, quality, IVs and refinement', confidence: 'high',
                options: { quality: true, ivs: true, refinement: true } },
            { name: 'Grade, level, quality and IVs', confidence: 'high',
                options: { quality: true, ivs: true } },
            { name: 'Grade, level and quality', confidence: 'medium',
                options: { quality: true } },
            { name: 'Grade and level only', confidence: 'low',
                options: {} },
            { name: 'Wider grade neighborhood', confidence: 'low',
                options: { level: false, gradeTolerance: 0.25 }, actionable: false },
            { name: 'Broad species history only', confidence: 'context',
                options: { level: false, grade: false }, actionable: false }
        ];
        const attemptedStages = [];
        for (const stage of stages) {
            const matches = pokemonComparableSales(sales, listing, stage.options);
            attemptedStages.push({ name: stage.name, matches: matches.length });
            if (matches.length < minSamples) continue;
            const prices = matches.map(sale => sale.price).filter(value => Number.isFinite(value) && value > 0);
            if (prices.length < minSamples) continue;
            const value = median(prices);
            if (!(value > 0)) continue;
            const low = percentile(prices, 0.25), high = percentile(prices, 0.75);
            const dated = matches.map(sale => sale.soldAt).filter(at => Number.isFinite(at) && at > 0);
            const newestSoldAt = dated.length ? Math.max(...dated) : null;
            const oldestSoldAt = dated.length ? Math.min(...dated) : null;
            const ageDays = newestSoldAt == null ? null :
                Math.max(0, Math.floor((Date.now() - newestSoldAt) / 86400000));
            const dateCoverage = dated.length / matches.length;
            const dispersion = low > 0 ? high / low : Infinity;
            const traitCoverage = listing.form != null &&
                Object.values(listing.traits || {}).every(flag => flag != null) &&
                matches.every(sale => Object.values(sale.traits || {}).length === 6 &&
                    Object.values(sale.traits).every(flag => flag != null));
            const recent = dateCoverage === 1 && newestSoldAt != null &&
                Date.now() - newestSoldAt <= POKEMON_HISTORY_FRESH_MS;
            const gradeMatched = stage.options.grade !== false && listing.score != null;
            // Incomplete or undated samples remain contextual, never bargain alerts.
            const actionable = stage.actionable !== false && gradeMatched &&
                recent && traitCoverage && dispersion <= 1.75;
            return {
                value, average: prices.reduce((sum, price) => sum + price, 0) / prices.length,
                low, high, p10: percentile(prices, 0.1), p90: percentile(prices, 0.9),
                dispersion, samples: prices.length, bucketSamples: sales.length,
                key, comparison: stage.name, attemptedStages,
                confidence: recent && traitCoverage && dispersion <= 1.75
                    ? stage.confidence : stage.confidence === 'context' ? 'context' : 'low',
                actionable, missingScore: listing.score == null,
                missingIVs: !listing.ivs, collectedAt: state.pokemonReference.capturedAt,
                ageDays, dateCoverage, newestSoldAt, oldestSoldAt, source: 'completed sales',
                limitations: [
                    ...(!recent ? ['sale dates missing or stale'] : []),
                    ...(!traitCoverage ? ['collectible extras unverified'] : []),
                    ...(dispersion > 1.75 ? ['wide price dispersion'] : []),
                    ...(stage.confidence === 'context' ? ['broad species comparison'] : [])
                ]
            };
        }
        return null;
    }

    function requestHistoryPage() {
        const fetch = state.historyFetch;
        if (!fetch) return;
        if (fetch.waitingSince && Date.now() - fetch.waitingSince < 12000) return;
        if (q('#cm-hist-corpo') || communityMarketIsOpen()) {
            setTimeout(requestHistoryPage, 1500);
            return;
        }

        const delay = backgroundDelayMs();
        if (delay > 0) {
            setTimeout(requestHistoryPage, delay + 25);
            return;
        }

        const currency = fetch.currencies[fetch.currencyIndex];
        if (!marketReplyAvailable()) {
            setTimeout(requestHistoryPage, 600);
            return;
        }
        if (!sendBackground({
            t: 'market.historicoGlobal',
            pagina: fetch.page,
            tipo: 'pokemon',
            moeda: currency
        })) {
            setTimeout(requestHistoryPage, BACKGROUND_MIN_GAP_MS);
            return;
        }
        fetch.waitingSince = Date.now();
        setTimeout(() => {
            if (state.historyFetch === fetch && fetch.waitingSince &&
                Date.now() - fetch.waitingSince >= 12000) requestHistoryPage();
        }, 12100);
    }

    function gameIsLoading() {
        const loading = q('#carregando');
        if (!loading) return false;
        if (
            loading.hidden ||
            loading.classList.contains('hidden') ||
            loading.getAttribute('aria-hidden') === 'true'
        ) {
            return false;
        }
        return loading.getClientRects().length > 0;
    }

    function ensurePokemonHistory(force) {
        if (!config.scanPokemon) return;
        // Do not compete with the game's own boot-time data and asset loading.
        // The normal scan timer will retry after the loading overlay disappears.
        if (gameIsLoading()) {
            state.pokemonStatus = 'waiting for game';
            return;
        }
        if (state.historyFetch) return;

        const age = Date.now() - Number(state.pokemonReference.capturedAt || 0);
        const maxAge = Math.max(5, Number(config.pokemonHistoryRefreshMinutes || 60)) * 60 * 1000;
        if (!force && state.pokemonReference.capturedAt && age < maxAge) {
            state.pokemonStatus = 'history cached';
            return;
        }

        state.historyFetch = {
            currencies: ['gold', 'orb'],
            currencyIndex: 0,
            page: 0,
            working: new Map(),
            waitingSince: 0
        };
        state.pokemonStatus = 'loading history';
        requestHistoryPage();
        queueRender();
    }

    function handlePokemonHistory(message) {
        const fetch = state.historyFetch;
        if (!fetch || message.aba !== 'historicoGlobal' || !fetch.waitingSince ||
            Date.now() - fetch.waitingSince > 12000 ||
            (message.tipo && message.tipo !== 'pokemon') ||
            (message.pagina != null && Number(message.pagina) !== fetch.page) ||
            (message.moeda && message.moeda !== fetch.currencies[fetch.currencyIndex])) return false;

        const expectedCurrency = fetch.currencies[fetch.currencyIndex];
        const lines = Array.isArray(message.linhas) ? message.linhas : [];
        const foreign = lines.some(line =>
            line && line.tipo && line.tipo !== 'pokemon' ||
            line && line.moeda && line.moeda !== expectedCurrency
        );
        if (foreign || !Array.isArray(message.linhas) ||
            (!lines.length && (message.moeda !== expectedCurrency || Number(message.pagina) !== fetch.page)) ||
            (!message.moeda && lines.some(line => line?.moeda !== expectedCurrency))) return false;
        fetch.waitingSince = 0;

        for (const line of lines) addPokemonHistorySample(line, fetch.working);

        const maxPages = Math.max(1, Math.min(50, Number(config.pokemonHistoryPages || 12)));
        if (message.temMais && fetch.page + 1 < maxPages) {
            fetch.page++;
            setTimeout(requestHistoryPage, 100);
            return true;
        }

        if (fetch.currencyIndex + 1 < fetch.currencies.length) {
            fetch.currencyIndex++;
            fetch.page = 0;
            setTimeout(requestHistoryPage, 100);
            return true;
        }

        const working = fetch.working;
        state.historyFetch = null;
        finalizePokemonHistory(working);
        return true;
    }

    function recentPokemonRequest(currency, page = 0, order = 'recentes') {
        return {
            t: 'market.listar',
            tipo: 'pokemon',
            moeda: currency,
            busca: '',
            ordem: order,
            criterios: [],
            elemento: '',
            categoria: '',
            soShiny: false,
            soP5: false,
            soTmElemental: false,
            soTmAoe: false,
            semOutland: false,
            nivelMin: '',
            nivelMax: '',
            potenciaMin: '',
            potenciaMax: '',
            ivMin: '',
            ivMax: '',
            qualidadeMin: '',
            qualidadeMax: '',
            notaMin: '',
            notaMax: '',
            pagina: page,
            especieId: 0
        };
    }

    function startPokemonScan() {
        if ((!config.scanPokemon && !activePokemonRules().length) || state.pokemonScan) return;

        /*
         * Bot requests share the game's WebSocket. A background market.listar
         * response is also seen by PokéIdle's own handler and can redraw the
         * normal Pokémon market. Moth Watch may scan while its own panel hides
         * that view, but otherwise leave interactive browsing alone.
         */
        if (q('.cm-topo') && !state.watchOpen) {
            state.pokemonStatus = 'paused while browsing';
            return;
        }

        if (!state.pokemonReference.capturedAt && !activePokemonRules().length) {
            ensurePokemonHistory(false);
            return;
        }
        state.pokemonScan = {
            queue: [{currency: 'gold', page: 0}, {currency: 'orb', page: 0}],
            waiting: null,
            sentAt: 0,
            // A bounded page window avoids scanning hundreds of listings
            // and disturbing the game's own market interaction.
            maxPages: activePokemonRules().length ? 3 : 1
        };
        pumpPokemonScan();
    }

    function pumpPokemonScan() {
        const scan = state.pokemonScan;
        if (!scan || scan.waiting) return;
        if (communityMarketIsOpen() || (q('.cm-topo') && !state.watchOpen)) {
            state.pokemonScan = null;
            state.pokemonStatus = 'paused while browsing';
            return;
        }
        const job = scan.queue[0];
        if (!job) {
            state.pokemonScan = null;
            state.pokemonStatus = 'watching';
            queueRender();
            return;
        }

        const delay = backgroundDelayMs();
        if (delay > 0) {
            setTimeout(pumpPokemonScan, delay + 25);
            return;
        }

        if (!marketReplyAvailable()) {
            setTimeout(pumpPokemonScan, 500);
            return;
        }
        if (!sendBackground(recentPokemonRequest(job.currency, job.page,
            activePokemonRules().length ? 'baratos' : 'recentes'))) {
            setTimeout(pumpPokemonScan, BACKGROUND_MIN_GAP_MS);
            return;
        }

        scan.queue.shift();
        state.marketReply = { kind: 'pokemon', currency: job.currency,
            page: job.page, sentAt: Date.now() };
        scan.waiting = job;
        scan.sentAt = Date.now();
        state.pokemonStatus = 'scanning ' + (job.currency === 'orb' ? 'gems' : 'coins');
        setTimeout(() => {
            if (state.pokemonScan === scan && scan.waiting === job && Date.now() - scan.sentAt >= 2500) {
                scan.waiting = null;
                pumpPokemonScan();
            }
        }, 2600);
    }

    // One outstanding vitrine scan at a time. An empty untyped response
    // cannot be safely attributed to the Pokémon or Diamond scanner.
    function marketReplyAvailable() {
        if (!state.marketReply) return true;
        if (Date.now() - state.marketReply.sentAt < 6500) return false;
        state.marketReply = null; // timeout is not evidence of an empty page
        return true;
    }

    function marketReplyMatches(message, kind) {
        const pending = state.marketReply;
        if (!pending || pending.kind !== kind || message.aba !== 'vitrine' ||
            communityMarketIsOpen()) return false;
        const rows = Array.isArray(message.linhas) ? message.linhas : null;
        if (!rows) return false;
        if (message.pagina != null && Number(message.pagina) !== pending.page) return false;
        if (message.moeda && message.moeda !== pending.currency) return false;
        if (message.tipo && message.tipo !== kind) return false;
        if (!rows.length) {
            // No row evidence: every discriminator must be explicit.
            return message.tipo === kind && message.moeda === pending.currency &&
                Number(message.pagina) === pending.page;
        }
        if (message.pagina == null && pending.page !== 0) return false;
        const shape = rows.every(row => row && (
            kind === 'pokemon'
                ? !!row.ficha && (!row.tipo || row.tipo === 'pokemon')
                : !row.ficha && row.itemId == null && (!row.tipo || row.tipo === 'diamante')
        ));
        const currency = !!message.moeda || rows.every(row => row.moeda === pending.currency);
        return shape && currency;
    }

    function handleDiamondListings(message) {
        const currency = state.marketReply?.currency;
        if (!currency || !marketReplyMatches(message, 'diamante')) return;
        state.marketReply = null;
        const lines = Array.isArray(message.linhas) ? message.linhas : [];

        if (message.mediaDiamante && typeof message.mediaDiamante === 'object') {
            state.liveDiamondAverages = message.mediaDiamante;
        }

        const activePrices = lines
            .map(listing => Number(listing && listing.preco))
            .filter(price => Number.isFinite(price) && price > 0);
        const avgRow = state.liveDiamondAverages
            ? state.liveDiamondAverages[currency]
            : null;
        let average = avgRow && Number(avgRow.media) > 0
            ? Number(avgRow.media)
            : 0;
        const samples = avgRow ? Math.max(0, Number(avgRow.unidades) || 0) : 0;
        let referenceSource = average > 0 ? 'live-7d' : 'none';

        /*
         * When three or more active offers exist, a lower active median caps
         * an inflated historical reference. Offers remain visible without history.
         */
        if (average > 0 && activePrices.length >= 3) {
            const activeMedian = median(activePrices);
            if (activeMedian > 0 && activeMedian < average) {
                average = activeMedian;
                referenceSource = 'active-median';
            }
        }

        const group = 'diamond:' + currency + ':';
        removeCandidateGroup(group);

        for (const listing of lines) {
            if (!listing || isOwnListing(listing)) continue;
            if (listing.moeda && listing.moeda !== currency) continue;

            const price = Number(listing.preco);
            const qty = Number(listing.qtd);
            if (!Number.isSafeInteger(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) continue;

            addCandidate({
                key: group + listing.id,
                kind: 'diamond',
                listingId: Number(listing.id),
                itemId: 0,
                name: 'Diamonds',
                currency: currency,
                price: price,
                average: average,
                samples: samples,
                referenceSource: referenceSource,
                ratio: average > 0 ? price / average : 1,
                qty: qty,
                seller: String(listing.vendedor || '—'),
                retainedUntil: retentionUntil(listing),
                firstSeenAt: Date.now(),
                seenAt: Date.now()
            });
        }

        state.diamondPendingCurrency = null;
        state.diamondPendingAt = 0;
        state.diamondStatus = 'live · ' + (currency === 'orb' ? 'Gems' : 'Coins');
        queueRender();
    }

    function handlePokemonListings(message) {
        const scan = state.pokemonScan;
        if (!scan || !scan.waiting || !marketReplyMatches(message, 'pokemon')) return false;
        const {currency, page} = scan.waiting;
        if (Number(message.pagina || 0) !== page ||
            (message.moeda && message.moeda !== currency) ||
            (message.tipo && message.tipo !== 'pokemon')) return false;
        const lines = Array.isArray(message.linhas) ? message.linhas : [];
        const looksLikeOurResponse = !lines.length || lines.every(a =>
            (!a.tipo || a.tipo === 'pokemon') &&
            (!a.moeda || a.moeda === currency)
        );
        if (!looksLikeOurResponse) return false;

        const older = page > 0 ? state.pokemonAutoOffers.get(currency)?.offers || [] : [];
        const uniqueOffers = new Map();
        for (const offer of [...older, ...lines]) {
            if (Number.isSafeInteger(Number(offer?.id))) uniqueOffers.set(Number(offer.id), offer);
        }
        state.pokemonAutoOffers.set(currency, {
            offers: Array.from(uniqueOffers.values()).slice(0, 300),
            updatedAt: Date.now()
        });
        const group = 'pokemon:' + currency + ':';
        if (page === 0) removeCandidateGroup(group);
        const scanRatio = discoveryRatio();

        for (const listing of lines) {
            if (!listing || !listing.ficha || isOwnListing(listing)) continue;
            if (!pokemonCurrencyAllowed(listing.ficha, currency)) continue;
            const price = Number(listing.preco);
            if (!Number.isSafeInteger(Number(listing.qtd)) || Number(listing.qtd) !== 1) continue;
            if (!Number.isFinite(price) || price <= 0) continue;

            const ref = pokemonReferenceFor(listing.ficha, currency);
            // An ungraded or overly broad comparator is context, never a bargain signal.
            if (!ref || !(ref.value > 0) || !ref.actionable) continue;

            const ratio = price / ref.value;
            if (ratio > scanRatio) continue;

            addCandidate({
                key: group + listing.id,
                kind: 'pokemon',
                listingId: Number(listing.id),
                pokemonId: Number(listing.pokemonId || listing.ficha.id || 0),
                ficha: listing.ficha,
                name: pokemonListingName(listing.ficha),
                currency: currency,
                price: price,
                unitPrice: Number(listing.preco),
                average: ref.value,
                arithmeticAverage: ref.average,
                samples: ref.samples,
                pokemonValuation: ref,
                ratio: ratio,
                qty: 1,
                seller: String(listing.vendedor || '—'),
                retainedUntil: retentionUntil(listing),
                firstSeenAt: Date.now(),
                seenAt: Date.now()
            });
        }

        state.marketReply = null;
        if (message.temMais === true && page + 1 < scan.maxPages) {
            scan.queue.push({currency, page: page + 1});
        }
        scan.waiting = null;
        setTimeout(pumpPokemonScan, 100);
        queueRender();
        return true;
    }

    function balanceFor(currency) {
        return currency === 'orb' ? state.orbs : state.gold;
    }

    function reserveFor(currency) {
        return Math.max(0, Number(currency === 'orb' ? config.gemReserve : config.goldReserve) || 0);
    }

    function maxSpendFor(currency) {
        return Math.max(0, Number(currency === 'orb' ? config.maxGemsPerBuy : config.maxCoinsPerBuy) || 0);
    }

    function purchaseQuantity(candidate, ruleId = '') {
        if (candidate.kind === 'pokemon' &&
            !pokemonCurrencyAllowed(candidate.ficha, candidate.currency)) return 0;
        const balance = balanceFor(candidate.currency);
        const available = Math.max(0, balance - reserveFor(candidate.currency));
        const cap = maxSpendFor(candidate.currency);
        const exposure = remainingBudget(candidate.currency, ruleId);
        const budget = Math.min(cap > 0 ? Math.min(available, cap) : available, exposure.spend);

        const unitPrice = candidate.kind === 'pokemon'
            ? Number(candidate.unitPrice || candidate.price)
            : Number(candidate.price);

        if (!(unitPrice > 0) || budget < unitPrice) return 0;

        if (candidate.kind === 'pokemon') return exposure.quantity >= 1 ? 1 : 0;

        return Math.max(0, Math.min(
            exposure.quantity,
            Math.max(1, Number(candidate.qty || 1)),
            Math.floor(budget / unitPrice)
        ));
    }

    function tryBuy(candidate, manual, requestedQuantity = null, fixedRule = false) {
        // Rule eligibility is revalidated against the latest saved settings.
        if (config.purchasesPaused || unverifiedOrdersExist() ||
            !freshQuote(candidate, !!manual)) {
            if (manual) addLog('Stale or unverified quote · refresh listing');
            return false;
        }
        const rule = !manual && fixedRule ? activeRuleById(fixedRule.id) : null;
        const quotedPrice = Number(candidate.unitPrice || candidate.price);
        if (!manual && !currentRuleMatches(rule, candidate, quotedPrice)) return false;
        if (!candidate || state.pendingBuy || !state.orderJournal?.sessionId ||
            !state.gameSocket || state.gameSocket.readyState !== 1 ||
            state.orderJournal?.accountKey !== orderAccountKey() ||
            state.orderJournal.orders.length >= 2500) return false;
        if (candidate.kind === 'pokemon' &&
            !pokemonCurrencyAllowed(candidate.ficha, candidate.currency)) {
            if (manual) addLog('Skipped: shiny Pokémon require Gems');
            return false;
        }
        if (candidate.retainedUntil && candidate.retainedUntil > serverNow()) return false;

        const now = Date.now();
        const blockedUntil = Number(state.attemptedListings.get(candidate.listingId) || 0);
        if (blockedUntil > now) return false;

        const affordableQuantity = purchaseQuantity(candidate, rule?.id || '');
        const requestedLimit = requestedQuantity == null
            ? affordableQuantity
            : Math.floor(Number(requestedQuantity));
        const qty = Math.min(affordableQuantity, requestedLimit);
        if (!Number.isFinite(qty) || qty < 1) {
            if (manual) addLog('Skipped: not enough spendable balance for ' + candidate.name);
            return false;
        }

        const unitPrice = candidate.kind === 'pokemon'
            ? Number(candidate.unitPrice || candidate.price)
            : Number(candidate.price);
        const spend = unitPrice * qty;
        if (!Number.isSafeInteger(spend) || spend <= 0) return false;
        const balanceBefore = balanceFor(candidate.currency);

        const order = {
            listingId: candidate.listingId, currency: candidate.currency,
            sentAt: now, qty, spend, ruleId: rule?.id || '',
            kind: candidate.kind, sessionId: state.orderJournal.sessionId,
            day: orderDay(now), status: 'prepared'
        };
        if (!reserveOrder(order)) return false;
        state.pendingBuy = {
            order,
            listingId: candidate.listingId,
            candidateKey: candidate.key,
            currency: candidate.currency,
            unitPrice: unitPrice,
            qty: qty,
            spend: spend,
            balanceBefore: balanceBefore,
            sentAt: now,
            manual: !!manual
        };
        state.attemptedListings.set(candidate.listingId, now + 15000);

        const sent = send({
            t: 'market.comprar',
            id: candidate.listingId,
            qtd: qty,
            preco: unitPrice,
            moeda: candidate.currency
        });

        if (!sent) {
            state.pendingBuy = null;
            state.orderJournal.orders.splice(state.orderJournal.orders.indexOf(order), 1);
            saveOrderJournal();
            state.attemptedListings.delete(candidate.listingId);
            return false;
        }

        order.status = 'submitted';
        saveOrderJournal();
        state.lastPurchaseOutcome = 'awaiting acknowledgement';
        addLog(
            (fixedRule ? 'RULE BUY' : 'BUY') + ' · ' +
            candidate.name + ' · ' + qty + ' × ' + num(unitPrice) + ' ' +
            (candidate.currency === 'orb' ? 'Gems' : 'Coins') +
            (Number(candidate.average) > 0 ? ' · ' + Math.round((1 - candidate.ratio) * 100) + '% under reference' : '')
        );
        queueRender();

        setTimeout(() => {
            if (state.pendingBuy && state.pendingBuy.listingId === candidate.listingId) {
                finishPendingBuy('settle-timeout');
            }
        }, 5000);

        return true;
    }

    function controllerResult(result) {
        state.lastControllerResult = {
            at: Date.now(),
            ok: !!result.ok,
            source: String(result.source || 'unknown'),
            error: result.error ? String(result.error) : '',
            listingId: Number(result.listingId || 0)
        };
        queueRender();
        return result;
    }

    function buyFromController(request) {
        if (!request ||
            !Number.isSafeInteger(Number(request.id)) || Number(request.id) <= 0 ||
            !Number.isFinite(Number(request.preco)) || Number(request.preco) <= 0 ||
            (request.qtd != null && (!Number.isFinite(Number(request.qtd)) || Math.floor(Number(request.qtd)) < 1))) {
            return controllerResult({
                ok: false,
                error: 'invalid market purchase request',
                source: 'validation'
            });
        }

        const listingId = Number(request.id);
        if (request.moeda !== 'gold' && request.moeda !== 'orb') {
            return controllerResult({ ok: false, error: 'unsupported currency', source: 'validation', listingId });
        }
        const currency = request.moeda;
        // Controller-originated orders can arrive before our market scan.
        // Inspect any supplied Pokémon metadata; unknown metadata is left
        // to the game's authoritative validation.
        const requestFicha = request.ficha || request.pokemon || null;
        if (currency === 'gold' &&
            (requestFicha?.shiny || (request.tipo === 'pokemon' && request.shiny))) {
            return controllerResult({
                ok: false, error: 'shiny Pokémon listings require Gems',
                source: 'validation', listingId
            });
        }
        const candidate = Array.from(state.candidates.values()).find(item =>
            Number(item.listingId) === listingId &&
            item.currency === currency
        );

        if (candidate) {
            const requestedPrice = Number(request.preco);
            const candidateUnitPrice = candidate.kind === 'pokemon'
                ? Number(candidate.unitPrice || candidate.price)
                : Number(candidate.price);
            if (Math.abs(candidateUnitPrice - requestedPrice) > Math.max(0.000001, candidateUnitPrice * 0.000001)) {
                return controllerResult({ ok: false, error: 'listing price changed; refresh the market listing', source: 'validation', listingId });
            }
            const requestedQty = request.qtd == null ? null : Math.floor(Number(request.qtd));
            return controllerResult({
                ok: tryBuy(candidate, true, requestedQty),
                source: 'candidate',
                listingId
            });
        }

        // Caller-supplied prices are not verified server quotes.
        return controllerResult({
            ok: false, source: 'validation', listingId,
            error: 'unverified quote; inspect a fresh listing in Moth Watch'
        });
    }

    function configureFromController(patch) {
        if (!patch || typeof patch !== 'object') {
            return { ok: false, error: 'invalid Moth Watch configuration' };
        }

        const booleanKeys = [
            'enabled',
            'scanItems',
            'scanPokemon',
            'scanDiamonds',
            'fixedRulesEnabled',
            'purchasesPaused'
        ];
        const numberKeys = [
            'scanSeconds',
            'watchPercent',
            'goldReserve',
            'gemReserve',
            'maxCoinsPerBuy',
            'maxGemsPerBuy',
            'maxCoinsPerSession', 'maxGemsPerSession',
            'maxCoinsPerDay', 'maxGemsPerDay',
            'maxPurchasesPerSession', 'maxQuantityPerSession',
            'minItemUnits',
            'minPokemonSamples',
            'pokemonHistoryPages',
            'pokemonHistoryRefreshMinutes'
        ];
        const viewKeys = ['viewCurrency', 'viewKind', 'viewSort'];

        for (const key of booleanKeys) {
            if (Object.prototype.hasOwnProperty.call(patch, key)) {
                config[key] = !!patch[key];
            }
        }

        for (const key of numberKeys) {
            if (Object.prototype.hasOwnProperty.call(patch, key)) {
                config[key] = Math.max(0, Number(patch[key]) || 0);
            }
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'viewCurrency')
            && ['all', 'gold', 'orb'].includes(String(patch.viewCurrency))) {
            config.viewCurrency = String(patch.viewCurrency);
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'viewKind')
            && ['all', 'item', 'pokemon', 'diamond'].includes(String(patch.viewKind))) {
            config.viewKind = String(patch.viewKind);
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'viewSort')
            && ['discount', 'newest', 'price-asc', 'price-desc', 'reference-desc', 'quantity-desc', 'name'].includes(String(patch.viewSort))) {
            config.viewSort = String(patch.viewSort);
        }

        config.scanSeconds = Math.max(1, Number(config.scanSeconds) || 5);
        config.watchPercent = Math.max(1, Number(config.watchPercent) || 70);
        config.minItemUnits = Math.max(1, Number(config.minItemUnits) || 1);
        config.minPokemonSamples = Math.max(1, Number(config.minPokemonSamples) || 1);
        config.pokemonHistoryPages = Math.max(1, Number(config.pokemonHistoryPages) || 12);
        config.pokemonHistoryRefreshMinutes = Math.max(5, Number(config.pokemonHistoryRefreshMinutes) || 60);

        saveConfig();
        runScan(true);
        ensureUi();
        queueRender();

        return { ok: true };
    }

    function scanFromController() {
        runScan(true);
        return {
            ok: true,
            connected: !!state.gameSocket && state.gameSocket.readyState === 1
        };
    }

    function finishPendingBuy(reason) {
        const pending = state.pendingBuy;
        if (!pending) return;
        state.pendingBuy = null;
        const status = reason === 'server-confirmed' ? 'confirmed' :
            reason === 'refused' ? 'refused' : 'unknown';
        settleOrder(pending.order, status);
        if (status === 'confirmed') state.candidates.delete(pending.candidateKey);
        requestItemSummary(activeAnyItemRules().length > 0);
        setTimeout(startPokemonScan, 250);
        queueRender();
    }

    function requestItemSummary(forceForAutomation = false) {
        if (!config.enabled || (!config.scanItems && !forceForAutomation)) return false;

        const delay = backgroundDelayMs();
        if (delay > 0) {
            state.itemStatus = 'queued';
            if (!state.itemSummaryRetryTimer) {
                state.itemSummaryRetryTimer = setTimeout(() => {
                    state.itemSummaryRetryTimer = null;
                    requestItemSummary(forceForAutomation);
                }, delay + 25);
            }
            return true;
        }

        state.itemStatus = 'scanning';
        return sendBackground({ t: 'market.itens' });
    }

    function communityMarketIsOpen() {
        const list = q('#cm-lista');
        if (!list) return false;

        const modal = q('#modal');
        if (!modal || modal.classList.contains('hidden')) return false;

        const shell = q('#modal .modal-caixa');
        if (shell && shell.dataset.modal && shell.dataset.modal !== 'community') return false;

        // Moth Watch reuses the market modal shell. Do not let background diamond
        // requests repaint the native market while the Watch panel is active.
        if (q('#modal-corpo.moth-watch-active') || q('.cm-corpo.moth-watch-active')) {
            return false;
        }
        return true;
    }

    function requestDiamondListings() {
        if (!config.enabled || !config.scanDiamonds) {
            state.diamondStatus = 'disabled';
            return false;
        }
        if (gameIsLoading() || communityMarketIsOpen() || !marketReplyAvailable()) return false;
        if (!state.socket || state.socket.readyState !== 1) return false;

        const now = Date.now();
        if (state.diamondPendingCurrency) {
            if (now - Number(state.diamondPendingAt || 0) < 15000) return false;
            state.diamondPendingCurrency = null;
            state.diamondPendingAt = 0;
            state.diamondStatus = 'retrying after timeout';
        }

        const delay = backgroundDelayMs();
        if (delay > 0) {
            if (!state.diamondScanTimer) {
                state.diamondScanTimer = setTimeout(() => {
                    state.diamondScanTimer = null;
                    requestDiamondListings();
                }, delay + 25);
            }
            return true;
        }

        const currency = state.nextDiamondCurrency === 'orb' ? 'orb' : 'gold';
        const sent = sendBackground({
            t: 'market.listar',
            tipo: 'diamante',
            moeda: currency,
            busca: '',
            ordem: 'baratos',
            criterios: [],
            elemento: '',
            categoria: '',
            soShiny: false,
            soP5: false,
            soTmElemental: false,
            soTmAoe: false,
            semOutland: false,
            nivelMin: '',
            nivelMax: '',
            potenciaMin: '',
            potenciaMax: '',
            ivMin: '',
            ivMax: '',
            qualidadeMin: '',
            qualidadeMax: '',
            notaMin: '',
            notaMax: '',
            pagina: 0,
            especieId: 0
        });

        if (sent) {
            state.diamondPendingCurrency = currency;
            state.diamondPendingAt = Date.now();
            state.marketReply = { kind: 'diamante', currency, page: 0, sentAt: Date.now() };
            state.nextDiamondCurrency = currency === 'gold' ? 'orb' : 'gold';
            state.diamondStatus = 'scanning · ' + (currency === 'orb' ? 'Gems' : 'Coins');
        }
        return sent;
    }


    function automationDetail(itemId, currency) {
        const key = String(itemId) + ':' + currency;
        state.ruleItemKeys.add(key);
        const detail = state.itemOfferDetails.get(key);
        if (!detail || Date.now() - Number(detail.updatedAt || 0) > RULE_DETAIL_REFRESH_MS) queueItemDetail(itemId, currency);
        return detail;
    }

    function fixedRuleCandidate(rule) {
        const detail = state.itemOfferDetails.get(String(rule.itemId) + ':' + rule.currency);
        if (!detail || Date.now() - Number(detail.updatedAt || 0) > 45000) return null;
        // Read listings directly, bypassing the opportunity/reference-% filters.
        const available = detail.offers.filter(offer => {
            const id = Number(offer?.id), price = Number(offer?.preco);
            return Number.isSafeInteger(id) && id > 0 &&
                Number.isFinite(price) && price > 0 && price <= rule.buyMax &&
                Number.isSafeInteger(Number(offer.qtd)) && Number(offer.qtd) > 0 &&
                !isOwnListing(offer) &&
                !(retentionUntil(offer) > serverNow()) &&
                Number(state.attemptedListings.get(id) || 0) <= Date.now();
        }).sort((a, b) => Number(a.preco) - Number(b.preco) || Number(a.id) - Number(b.id));
        const offer = available[0];
        if (!offer) return null;
        const ref = itemReference(rule.itemId, rule.currency);
        const average = Number(ref?.average || 0);
        return {
            key: 'rule:' + rule.itemId + ':' + rule.currency + ':' + offer.id,
            kind: 'item', listingId: Number(offer.id), itemId: rule.itemId,
            name: catalogName(rule.itemId), currency: rule.currency,
            price: Number(offer.preco), qty: Number(offer.qtd),
            seller: String(offer.vendedor || ''), seenAt: detail.updatedAt,
            average, ratio: average > 0 ? Number(offer.preco) / average : 1,
            retainedUntil: retentionUntil(offer)
        };
    }


    // Summary minima only nominate item types; only fresh offer details
    // authorize an actual order.
    function anyItemRuleTargets(rules) {
        const signature = JSON.stringify(rules.map(r => [r.currency, r.buyMax]));
        const cached = state.anyItemTargetsCache;
        if (cached && cached.summaryAt === state.itemSummaryAt &&
            cached.signature === signature && Date.now() - cached.at < 30000) return cached.targets;
        const targets = [];
        for (const [key, row] of Object.entries(state.itemSummary || {})) {
            const itemId = Number(key);
            if (!Number.isSafeInteger(itemId) || itemId <= 0 || !row?.anuncios) continue;
            for (const currency of ['gold', 'orb']) {
                const minimum = Number(currency === 'orb' ? row.minOrb : row.minGold);
                if (!Number.isFinite(minimum) || minimum <= 0) continue;
                if (rules.some(rule => rule.currency === currency && minimum <= rule.buyMax)) {
                    targets.push({ itemId, currency, key: itemId + ':' + currency, minimum });
                }
            }
        }
        targets.sort((a, b) => a.minimum - b.minimum || a.itemId - b.itemId);
        state.anyItemTargetsCache = { targets, signature, summaryAt: state.itemSummaryAt, at: Date.now() };
        return targets;
    }

    function anyItemRuleCandidate(rule, targets) {
        let best = null;
        for (const target of targets) {
            if (target.currency !== rule.currency || target.minimum > rule.buyMax) continue;
            const candidate = fixedRuleCandidate({
                itemId: target.itemId, currency: rule.currency, buyMax: rule.buyMax
            });
            if (candidate && (!best || candidate.price < best.price ||
                (candidate.price === best.price && candidate.listingId < best.listingId))) {
                best = candidate;
            }
        }
        return best;
    }

    function pokemonRuleMatches(rule, ficha, currency) {
        if (!ficha || !rule || rule.currency !== currency ||
            !pokemonCurrencyAllowed(ficha, currency)) return false;
        if (rule.kind === 'shiny') return ficha.shiny === true && currency === 'orb';
        if (rule.kind === 'p5') return Number(ficha.potencia) === 5;
        return rule.kind === 'any';
    }

    function pokemonRuleCandidate(rule) {
        const record = state.pokemonAutoOffers.get(rule.currency);
        if (!record || Date.now() - record.updatedAt > 45000) return null;
        let best = null;
        for (const listing of record.offers) {
            const id = Number(listing?.id), unitPrice = Number(listing?.preco);
            if (!Number.isSafeInteger(id) || id <= 0 ||
                !Number.isSafeInteger(unitPrice) || unitPrice <= 0 ||
                unitPrice > rule.buyMax || Number(listing.qtd || 1) !== 1 ||
                !pokemonRuleMatches(rule, listing.ficha, rule.currency) ||
                typeof listing.ficha.shiny !== 'boolean' ||
                !Number.isSafeInteger(Number(listing.ficha.potencia)) ||
                Number(listing.ficha.potencia) < 1 || Number(listing.ficha.potencia) > 5 ||
                isOwnListing(listing) || retentionUntil(listing) > serverNow() ||
                Number(state.attemptedListings.get(id) || 0) > Date.now()) continue;
            if (!best || unitPrice < best.price || (unitPrice === best.price && id < best.listingId)) {
                best = {
                    key: 'rule:pokemon:' + id,
                    kind: 'pokemon', listingId: id,
                    pokemonId: Number(listing.pokemonId || listing.ficha.id || 0),
                    ficha: listing.ficha, name: pokemonListingName(listing.ficha),
                    currency: rule.currency, price: unitPrice, unitPrice, qty: 1,
                    average: 0, ratio: 1, retainedUntil: retentionUntil(listing),
                    seller: String(listing.vendedor || ''), seenAt: record.updatedAt
                };
            }
        }
        return best;
    }

    function runMarketAutomation() {
        if (!hasAnyBuyingRules() || gameIsLoading()) {
            state.ruleItemKeys.clear();
            return;
        }
        if (!state.socket || state.socket.readyState !== 1) return;
        if (q('#modal .cm-folha') || communityMarketIsOpen() ||
            state.pendingBuy || config.purchasesPaused || unverifiedOrdersExist()) return;
        const now = Date.now();
        if (now - Number(state.automationLastRunAt || 0) < 1000) return;
        state.automationLastRunAt = now;
        const fixed = sanitizeFixedItemRules(config.fixedItemRules)
            .filter(rule => rule.buyEnabled && rule.buyMax > 0);
        const broad = activeAnyItemRules();
        const pokemon = activePokemonRules();
        const targets = anyItemRuleTargets(broad);
        state.ruleItemKeys = new Set(fixed.map(rule => rule.itemId + ':' + rule.currency));
        for (const rule of fixed) automationDetail(rule.itemId, rule.currency);
        if (broad.length && targets.length && state.detailQueue.length + (state.detailPending ? 1 : 0) < 12) {
            let count = 0;
            while (count < Math.min(8, targets.length)) {
                const target = targets[state.anyItemScanCursor % targets.length];
                state.anyItemScanCursor = (state.anyItemScanCursor + 1) % targets.length;
                count++;
                automationDetail(target.itemId, target.currency);
            }
        }
        // Serialized purchases share balances, reserves, caps and cooldowns.
        for (const rule of fixed) {
            const candidate = fixedRuleCandidate(rule);
            if (candidate && purchaseQuantity(candidate, rule.id) > 0 &&
                tryBuy(candidate, false, null, rule)) return;
        }
        for (const rule of broad) {
            const candidate = anyItemRuleCandidate(rule, targets);
            if (candidate && purchaseQuantity(candidate, rule.id) > 0 &&
                tryBuy(candidate, false, null, rule)) return;
        }
        for (const rule of pokemon) {
            const candidate = pokemonRuleCandidate(rule);
            if (candidate && purchaseQuantity(candidate, rule.id) > 0 &&
                tryBuy(candidate, false, null, rule)) return;
        }
    }

    function runScan(force) {
        if (!config.enabled) return;
        // The game opens its WebSocket before the client finishes booting.
        // Wait for the loading overlay to disappear before sending market scans.
        if (gameIsLoading()) {
            state.itemStatus = 'waiting for game';
            state.pokemonStatus = 'waiting for game';
            return;
        }
        if (!state.socket || state.socket.readyState !== 1) return;

        const now = Date.now();
        const userInterval = Math.max(1, Number(config.scanSeconds || 5)) * 1000;
        // Only slow general scans in closed-panel buying mode. User-selected
        // scan frequency and manual scan commands stay intact otherwise.
        const interval = !state.watchOpen && hasAnyBuyingRules()
            ? Math.max(userInterval, BACKGROUND_SCAN_WITH_RULES_MS)
            : userInterval;
        if (!force && now - state.lastScanAt < interval) return;
        state.lastScanAt = now;

        if (config.scanItems || activeAnyItemRules().length) requestItemSummary(activeAnyItemRules().length > 0);
        if (config.scanPokemon) ensurePokemonHistory(false);
        if (config.scanPokemon || activePokemonRules().length) startPokemonScan();
        if (config.scanDiamonds) requestDiamondListings();

        pruneCandidates();
        queueRender();
    }

    function pruneCandidates() {
        const cutoff = Date.now() - Math.max(30000, Number(config.scanSeconds || 5) * 6000);
        const nowServer = serverNow();
        for (const [key, candidate] of state.candidates) {
            if (candidate.retainedUntil && candidate.retainedUntil > nowServer) continue;
            if (candidate.seenAt < cutoff) state.candidates.delete(key);
        }
        pruneDetailCache();
        for (const [id, until] of state.attemptedListings) {
            if (until < Date.now()) state.attemptedListings.delete(id);
        }
        for (const [key, seen] of state.firstSeenCache) {
            if (nowServer - Number(seen.lastSeenAt || 0) > 60 * 60 * 1000) state.firstSeenCache.delete(key);
        }
    }

    function decodeMessage(data) {
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch { return null; }
        }
        if (data instanceof ArrayBuffer) {
            try { return JSON.parse(new TextDecoder().decode(data)); } catch { return null; }
        }
        return null;
    }

    function handleProtocolObject(message, sourceSocket = null) {
        if (!message || typeof message !== 'object') return;
        state.protocolMessages++;

        /*
         * The game may create several WebSockets. Only a socket that carries
         * the authenticated PokéIdle protocol should become the command
         * socket. This prevents Moth Watch purchases/scans from being sent to
         * an unrelated page socket.
         */
        if (sourceSocket && (
            message.t === 'welcome' ||
            message.t === 'market' ||
            message.t === 'batalha'
        )) {
            state.socket = sourceSocket;
            state.gameSocket = sourceSocket;
        }

        if (message.t === 'welcome') {
            // Never let two authenticated accounts share a spending journal.
            if (state.pendingBuy) finishPendingBuy('account-refresh');
            const previousAccount = state.orderJournal?.accountKey;
            state.nick = String(message.estado?.nick || '');
            mergePlayer(message.estado, true);
            state.orderJournal = loadOrderJournal();
            state.exposureCache.clear();
            if (previousAccount !== state.orderJournal?.accountKey) {
                state.attemptedListings.clear();
                state.itemOfferDetails.clear();
                state.pokemonAutoOffers.clear();
                state.candidates.clear();
                for (const entry of state.releaseTimers.values()) clearTimeout(entry.timer);
                state.releaseTimers.clear();
            }
            const catalog = message.mercado && Array.isArray(message.mercado.catalogo)
                ? message.mercado.catalogo
                : [];
            state.catalog.clear();
            for (const item of catalog) {
                const id = Number(item && item.id);
                if (Number.isFinite(id) && id > 0) state.catalog.set(id, item);
            }

            setTimeout(() => runScan(true), 650);
            setTimeout(() => ensurePokemonHistory(false), 1200);
            ensureUi();
            queueRender();
            return;
        }

        if (message.t === 'estado') {
            mergePlayer(message.estado, false);
            return;
        }

        if (message.t === 'erro') {
            // Game errors unrelated to an order must not clear an in-flight order.
            const listingId = Number(message.listingId ?? message.anuncioId ?? message.vendaId);
            if (isRateLimitError(message)) {
                enterRateLimitBackoff();
                if (Number.isSafeInteger(listingId) && listingId > 0) {
                    resolveOrder(listingId, 'refused');
                }
                return;
            }
            if (listingId > 0 && resolveOrder(listingId, 'refused')) {
                addLog('Purchase refused: ' + String(message.chave || message.msg || 'server error'));
            }
            return;
        }

        /*
         * marketComprado is the buyer-side authoritative acknowledgement.
         * It is stronger than guessing from a balance delta, and upstream
         * itself uses this event to refresh the Community Market after a
         * partial or complete purchase.
         */
        if (message.t === 'batalha') {
            for (const event of message.ev || []) {
                if (event?.k === 'marketComprado') {
                    const ids = [event.listingId, event.anuncioId, event.vendaId,
                        event.anuncio?.id, event.listing?.id];
                    for (const id of ids) {
                        if (Number.isSafeInteger(Number(id)) && Number(id) > 0 &&
                            resolveOrder(Number(id), 'confirmed')) break;
                    }
                }
            }
            return;
        }

        if (message.t !== 'market') return;

        if (message.mediaDiamante && typeof message.mediaDiamante === 'object') {
            state.liveDiamondAverages = message.mediaDiamante;
        }

        if (message.aba === 'vitrine' && marketReplyMatches(message, 'diamante')) {
            handleDiamondListings(message);
            return;
        }

        if (message.aba === 'itens') {
            handleItemSummary(message);
            return;
        }
        if (message.aba === 'item') {
            handleItemListings(message);
            return;
        }
        if (message.aba === 'historicoGlobal' && handlePokemonHistory(message)) {
            return;
        }
        handlePokemonListings(message);
    }

    function handleProtocolData(data, sourceSocket = null) {
        if (typeof Blob !== 'undefined' && data instanceof Blob) {
            data.text().then(text => {
                const message = decodeMessage(text);
                if (message) handleProtocolObject(message, sourceSocket);
            }).catch(() => {});
            return;
        }
        const message = decodeMessage(data);
        if (message) handleProtocolObject(message, sourceSocket);
    }

    function attachSocket(socket) {
        if (!socket || state.observedSockets.has(socket)) {
            return;
        }

        state.observedSockets.add(socket);

        if (!state.socket) {
            state.socket = socket;
        }

        socket.addEventListener('message', event => {
            handleProtocolData(event.data, socket);
        });

        socket.addEventListener('close', () => {
            state.observedSockets.delete(socket);

            if (state.gameSocket === socket) {
                state.gameSocket = null;
            }

            if (state.socket === socket) {
                state.socket = state.gameSocket || null;
            }

            if (!state.socket) {
                state.itemStatus = 'disconnected';
                state.pokemonStatus = 'disconnected';
                if (state.pendingBuy) finishPendingBuy('disconnect');
                state.marketReply = null;
                state.pokemonScan = null;
                state.historyFetch = null;

                if (state.itemSummaryRetryTimer) {
                    clearTimeout(state.itemSummaryRetryTimer);
                }

                if (state.detailPumpTimer) {
                    clearTimeout(state.detailPumpTimer);
                }

                state.itemSummaryRetryTimer = null;
                state.detailPumpTimer = null;

                for (const entry of state.releaseTimers.values()) {
                    clearTimeout(entry.timer);
                }

                state.releaseTimers.clear();
                queueRender();
            }
        });
    }

    function adoptBridgeSocket() {
        try {
            const bridge = page.__mothControllerBridgeV1;
            const candidate =
                bridge &&
                typeof bridge.socket === 'function'
                    ? bridge.socket()
                    : null;

            if (
                candidate &&
                candidate.readyState === 1
            ) {
                attachSocket(candidate);
                state.gameSocket = candidate;
                state.socket = candidate;
                return true;
            }
        } catch {}

        return false;
    }

    // Moth Watch observes game WebSockets independently. Controller Bridge is
    // a useful late-attach fallback, not an installation requirement.
    const MOTH_WATCH_HOOK = '__mothWatchSocketHookV1';
    let lastHookTarget = null;

    function installSocketHook() {
        const NativeWebSocket = page.WebSocket;
        if (typeof NativeWebSocket !== 'function') return false;
        try {
            if (NativeWebSocket[MOTH_WATCH_HOOK]) {
                state.hookInstalled = true;
                return true;
            }
        } catch (_) {}
        if (NativeWebSocket === lastHookTarget) return state.hookInstalled;
        lastHookTarget = NativeWebSocket;
        try {
            let WrappedWebSocket;
            WrappedWebSocket = new Proxy(NativeWebSocket, {
                get(target, prop, receiver) {
                    if (prop === MOTH_WATCH_HOOK) return true;
                    return Reflect.get(target, prop, receiver);
                },
                construct(target, args, newTarget) {
                    const socket = Reflect.construct(target, args,
                        newTarget === WrappedWebSocket ? target : newTarget);
                    try { attachSocket(socket); }
                    catch (error) { console.warn('[Moth Watch] socket observer:', error); }
                    return socket;
                }
            });
            page.WebSocket = WrappedWebSocket;
            state.hookInstalled = page.WebSocket === WrappedWebSocket;
        } catch (error) {
            state.hookInstalled = false;
            console.warn('[Moth Watch] independent socket hook unavailable:', error);
        }
        return state.hookInstalled;
    }

    installSocketHook();
    setInterval(() => {
        installSocketHook();
        const socket = state.gameSocket || state.socket;
        if (!socket || socket.readyState !== 1) adoptBridgeSocket();
    }, 1000);

    function injectStyle() {
        if (q('#moth-market-watch-style')) return;
        const style = document.createElement('style');
        style.id = 'moth-market-watch-style';
        style.textContent = [
            '#moth-market-watch-tab{white-space:nowrap}',
            '.moth-sell-recommendation{margin:7px 0 10px;padding:8px 9px;border:1px solid var(--rx,#84325f);border-radius:7px;background:color-mix(in srgb,var(--vao,#21191d) 88%,var(--rx,#84325f) 12%);display:grid;gap:6px}',
            '.moth-sell-rec-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:11px}',
            '.moth-sell-rec-head>b{font-size:11px}',
            '.moth-sell-confidence{font-size:9px;opacity:.85}',
            '.moth-sell-rec-price{display:flex;align-items:center;gap:7px;width:max-content;max-width:100%;border:1px solid var(--rx,#84325f);border-radius:6px;background:var(--mad,#2a2025);color:inherit;padding:6px 9px;cursor:pointer;font:inherit}',
            '.moth-sell-rec-price:hover{filter:brightness(1.08)}',
            '.moth-sell-rec-price img{width:18px;height:18px;object-fit:contain}',
            '.moth-sell-rec-price strong{font-size:14px}',
            '.moth-sell-rec-price span{font-size:9px;opacity:.8}',
            '.moth-sell-rec-evidence,.moth-sell-rec-note{font-size:9px;line-height:1.35;color:var(--sobre-mad-dim,#aaa)}',
            '#modal-corpo.moth-watch-active>.cm-corpo{display:none!important}',
            '#modal-corpo.moth-watch-active>:not(.cm-topo):not(.cm-corpo):not(#moth-market-watch-panel){display:none!important}',
            '#moth-market-watch-panel{display:none;width:100%;height:100%;min-height:420px;overflow:auto;padding:10px;color:var(--sobre-mad,#eee)}',
            '#modal-corpo.moth-watch-active>#moth-market-watch-panel{display:block!important}',
            '.cm-corpo.moth-watch-active>:not(#moth-market-watch-panel){display:none!important}',
            '.cm-corpo.moth-watch-active>#moth-market-watch-panel{display:block!important}',
            '.moth-mw-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}',
            '.moth-mw-head h3{margin:0;font-size:15px}',
            '.moth-mw-head .moth-mw-status{font-size:10px;color:var(--sobre-mad-dim,#aaa)}',
            '.moth-mw-spacer{flex:1}',
            '.moth-mw-btn{border:0;border-radius:5px;padding:5px 8px;background:var(--mad,#5a413b);color:var(--sobre-mad,#fff);box-shadow:inset 0 0 0 2px var(--mad-linha,#3a2824);cursor:pointer;font-weight:700;font-size:10px}',
            '.moth-mw-btn:hover{filter:brightness(1.12)}',
            '.moth-mw-btn.primary{background:var(--rx,#84325f);color:#fff}',
            '.moth-mw-btn:disabled{opacity:.45;cursor:default}',
            '.moth-mw-config{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:6px;margin-bottom:10px;padding:8px;border-radius:7px;background:var(--vao,#21191d);box-shadow:inset 0 0 0 2px var(--mad-linha,#3a2824)}',
            '.moth-mw-config label{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:var(--sobre-mad-dim,#bbb)}',
            '.moth-mw-config input[type=number]{width:76px;padding:3px 5px;border:1px solid var(--mad-linha,#555);border-radius:4px;background:var(--vao2,#171115);color:var(--sobre-mad,#fff)}',
            '.moth-mw-config input[type=checkbox]{flex:none}',
            '.moth-mw-config .moth-mw-checkbox-control{display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:flex-start!important;gap:8px!important;min-height:24px;min-width:0}',
            '.moth-mw-config .moth-mw-checkbox-control::before,.moth-mw-config .moth-mw-checkbox-control::after,.moth-mw-config .moth-mw-checkbox-control>label::before,.moth-mw-config .moth-mw-checkbox-control>label::after{content:none!important;display:none!important}',
            '.moth-mw-config .moth-mw-checkbox-control>label{display:block!important;flex:1;min-width:0;margin:0;padding:0;cursor:pointer;font:inherit;color:inherit;justify-content:flex-start!important}',
            '.moth-mw-config .moth-mw-checkbox-control>input[type=checkbox]{appearance:auto!important;-webkit-appearance:checkbox!important;position:static!important;inset:auto!important;display:inline-block!important;visibility:visible!important;opacity:1!important;transform:none!important;flex:0 0 16px!important;width:16px!important;height:16px!important;margin:0!important;padding:0!important;accent-color:var(--rx,#84325f)}',
            '.moth-mw-baseline{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:-2px 0 10px;font-size:9px;color:var(--sobre-mad-dim,#aaa)}',
            '.moth-mw-filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px;padding:7px 8px;border-radius:7px;background:var(--vao,#21191d);box-shadow:inset 0 0 0 2px var(--mad-linha,#3a2824)}',
            '.moth-mw-filter-group{display:flex;align-items:center;gap:4px;flex-wrap:wrap}',
            '.moth-mw-filter-label{font-size:9px;font-weight:700;color:var(--sobre-mad-dim,#aaa);margin-right:2px}',
            '.moth-mw-filter{display:inline-flex;align-items:center;gap:4px;min-height:28px;padding:4px 7px;border:1px solid var(--mad-linha,#3a2824);border-radius:5px;background:var(--mad,#5a413b);color:var(--sobre-mad,#fff);font:inherit;font-size:10px;cursor:pointer}',
            '.moth-mw-filter img{width:16px;height:16px;object-fit:contain}',
            '.moth-mw-filter.on{background:var(--rx,#84325f);color:#fff;filter:none;box-shadow:inset 0 0 0 1px var(--rx-esc,#5d2345)}',
            '.moth-mw-filter:focus-visible,.moth-mw-btn:focus-visible,.moth-mw-tab:focus-visible{outline:2px solid var(--rx,#84325f);outline-offset:2px}',
            '.moth-mw-sort{display:flex;align-items:center;gap:5px;margin-left:auto}',
            '.moth-mw-sort select{min-height:28px;padding:3px 7px;border:1px solid var(--mad-linha,#555);border-radius:5px;background:var(--vao2,#171115);color:var(--sobre-mad,#fff);font-size:10px}',
            '.moth-mw-inventory{margin:10px 0;padding:8px;border-radius:7px;background:var(--vao,#21191d);box-shadow:inset 0 0 0 1px var(--mad-linha,#3a2824)}',
            '.moth-mw-inventory-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;font-size:11px}',
            '.moth-mw-inventory-head span{font-size:10px;color:var(--sobre-mad-dim,#aaa)}',
            '.moth-mw-inventory-toggle{display:inline-flex;align-items:center;gap:7px;border:0;padding:2px 4px;background:transparent;color:var(--sobre-mad,#eee);font:inherit;font-weight:700;cursor:pointer}',
            '.moth-mw-inventory-toggle:hover{color:var(--sobre-mad,#fff);filter:brightness(1.2)}',
            '.moth-mw-inventory-chevron{display:inline-block;min-width:10px;color:var(--sobre-mad-dim,#aaa)}',
            '.moth-mw-inventory-body[hidden]{display:none!important}',
            '.moth-mw-inventory-note{margin:0 0 7px;color:var(--sobre-mad-dim,#aaa);font-size:9px;line-height:1.4}',
            '.moth-mw-list-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:12px 0 5px;font-size:11px}',
            '.moth-mw-list-head span{font-size:9px;color:var(--sobre-mad-dim,#aaa)}',
            '.moth-mw-inventory-list{max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:4px}',
            '.moth-mw-inventory-row{display:grid;grid-template-columns:minmax(130px,1.2fr) minmax(140px,1fr) minmax(140px,1fr);align-items:center;gap:8px;padding:5px;border-radius:5px;background:rgba(255,255,255,.025)}',
            '.moth-mw-inventory-name{display:flex;flex-direction:column;gap:2px;min-width:0}',
            '.moth-mw-inventory-name b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}',
            '.moth-mw-inventory-name span,.moth-mw-inventory-price .moth-mw-money{font-size:10px}',
            '.moth-mw-inventory-price{display:flex;align-items:center;justify-content:space-between;gap:5px;flex-wrap:wrap}',
            '@media(max-width:720px){.moth-mw-inventory-row{grid-template-columns:1fr;gap:5px}.moth-mw-inventory-price{justify-content:flex-start}}',
            '.moth-mw-list{display:grid;gap:5px}',
            '.moth-mw-item-offers{grid-column:1/-1;padding:8px;border:1px solid var(--mad-linha,#3a2824);border-radius:6px;background:var(--vao,#21191d);min-width:0}',
            '.moth-mw-item-offers-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:7px;font-size:10px}',
            '.moth-mw-offer-list{display:grid;gap:4px}',
            '.moth-mw-offer-row{display:grid;grid-template-columns:minmax(100px,1fr) auto auto minmax(55px,auto) auto;align-items:center;gap:8px;padding:5px 7px;border-radius:4px;background:var(--mad,#2a2025);font-size:10px;min-width:0}',
            '.moth-mw-offer-seller{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
            '.moth-mw-offer-meta{color:var(--sobre-mad-dim,#aaa);white-space:nowrap}',
            '@media(max-width:720px){.moth-mw-offer-row{grid-template-columns:minmax(90px,1fr) auto auto;gap:6px}.moth-mw-offer-id{display:none}}',
            '.moth-mw-workspace{display:flex;flex-direction:column;gap:9px;min-height:0}',
            '.moth-mw-tabs{display:flex;gap:5px;flex-wrap:wrap;padding:4px;border-radius:8px;background:var(--vao,#21191d);box-shadow:inset 0 0 0 1px var(--mad-linha,#3a2824)}',
            '.moth-mw-tab{flex:1;min-width:110px;border:0;border-radius:6px;padding:8px 10px;background:transparent;color:var(--sobre-mad-dim,#bbb);font-size:11px;font-weight:700;cursor:pointer}',
            '.moth-mw-tab[aria-selected=true]{background:var(--rx,#84325f);color:#fff}',
            '.moth-mw-overview{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 10px;border-radius:7px;background:var(--vao,#21191d)}',
            '.moth-mw-overview b{font-size:12px}',
            '.moth-mw-overview span{font-size:10px;color:var(--sobre-mad-dim,#aaa)}',
            '#moth-mw-search{flex:1;min-width:180px;min-height:28px;padding:5px 8px;border:1px solid var(--mad-linha,#555);border-radius:5px;background:var(--vao2,#171115);color:var(--sobre-mad,#fff);font-size:11px}',
            '.moth-mw-section-title{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:4px 0 7px}',
            '.moth-mw-section-title h4{margin:0;font-size:13px}',
            '.moth-mw-section-title span{font-size:10px;color:var(--sobre-mad-dim,#aaa)}',
            '.moth-mw-settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:9px}',
            '.moth-mw-settings-card{min-width:0;padding:10px;border-radius:8px;background:var(--vao,#21191d);box-shadow:inset 0 0 0 1px var(--mad-linha,#3a2824)}',
            '.moth-mw-settings-card h4{margin:0 0 8px;font-size:12px}',
            '.moth-mw-settings-card .moth-mw-config{display:grid;grid-template-columns:1fr;gap:8px;margin:0;padding:0;background:transparent;box-shadow:none}',
            '.moth-mw-settings-card .moth-mw-config label{font-size:11px}',
            '.moth-mw-setting{min-width:0;display:flex;flex-direction:column;gap:4px;padding:4px 0}',
            '.moth-mw-setting-help{display:block;font-size:10px;line-height:1.4;color:var(--sobre-mad-dim,#999)}',
            '.moth-mw-automation-block{margin-top:12px;padding:11px;border:1px solid var(--mad-linha,#3a2824);border-radius:9px;background:var(--vao,#21191d)}',
            '.moth-mw-automation-block.primary{border-color:color-mix(in srgb,var(--rx,#84325f) 52%,var(--mad-linha,#3a2824))}',
            '.moth-mw-automation-status{padding:11px;border-radius:9px;background:var(--vao,#21191d);box-shadow:inset 0 0 0 1px var(--mad-linha,#3a2824)}',
            '.moth-mw-master-row{margin:8px 0}.moth-mw-master-row .moth-mw-setting{padding:0}.moth-mw-master-row .moth-mw-setting-help{display:none}',
            '.moth-mw-rule-add-card{display:grid;gap:8px;margin:9px 0 11px;padding:9px;border-radius:8px;background:rgba(255,255,255,.03);box-shadow:inset 0 0 0 1px var(--mad-linha,#3a2824)}',
            '.moth-mw-rule-add-search{display:grid;grid-template-columns:minmax(150px,.8fr) minmax(190px,1.2fr);gap:7px}.moth-mw-rule-add-fields{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:7px}',
            '.moth-mw-rule-add-card label,.moth-mw-rule-card label{display:flex;flex-direction:column;gap:3px;font-size:9px;color:var(--sobre-mad-dim,#aaa);min-width:0}',
            '.moth-mw-rule-add-card input,.moth-mw-rule-add-card select,.moth-mw-rule-card input,.moth-mw-rule-card select{min-width:0;width:100%;box-sizing:border-box}',
            '.moth-mw-rule-add-actions,.moth-mw-rule-card-foot{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.moth-mw-rule-add-actions{justify-content:space-between}.moth-mw-rule-add-actions>span,.moth-mw-rule-note{font-size:9px;color:var(--sobre-mad-dim,#aaa);line-height:1.35;flex:1;min-width:190px}',
            '.moth-mw-rule-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:8px}',
            '.moth-mw-rule-card{display:grid;gap:8px;min-width:0;padding:9px;border-radius:8px;background:rgba(255,255,255,.035);box-shadow:inset 0 0 0 1px var(--mad-linha,#3a2824)}',
            '.moth-mw-rule-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:9px}.moth-mw-rule-title{display:flex;flex-direction:column;gap:2px;min-width:0}.moth-mw-rule-title>b{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.moth-mw-rule-title>small{font-size:8px;color:var(--sobre-mad-dim,#aaa)}',
            '.moth-mw-rule-card-head>label{min-width:92px}.moth-mw-rule-fields{display:grid;grid-template-columns:repeat(4,minmax(82px,1fr));gap:7px}.moth-mw-rule-fields.compact{grid-template-columns:repeat(2,minmax(86px,1fr))}',
            '.moth-mw-rule-side{display:grid;gap:7px;padding:8px;border-radius:7px;background:rgba(0,0,0,.08);box-shadow:inset 0 0 0 1px var(--mad-linha,#3a2824)}.moth-mw-rule-side-head{display:flex;align-items:center;justify-content:space-between}',
            '.moth-mw-switch{display:flex!important;flex-direction:row!important;align-items:center!important;gap:6px!important;color:var(--sobre-mad,#eee)!important}.moth-mw-switch input{width:auto!important;flex:none}',
            '.moth-mw-btn.danger{background:transparent;color:#e7a4a4;box-shadow:inset 0 0 0 1px rgba(210,90,90,.55)}.moth-mw-btn.danger:hover{background:rgba(180,60,60,.13)}',
            '.moth-mw-rule-notice{margin:8px 0;padding:7px 9px;border-radius:6px;font-size:10px;background:rgba(255,255,255,.04);box-shadow:inset 0 0 0 1px var(--mad-linha,#3a2824)}.moth-mw-rule-notice.warn{box-shadow:inset 0 0 0 1px var(--seta,#efc66b)}.moth-mw-rule-notice.ok{box-shadow:inset 0 0 0 1px var(--rx,#84325f)}',
            '.moth-mw-advanced{margin-top:12px;border-radius:8px;background:var(--vao,#21191d);box-shadow:inset 0 0 0 1px var(--mad-linha,#3a2824)}.moth-mw-advanced>summary{padding:10px 11px;cursor:pointer;font-size:11px;font-weight:800}.moth-mw-advanced-body{padding:0 10px 10px}.moth-mw-advanced-note{font-size:9px;color:var(--sobre-mad-dim,#aaa);margin:0 0 8px}',
            '@media(max-width:900px){.moth-mw-auto-status-grid{grid-template-columns:1fr}.moth-mw-rule-add-search,.moth-mw-rule-add-fields{grid-template-columns:1fr 1fr}.moth-mw-rule-list{grid-template-columns:1fr}}',
            '@media(max-width:620px){.moth-mw-rule-add-search,.moth-mw-rule-add-fields,.moth-mw-rule-fields,.moth-mw-rule-fields.compact,.moth-mw-targets{grid-template-columns:1fr}.moth-mw-rule-card-head{flex-direction:column}.moth-mw-rule-card-head>label{width:100%}}',
            '/* Automation workspace: readable at normal zoom, with no six-column forms. */',
            '#moth-mw-view-content[data-view=automation]{display:grid;gap:14px;min-width:0;font-size:13px;line-height:1.5;container-type:inline-size}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-section-title{margin:2px 0 0;align-items:flex-start;flex-direction:column;gap:3px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-section-title h4{font-size:16px;line-height:1.35}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-section-title span{font-size:12px;line-height:1.5}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-automation-block{margin:0;padding:17px;border-radius:11px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-automation-status{padding:15px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-auto-status-grid{gap:10px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-auto-status-pill{padding:11px;gap:11px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-auto-status-pill b{font-size:12px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-auto-status-pill small{font-size:11px;line-height:1.3}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-block-heading{margin-bottom:12px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-block-heading h4{margin:0 0 5px;font-size:16px;line-height:1.3;color:var(--sobre-mad,#fff)}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-block-heading p{margin:0;color:var(--sobre-mad-dim,#c2b5bb);font-size:12px;line-height:1.5;max-width:75ch}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-master-row{margin:0 0 14px;padding:11px 13px;border:1px solid var(--mad-linha,#604850);border-radius:8px;background:rgba(255,255,255,.045)}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-master-row label{font-size:13px;font-weight:700}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-add-card{gap:14px;margin:0 0 17px;padding:15px;background:rgba(0,0,0,.12);border:1px solid var(--mad-linha,#604850);box-shadow:none;border-radius:9px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-add-card h5,.moth-mw-rule-list-title{margin:0;font-size:14px;font-weight:800;color:var(--sobre-mad,#fff)}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-add-search{grid-template-columns:minmax(125px,.9fr) minmax(175px,1.4fr) minmax(110px,.7fr);gap:11px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-add-fields{grid-template-columns:repeat(3,minmax(120px,1fr));gap:11px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-field{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:12px;font-weight:650;color:var(--sobre-mad,#eee)}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-field>span{font-size:12px;color:var(--sobre-mad,#e3d8dc);line-height:1.4}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-field input,#moth-mw-view-content[data-view=automation] .moth-mw-rule-field select{min-height:38px;padding:8px 10px;border-radius:7px;border:1px solid var(--mad-linha,#6b555d);background:var(--vao2,#171115);color:var(--sobre-mad,#fff);font-size:13px;line-height:1.3;max-width:100%;box-sizing:border-box}',
            '#moth-mw-view-content[data-view=automation] input:focus-visible,#moth-mw-view-content[data-view=automation] select:focus-visible{outline:2px solid var(--rx,#a64b7d);outline-offset:2px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-compose{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;min-width:0}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-side{padding:14px;gap:11px;align-content:start;background:rgba(255,255,255,.025);border:1px solid var(--mad-linha,#56404d);box-shadow:none}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-side.buy{border-left:3px solid #82bda4}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-side.sell{border-left:3px solid #d6b077}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-side h6{margin:0;font-size:13px;font-weight:800;color:var(--sobre-mad,#fff)}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-hint{margin:0;font-size:11px;line-height:1.55;color:var(--sobre-mad-dim,#c4b9bf)}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-add-actions{gap:13px;align-items:center}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-add-actions>span{font-size:11px;line-height:1.5;min-width:160px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-btn.primary{min-height:37px;padding:9px 15px;font-size:12px;font-weight:800}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-list{grid-template-columns:1fr;gap:11px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-card{padding:15px;gap:12px;border-radius:9px;background:rgba(255,255,255,.035)}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-card-head{align-items:center;flex-wrap:wrap}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-title>b{font-size:14px;white-space:normal;overflow:visible;line-height:1.3}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-title>small{font-size:11px;line-height:1.4}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-card-head>.moth-mw-rule-field{min-width:110px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-fields{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-fields.compact{grid-template-columns:repeat(2,minmax(0,1fr))}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-card-foot{border-top:1px solid var(--mad-linha,#604850);padding-top:11px;justify-content:space-between}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-note{font-size:11px;line-height:1.5}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-toggle{font-size:12px;cursor:pointer}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-rule-toggle input{width:18px!important;height:18px!important;accent-color:var(--rx,#84325f)}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-targets{gap:9px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-target-chip{padding:9px 11px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-target-chip small{font-size:11px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-target-chip b{font-size:13px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-budget-card{padding:16px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-budget-card h4{font-size:15px;margin-bottom:9px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-budget-warning{margin:0 0 12px;font-size:12px;line-height:1.5;color:var(--sobre-mad,#eee)}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-budget-card .moth-mw-config{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 15px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-settings-card .moth-mw-config label{font-size:12px;line-height:1.4}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-settings-card h4{font-size:14px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-setting-help{font-size:11px;line-height:1.5}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-advanced>summary{font-size:13px;padding:13px}',
            '#moth-mw-view-content[data-view=automation] .moth-mw-advanced-note{font-size:11px;line-height:1.5}',
            '@container (max-width:750px){#moth-mw-view-content[data-view=automation] .moth-mw-rule-add-search{grid-template-columns:repeat(2,minmax(0,1fr))}}',
            '@container (max-width:570px){#moth-mw-view-content[data-view=automation] .moth-mw-rule-add-search,#moth-mw-view-content[data-view=automation] .moth-mw-rule-add-fields,#moth-mw-view-content[data-view=automation] .moth-mw-rule-compose,#moth-mw-view-content[data-view=automation] .moth-mw-budget-card .moth-mw-config,#moth-mw-view-content[data-view=automation] .moth-mw-rule-fields,#moth-mw-view-content[data-view=automation] .moth-mw-rule-fields.compact{grid-template-columns:1fr}}',
            '@media(max-width:620px){#moth-mw-view-content[data-view=automation] .moth-mw-rule-add-search,#moth-mw-view-content[data-view=automation] .moth-mw-rule-add-fields,#moth-mw-view-content[data-view=automation] .moth-mw-rule-compose,#moth-mw-view-content[data-view=automation] .moth-mw-budget-card .moth-mw-config,#moth-mw-view-content[data-view=automation] .moth-mw-rule-fields,#moth-mw-view-content[data-view=automation] .moth-mw-rule-fields.compact{grid-template-columns:1fr}#moth-mw-view-content[data-view=automation] .moth-mw-rule-add-actions .moth-mw-btn{width:100%}}',
            '.moth-mw-setting-control{min-width:0;display:flex;align-items:center;justify-content:space-between;gap:10px}',
            '.moth-mw-setting-control>span{flex:1}',
            '.moth-mw-setting-control input[type=number]{width:110px;max-width:42%;font-size:11px;padding:5px 6px}',
            '.moth-mw-setting-control input[type=checkbox]{width:16px;height:16px;accent-color:var(--rx,#84325f)}',
            '.moth-mw-range-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px}',
            '.moth-mw-range-head output{font-weight:800;font-size:12px;color:var(--sobre-mad,#fff);font-variant-numeric:tabular-nums}',
            '.moth-mw-range{width:100%;accent-color:var(--rx,#84325f);cursor:pointer}',
            '.moth-mw-range-scale{display:flex;justify-content:space-between;color:var(--sobre-mad-dim,#888);font-size:9px}',
            '.moth-mw-reference-tools{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-top:9px;padding:10px;border-radius:8px;background:var(--vao,#21191d)}',
            '.moth-mw-reference-tools .moth-mw-reference-info{flex:1;min-width:230px;font-size:10px;color:var(--sobre-mad-dim,#aaa);line-height:1.5}',
            '#moth-mw-pricing-list{display:grid;gap:10px;min-width:0}',
            '.moth-mw-evidence-card{padding:12px;border:1px solid var(--mad-linha,#604850);border-radius:9px;background:var(--vao,#21191d);min-width:0;overflow-wrap:anywhere}',
            '.moth-mw-evidence-card h5{margin:0 0 7px;font-size:13px}',
            '.moth-mw-evidence-card p{margin:6px 0;font-size:11px;line-height:1.5}',
            '.moth-mw-evidence-meta,.moth-mw-evidence-intro{font-size:11px;color:var(--sobre-mad-dim,#bbb)}',
            '.moth-mw-row{display:grid;grid-template-columns:minmax(170px,1.4fr) 120px 110px 90px minmax(110px,.8fr) auto;gap:7px;align-items:center;padding:7px;border-radius:6px;background:var(--vao,#21191d);box-shadow:inset 0 0 0 2px var(--mad-linha,#3a2824)}',
            '.moth-mw-row.deep{box-shadow:inset 0 0 0 2px var(--rx,#84325f),inset 0 0 0 4px var(--rx-esc,#5d2345)}',
            '.moth-mw-name{min-width:0}.moth-mw-name b,.moth-mw-name span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.moth-mw-name b{font-size:11px}.moth-mw-name span{font-size:9px;color:var(--sobre-mad-dim,#aaa)}',
            '.moth-mw-kind{display:inline-block;margin-right:5px;padding:1px 4px;border-radius:3px;background:var(--mad,#5a413b);font-size:8px;text-transform:uppercase}',
            '.moth-mw-discount{font-weight:800;color:var(--seta,#efc66b)}',
            '.moth-mw-money{display:inline-flex;align-items:center;gap:3px;font-weight:700}.moth-mw-money img{width:15px;height:15px;object-fit:contain}',
            '.moth-mw-meta{font-size:9px;color:var(--sobre-mad-dim,#aaa)}',
            '.moth-mw-empty{padding:22px;text-align:center;color:var(--sobre-mad-dim,#aaa);background:var(--vao,#21191d);border-radius:6px}',
            '.moth-mw-log{margin-top:10px;padding-top:8px;border-top:1px solid var(--mad-linha,#444);font-size:9px;color:var(--sobre-mad-dim,#aaa)}',
            '.moth-mw-log div{margin:2px 0}',
            '@media(max-width:850px){.moth-mw-row{grid-template-columns:minmax(150px,1fr) 105px 80px auto}.moth-mw-row .moth-mw-ref,.moth-mw-row .moth-mw-seller{display:none}}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
    }

    function baselineStats() {
        const rows = Object.values(state.baseline.items || {});
        let gold = 0;
        let orb = 0;
        for (const row of rows) {
            if (row && row.gold && Number(row.gold.average) > 0) gold++;
            if (row && row.orb && Number(row.orb.average) > 0) orb++;
        }
        return { items: rows.length, gold: gold, orb: orb };
    }

    function exportBaselineText() {
        const rows = state.baseline.items || {};
        const sorted = Object.keys(rows)
            .map(Number)
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
        const lines = ['const HARD_CODED_ITEM_AVERAGES = Object.freeze({'];
        for (const id of sorted) {
            const row = rows[id] || rows[String(id)] || {};
            const compact = {
                name: row.name || catalogName(id),
                gold: row.gold && Number(row.gold.average) > 0
                    ? { average: Math.round(Number(row.gold.average)), units: Number(row.gold.units || 0) }
                    : null,
                orb: row.orb && Number(row.orb.average) > 0
                    ? { average: Math.round(Number(row.orb.average)), units: Number(row.orb.units || 0) }
                    : null
            };
            lines.push('    ' + id + ': ' + JSON.stringify(compact) + ',');
        }
        lines.push('});');
        return lines.join('\n');
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            try {
                const area = document.createElement('textarea');
                area.value = text;
                area.style.position = 'fixed';
                area.style.opacity = '0';
                document.body.appendChild(area);
                area.select();
                const ok = document.execCommand('copy');
                area.remove();
                return ok;
            } catch {
                return false;
            }
        }
    }

    const CONFIG_HELP = Object.freeze({
        watchPercent: 'Show an offer when its price is at or below this share of the reference. 70% means at least 30% below reference.',
        scanSeconds: 'How often the market scanner checks again. Lower finds changes sooner but sends requests more often. With buying rules active and Watch closed, general scans slow to at least 30 seconds.',
        scanItems: 'Scan ordinary market items and let you inspect their current offers.',
        scanPokemon: 'Scan Pokémon listings and compare them with completed-sale history.',
        scanDiamonds: 'Scan diamond listings and compare prices when a reference is available.',
        goldReserve: 'Money that must remain untouched. This is subtracted before calculating an affordable purchase.',
        gemReserve: 'Gems that must remain untouched. This is subtracted before calculating an affordable purchase.',
        maxCoinsPerBuy: 'Maximum Coin spend on one purchase. Set to 0 for no extra cap beyond your reserve and balance.',
        maxGemsPerBuy: 'Maximum Gem spend on one purchase. Set to 0 for no extra cap beyond your reserve and balance.',
        minItemUnits: 'Require at least this many sold units before using an item reference for automatic buying.',
        minPokemonSamples: 'Require this many completed Pokémon sales before automatic buying can use that reference.',
        pokemonHistoryPages: 'How many pages of completed-sale history to read. More pages take longer and use more requests.'
    });
    const CONFIG_LIMITS = Object.freeze({
        watchPercent: { min: 1, max: 100 },
        scanSeconds: { min: 1, max: 120 },
        minItemUnits: { min: 1, max: 1000000 },
        minPokemonSamples: { min: 1, max: 1000000 },
        pokemonHistoryPages: { min: 1, max: 50 },
        goldReserve: { min: 0, max: Number.MAX_SAFE_INTEGER },
        gemReserve: { min: 0, max: Number.MAX_SAFE_INTEGER },
        maxCoinsPerBuy: { min: 0, max: Number.MAX_SAFE_INTEGER },
        maxGemsPerBuy: { min: 0, max: Number.MAX_SAFE_INTEGER }
    });

    function normalizedConfigValue(key, raw) {
        const limits = CONFIG_LIMITS[key] || { min: 0, max: Number.MAX_SAFE_INTEGER };
        const value = Number(raw);
        if (!Number.isFinite(value)) return Number(config[key]) || limits.min;
        return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
    }

    function configField(label, key, type, suffix) {
        const value = config[key];
        const help = CONFIG_HELP[key] || '';
        const limit = CONFIG_LIMITS[key] || { min: 0, max: Number.MAX_SAFE_INTEGER };
        const helpMarkup = help
            ? '<small class="moth-mw-setting-help">' + escapeHtml(tr(help)) + '</small>'
            : '';
        const field = type === 'checkbox'
            ? '<div class="moth-mw-setting-control moth-mw-checkbox-control"><input id="moth-mw-cfg-' + escapeHtml(key) +
                '" type="checkbox" data-moth-cfg="' + escapeHtml(key) + '"' + (value ? ' checked' : '') +
                '><label for="moth-mw-cfg-' + escapeHtml(key) + '">' + escapeHtml(tr(label)) + '</label></div>'
            : type === 'range'
                ? '<div class="moth-mw-range-head"><label for="moth-mw-cfg-' + escapeHtml(key) + '">' +
                    escapeHtml(tr(label)) + '</label><output data-moth-cfg-value="' + escapeHtml(key) + '">' +
                    escapeHtml(value) + '%</output></div>' +
                    '<input id="moth-mw-cfg-' + escapeHtml(key) + '" class="moth-mw-range" type="range" data-moth-cfg="' +
                    escapeHtml(key) + '" value="' + escapeHtml(value) + '" min="' + limit.min + '" max="' + limit.max + '" step="1">' +
                    '<div class="moth-mw-range-scale"><span>' + limit.min + '%</span><span>' + limit.max + '%</span></div>'
                : '<label class="moth-mw-setting-control"><span>' + escapeHtml(tr(label)) +
                    (suffix ? ' <small>' + escapeHtml(tr(suffix)) + '</small>' : '') +
                    '</span><input type="number" data-moth-cfg="' + escapeHtml(key) + '" value="' +
                    escapeHtml(value) + '" min="' + limit.min + '" max="' + limit.max + '" step="1"></label>';
        return '<div class="moth-mw-setting">' + field + helpMarkup + '</div>';
    }

    function renderItemInventory() {
        const entries = Object.entries(state.itemSummary || {})
            .map(([rawId, row]) => ({ itemId: Number(rawId), row: row || {}, name: catalogName(rawId) }))
            .filter(entry => Number.isFinite(entry.itemId) && entry.itemId > 0 && Number(entry.row.anuncios || 0) > 0)
            .sort((a, b) => a.name.localeCompare(b.name, currentLocale()));

        const renderOffers = (entry, currency) => {
            const key = String(entry.itemId) + ':' + currency;
            if (state.selectedItemFocus?.key !== key) return '';
            const status = state.itemDetailStatus?.key === key ? state.itemDetailStatus.status : 'idle';
            const detail = state.itemOfferDetails.get(key);
            const queued = state.detailQueue.some(job => job.key === key) || state.detailQueued.has(key);
            const pending = state.detailPending?.key === key;
            const loading = status === 'loading' || queued || pending;
            const currencyName = tr(currency === 'orb' ? 'Gems' : 'Coins');
            let content = '';

            if (detail && detail.offers.length) {
                const offers = detail.offers.slice().sort((a, b) => {
                    const priceDiff = Number(a?.preco || 0) - Number(b?.preco || 0);
                    return priceDiff || Number(a?.id || 0) - Number(b?.id || 0);
                });
                content = '<div class="moth-mw-offer-list">' + offers.map(offer => {
                    const price = Number(offer && offer.preco);
                    if (!offer || !Number.isFinite(price) || price <= 0) return '';
                    const listingId = Number(offer.id);
                    const own = isOwnListing(offer);
                    const candidateKey = 'item:' + entry.itemId + ':' + currency + ':' + offer.id;
                    const candidate = Number.isFinite(listingId) && listingId > 0 ? state.candidates.get(candidateKey) : null;
                    const qty = Math.max(1, Number(offer.qtd || 1));
                    const action = !own && candidate
                        ? '<button type="button" class="moth-mw-btn primary" data-moth-buy="' + escapeHtml(candidate.key) + '">' + escapeHtml(tr('Buy')) + '</button>'
                        : own
                            ? '<span class="moth-mw-offer-meta">' + escapeHtml(tr('Own listing')) + '</span>'
                            : '<span class="moth-mw-offer-meta">—</span>';
                    return '<div class="moth-mw-offer-row">' +
                        '<span class="moth-mw-offer-seller" title="' + escapeHtml(String(offer.vendedor || '—')) + '">' + escapeHtml(String(offer.vendedor || '—')) + '</span>' +
                        '<span class="moth-mw-offer-meta">' + num(qty) + ' ' + escapeHtml(tr('units')) + '</span>' +
                        '<b>' + money(price, currency) + '</b>' +
                        '<span class="moth-mw-offer-meta moth-mw-offer-id">#' + (Number.isFinite(listingId) ? num(listingId) : '—') + '</span>' +
                        action + '</div>';
                }).filter(Boolean).join('') + '</div>';
            } else if (loading || status === 'idle') {
                content = '<div class="moth-mw-empty">' + escapeHtml(tr('Waiting for the market to return offers…')) + '</div>';
            } else if (status === 'timeout') {
                content = '<div class="moth-mw-empty">' + escapeHtml(tr('Market did not respond. Load offers again.')) + '</div>';
            } else {
                content = '<div class="moth-mw-empty">' + escapeHtml(tr('No offers found in this currency.')) + '</div>';
            }

            const statusText = loading && detail ? '<span>' + escapeHtml(tr('Refreshing offers…')) + '</span>' : '';
            return '<div class="moth-mw-item-offers">' +
                '<div class="moth-mw-item-offers-head"><b>' + escapeHtml(tr('Offers')) + ' · ' + escapeHtml(currencyName) +
                ' · ' + escapeHtml(tr('Offer count: {count}', { count: num(detail?.offers?.length || 0) })) + '</b>' +
                statusText +
                '<button type="button" class="moth-mw-btn" data-moth-hide-offers="1">' + escapeHtml(tr('Hide offers')) + '</button></div>' +
                content + '</div>';
        };

        const rows = entries.slice(0, 120).map(entry => {
            const row = entry.row, coinPrice = Number(row.minGold), gemPrice = Number(row.minOrb);
            const coinButton = Number.isFinite(coinPrice) && coinPrice > 0
                ? '<button type="button" class="moth-mw-btn" data-moth-item-scan="' + entry.itemId + '" data-moth-item-currency="gold">' + escapeHtml(tr('Load Coin offers')) + '</button>'
                : '<button type="button" class="moth-mw-btn" disabled>' + escapeHtml(tr('No Coin offers')) + '</button>';
            const gemButton = Number.isFinite(gemPrice) && gemPrice > 0
                ? '<button type="button" class="moth-mw-btn" data-moth-item-scan="' + entry.itemId + '" data-moth-item-currency="orb">' + escapeHtml(tr('Load Gem offers')) + '</button>'
                : '<button type="button" class="moth-mw-btn" disabled>' + escapeHtml(tr('No Gem offers')) + '</button>';
            const count = Number(row.anuncios) || 0;
            return '<div class="moth-mw-inventory-entry">' +
                '<div class="moth-mw-inventory-row"><div class="moth-mw-inventory-name"><b>' + escapeHtml(entry.name) + '</b><span>' +
                escapeHtml(tr(count === 1 ? '1 listing' : '{count} listings', { count: num(count) })) + '</span></div>' +
                '<div class="moth-mw-inventory-price">' + (coinPrice > 0 ? money(coinPrice, 'gold') : '<span class="moth-mw-meta">' + escapeHtml(tr('Coins')) + ' —</span>') +
                coinButton + '</div><div class="moth-mw-inventory-price">' +
                (gemPrice > 0 ? money(gemPrice, 'orb') : '<span class="moth-mw-meta">' + escapeHtml(tr('Gems')) + ' —</span>') + gemButton + '</div></div>' +
                renderOffers(entry, 'gold') + renderOffers(entry, 'orb') + '</div>';
        }).join('');
        const collapsed = Boolean(state.itemInventoryCollapsed);
        return '<div class="moth-mw-inventory"><div class="moth-mw-inventory-head">' +
            '<button type="button" class="moth-mw-inventory-toggle" id="moth-mw-inventory-toggle" aria-expanded="' + (!collapsed ? 'true' : 'false') + '">' +
            '<span class="moth-mw-inventory-chevron" aria-hidden="true">' + (collapsed ? '▸' : '▾') + '</span><b>' + escapeHtml(tr('Items for sale')) + '</b></button>' +
            '<span>' + num(entries.length) + ' ' + escapeHtml(tr(entries.length === 1 ? 'item type with active listings' : 'item types with active listings')) +
            (entries.length > 120 ? escapeHtml(tr(' · showing first {count}', { count: 120 })) : '') + '</span></div>' +
            '<div class="moth-mw-inventory-body" id="moth-mw-inventory-body"' + (collapsed ? ' hidden' : '') + '>' +
            '<div class="moth-mw-inventory-note">' + escapeHtml(tr('This summary shows the lowest active market price for every item. Use Load Coin/Gem offers to expand all current listings under the selected item. Loaded listings also remain available in Opportunities.')) + '</div>' +
            '<div class="moth-mw-inventory-list">' + (rows || '<div class="moth-mw-empty">' + escapeHtml(tr('No market item inventory has arrived yet.')) + '</div>') +
            '</div></div></div>';
    }

    // Inspection is pure/read-only: neither a median nor a preview can enable a
    // rule, change a spending limit, or submit a market.comprar request.
    function pokemonRulePreview(listing, currency) {
        const price = Number(listing?.preco);
        const results = [];
        for (const rule of sanitizePokemonBuyRules(config.pokemonBuyRules)) {
            if (rule.currency !== currency || !pokemonRuleMatches(rule, listing?.ficha, currency)) continue;
            let status = 'Rule paused';
            if (!rule.buyEnabled || !config.enabled || !config.fixedRulesEnabled ||
                config.purchasesPaused) status = 'Rule paused';
            else if (!Number.isSafeInteger(price) || price <= 0) status = 'Unverified listing price';
            else if (price > rule.buyMax) status = 'Above price ceiling';
            else if (typeof listing?.ficha?.shiny !== 'boolean' ||
                !Number.isSafeInteger(Number(listing?.ficha?.potencia)) ||
                Number(listing.ficha.potencia) < 1 || Number(listing.ficha.potencia) > 5)
                status = 'Unknown Pokémon traits';
            else if (!Number.isSafeInteger(Number(listing?.qtd)) || Number(listing.qtd) !== 1)
                status = 'Unverified quantity';
            else if (!Number.isSafeInteger(Number(listing?.id)) || Number(listing.id) <= 0)
                status = 'Unverified listing identity';
            else if (isOwnListing(listing)) status = 'Your own listing';
            else if (retentionUntil(listing) > serverNow()) status = 'Listing still held';
            else if (!state.orderJournal || unverifiedOrdersExist()) status = 'Awaiting reconciliation';
            else if (remainingBudget(currency, rule.id).spend < price) status = 'Budget blocked';
            else if (balanceFor(currency) - reserveFor(currency) < price)
                status = 'Insufficient spendable balance';
            else if (state.pendingBuy) status = 'Waiting for acknowledgement';
            else status = 'Matches absolute-price rule';
            results.push({ kind: rule.kind, status,
                buyMax: rule.buyMax, currency, ruleId: rule.id });
        }
        return results;
    }

    function pokemonEvidenceCard(listing, currency, observedAt) {
        const facts = pokemonFacts(listing?.ficha);
        const role = pokemonCombatRole(listing?.ficha);
        const ref = pokemonReferenceFor(listing?.ficha, currency);
        const price = Number(listing?.preco);
        const iv = facts.ivs;
        const flags = Object.entries(facts.traits).filter(([, flag]) => flag === true)
            .map(([name]) => name);
        const unverifiedExtras = Object.values(facts.traits).some(value => value === null);
        const dateLabel = ref?.ageDays == null ? tr('Sale dates unverified')
            : tr('Newest comparable sale: {days} days ago', { days: ref.ageDays });
        const sourceLabel = ref
            ? tr('Completed sales · {count} matched of {total} · {confidence}', {
                count: num(ref.samples), total: num(ref.bucketSamples),
                confidence: tr(ref.confidence)
            }) : tr('Insufficient comparable sales');
        const priceLabel = ref
            ? tr('Median {median} · IQR {low}–{high} · P10–P90 {p10}–{p90}', {
                median: num(Math.round(ref.value)), low: num(Math.round(ref.low)),
                high: num(Math.round(ref.high)), p10: num(Math.round(ref.p10)),
                p90: num(Math.round(ref.p90))
            }) : tr('No defensible completed-sale price range');
        const roles = role.focus.length && iv
            ? role.focus.map(name => name.toUpperCase() + ' ' +
                (iv[{hp:0,atk:1,def:2,spAtk:3,spDef:4,speed:5}[name]] ?? '?')).join(' · ')
            : tr('Relevant IVs unknown');
        const preview = pokemonRulePreview(listing, currency);
        const ruleLabel = preview.length ? preview.map(row =>
            tr(row.kind === 'shiny' ? 'Shiny Pokémon' : row.kind === 'p5' ? 'P5 Pokémon' : 'Any Pokémon') +
            ': ' + tr(row.status) + ' (' + num(row.buyMax) + ')').join(' · ')
            : tr('No matching configured Pokémon rule');
        const age = Date.now() - observedAt;
        const status = Number.isFinite(age) && age >= 0 && age <= QUOTE_MAX_AGE_MS
            ? tr('Recent listing observation') : tr('Stale listing observation');
        const missing = facts.missing.length ? facts.missing.join(', ') : tr('None');
        const limitation = ref?.limitations?.length ? ref.limitations.join(', ') :
            tr('No verified completed-sale reference');
        const percent = ref && ref.value > 0 && Number.isFinite(price)
            ? tr('Asking/reference ratio: {percent}%', {
                percent: (100 * price / ref.value).toFixed(1)
            }) : tr('Asking/reference ratio unavailable');
        return '<article class="moth-mw-evidence-card"><h5>' +
            escapeHtml(pokemonListingName(listing?.ficha)) + '</h5>' +
            '<div class="moth-mw-evidence-meta"><b>' +
            (Number.isSafeInteger(price) && price > 0 ? money(price, currency) :
                escapeHtml(tr('Price unverified'))) + '</b> · ' + escapeHtml(status) + '</div>' +
            '<p>' + escapeHtml('N=' + (facts.score == null ? '?' : facts.score.toFixed(3)) +
                ' · P' + (facts.potency ?? '?') + ' · Q=' +
                (facts.quality == null ? '?' : facts.quality.toFixed(3)) +
                ' · IV ' + (iv ? iv.reduce((a,b)=>a+b,0) + '/192' : '?') +
                ' · ' + (facts.form == null ? tr('Form unknown') : 'Form ' + facts.form)) + '</p>' +
            '<p>' + escapeHtml(tr('Role: {role} ({source})', {
                role: tr(role.role), source: tr(role.source)
            })) + ' · ' + roles + '</p>' +
            '<p>' + escapeHtml(tr('Collectibles: {flags}', {
                flags: flags.length ? flags.join(', ') : tr('No confirmed flags')
            })) + (unverifiedExtras ? ' · ' + escapeHtml(tr('Other collectible flags unverified')) : '') + '</p>' +
            '<p><b>' + escapeHtml(sourceLabel) + '</b> · ' + escapeHtml(dateLabel) + '</p>' +
            '<p>' + escapeHtml(priceLabel) + ' · ' + escapeHtml(percent) + '</p>' +
            '<p>' + escapeHtml(tr('Comparison: {stage}', {
                stage: ref?.comparison ? tr(ref.comparison) : tr('None')
            })) + ' · ' + escapeHtml(tr('Limits: {details}', { details: limitation })) + '</p>' +
            '<p>' + escapeHtml(tr('Missing listing fields: {fields}', { fields: missing })) + '</p>' +
            '<p class="moth-mw-rule-hint">' + escapeHtml(tr('Rule preview (not permission): {preview}', {
                preview: ruleLabel
            })) + '</p></article>';
    }

    function renderPokemonPriceEvidence() {
        const offers = [];
        for (const currency of ['gold', 'orb']) {
            const record = state.pokemonAutoOffers.get(currency);
            if (!record || !Array.isArray(record.offers)) continue;
            for (const offer of record.offers.slice(0, 50)) {
                if (offer?.ficha) offers.push({ currency, offer, updatedAt: record.updatedAt });
            }
        }
        if (!offers.length) return '<div class="moth-mw-empty">' +
            escapeHtml(tr('No sampled Pokémon listings yet. Activate Pokémon Watch or scan now.')) +
            '</div>';
        return '<p class="moth-mw-evidence-intro">' +
            escapeHtml(tr('This is a bounded market sample, not every listing. Completed-sale evidence cannot authorize a purchase.')) +
            '</p>' + offers.slice(0, 60).map(({currency, offer, updatedAt}) =>
            pokemonEvidenceCard(offer, currency, updatedAt)).join('');
    }

    function renderCandidate(candidate) {
        const discount = Math.max(0, 1 - candidate.ratio);
        const retainedSeconds = candidate.retainedUntil > serverNow() ? Math.ceil((candidate.retainedUntil - serverNow()) / 1000) : 0;
        const attemptedUntil = Number(state.attemptedListings.get(candidate.listingId) || 0);
        const recentlyAttempted = attemptedUntil > Date.now();
        const canBuy = !state.pendingBuy && !config.purchasesPaused &&
            !unverifiedOrdersExist() && !recentlyAttempted && !retainedSeconds &&
            purchaseQuantity(candidate) > 0;
        const total = candidate.kind === 'item' || candidate.kind === 'diamond' ? candidate.price * candidate.qty : candidate.price;
        const pokemonIvs = candidate.kind === 'pokemon' ? pokemonIVs(candidate.ficha) : null;
        let referenceLabel;
        if (candidate.kind === 'item') {
            if (candidate.referenceSource === 'active-median') {
                referenceLabel = tr('Current market median · {count} listings', { count: num(candidate.activeReferenceListings) });
                if (candidate.serverAverage > candidate.average) referenceLabel += tr(' · server 7d avg {value} ignored', { value: num(Math.round(candidate.serverAverage)) });
            } else if (candidate.average > 0) {
                referenceLabel = tr(candidate.referenceSource === 'live-7d' ? 'live 7d avg / unit' : 'frozen fallback / unit') +
                    ' · ' + tr(candidate.samples === 1 ? '1 unit sold' : '{count} units sold', { count: num(candidate.samples) });
            } else referenceLabel = tr('no sale-price reference');
        } else if (candidate.kind === 'diamond') {
            referenceLabel = candidate.average > 0
                ? tr(candidate.referenceSource === 'active-median' ? 'active market median' : 'completed-sale reference') + ' · ' +
                    tr(candidate.samples === 1 ? '1 sale' : '{count} sales', { count: num(candidate.samples) })
                : tr('no completed-sale reference');
        } else referenceLabel = tr('comparable completed sales · {count}', { count: num(candidate.samples) }) +
            ' · ' + tr(candidate.pokemonValuation?.comparison || 'Broad species history only');

        const kind = candidate.kind === 'pokemon' ? tr('Pokémon') : candidate.kind === 'diamond' ? tr('Diamonds') : tr('Items');
        const quantityLabel = candidate.kind === 'diamond' ? tr('diamonds') : tr('units');
        const availableLabel = retainedSeconds ? tr('retained · {seconds}s', { seconds: retainedSeconds }) : tr('available');
        const buyLabel = config.purchasesPaused ? tr('Purchases paused') :
            unverifiedOrdersExist() ? tr('Unknown purchase outcome') :
            state.pendingBuy?.candidateKey === candidate.key ? tr('Buying…') :
            retainedSeconds ? tr('Wait') : recentlyAttempted ? tr('Tried recently') : tr('Buy');
        return '<div class="moth-mw-row">' +
            '<div class="moth-mw-name"><b><span class="moth-mw-kind">' + escapeHtml(kind) + '</span>' + escapeHtml(candidate.name) + '</b><span>' +
            ((candidate.kind === 'item' || candidate.kind === 'diamond')
                ? num(candidate.qty) + ' ' + escapeHtml(quantityLabel) + ' · ' + escapeHtml(tr('total')) + ' ' + num(total)
                : escapeHtml(tr('N={grade} · Q={quality} · {confidence} confidence', {
                    grade: pokemonScore(candidate.ficha) == null ? '?' : pokemonScore(candidate.ficha).toFixed(3),
                    quality: pokemonQuality(candidate.ficha) == null ? '?' : pokemonQuality(candidate.ficha).toFixed(3),
                    confidence: tr(candidate.pokemonValuation?.confidence || 'low')
                })) + ' · ' + escapeHtml(tr('sold-price middle range {low}–{high}', {
                    low: num(Math.round(candidate.pokemonValuation?.low || 0)),
                    high: num(Math.round(candidate.pokemonValuation?.high || 0))
                })) + (candidate.pokemonValuation?.missingIVs ? ' · ' + escapeHtml(tr('IV details unavailable')) : ''))
            + (pokemonIvs ? ' · ' + escapeHtml(tr('IV {total}/192 · ATK {atk} · Sp.Atk {spAtk} · Speed {speed}', {
                total: pokemonIvs.reduce((sum, iv) => sum + iv, 0),
                atk: pokemonIvs[1], spAtk: pokemonIvs[3], speed: pokemonIvs[5]
            })) : '')
            + '</span></div>' +
            '<div><div>' + money(candidate.price, candidate.currency) + '</div><div class="moth-mw-meta">' + escapeHtml(tr('listed')) +
            ((candidate.kind === 'item' || candidate.kind === 'diamond') && candidate.qty > 1 ? escapeHtml(tr(' / unit')) : '') + '</div></div>' +
            '<div class="moth-mw-ref"><div>' + money(Math.round(candidate.average), candidate.currency) + '</div><div class="moth-mw-meta">' + escapeHtml(referenceLabel) + '</div></div>' +
            '<div><div class="moth-mw-discount">−' + pct(discount) + '</div><div class="moth-mw-meta">' + escapeHtml(tr('watch range')) + '</div></div>' +
            '<div class="moth-mw-seller"><b>' + escapeHtml(tr('Seller: {seller}', { seller: candidate.seller })) + '</b><div class="moth-mw-meta">' + escapeHtml(availableLabel) + '</div></div>' +
            '<button type="button" class="moth-mw-btn primary" data-moth-buy="' + escapeHtml(candidate.key) + '"' + (canBuy ? '' : ' disabled') + '>' +
            escapeHtml(buyLabel) + '</button></div>';
    }

    function updateCandidateRows(list, candidates) {
        if (!list) return;

        if (!candidates.length) {
            const empty = '<div class="moth-mw-empty">' +
                escapeHtml(tr('No matching opportunities. Try a wider watch threshold or inspect Market inventory.')) +
                '</div>';
            if (list.children.length !== 1 || !list.firstElementChild.classList.contains('moth-mw-empty') ||
                list.firstElementChild.outerHTML !== empty) {
                list.innerHTML = empty;
            }
            return;
        }

        const existing = new Map();
        for (const row of Array.from(list.children)) {
            const button = row.querySelector('[data-moth-buy]');
            const key = button?.dataset?.mothBuy;
            if (key && !existing.has(key)) {
                existing.set(key, row);
            } else {
                row.remove();
            }
        }

        for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];
            const html = renderCandidate(candidate);
            const template = document.createElement('template');
            template.innerHTML = html.trim();
            const fresh = template.content.firstElementChild;
            if (!fresh) continue;

            let row = existing.get(candidate.key);
            if (!row) {
                row = fresh;
            } else {
                // Patch a row in place. In particular, preserve the Buy button
                // element/focus while its state changes to "Buying…" or "Tried recently".
                row.className = fresh.className;
                const oldChildren = Array.from(row.children);
                const newChildren = Array.from(fresh.children);
                if (oldChildren.length !== newChildren.length) {
                    row.innerHTML = fresh.innerHTML;
                } else {
                    for (let childIndex = 0; childIndex < oldChildren.length; childIndex += 1) {
                        const oldChild = oldChildren[childIndex];
                        const newChild = newChildren[childIndex];
                        if (oldChild.matches('[data-moth-buy]') && newChild.matches('[data-moth-buy]')) {
                            oldChild.className = newChild.className;
                            oldChild.disabled = newChild.disabled;
                            oldChild.dataset.mothBuy = newChild.dataset.mothBuy;
                            oldChild.textContent = newChild.textContent;
                            for (const attr of Array.from(oldChild.attributes)) {
                                if (!newChild.hasAttribute(attr.name) && attr.name !== 'data-moth-buy') {
                                    oldChild.removeAttribute(attr.name);
                                }
                            }
                            for (const attr of Array.from(newChild.attributes)) {
                                oldChild.setAttribute(attr.name, attr.value);
                            }
                        } else if (oldChild.innerHTML !== newChild.innerHTML) {
                            oldChild.innerHTML = newChild.innerHTML;
                        }
                    }
                }
            }

            const reference = list.children[index] || null;
            if (row !== reference) list.insertBefore(row, reference);
            existing.delete(candidate.key);
        }

        for (const row of existing.values()) row.remove();
    }

    function candidateVisible(candidate) {
        if (!candidate) return false;

        const currencyFilter = ['gold', 'orb'].includes(config.viewCurrency)
            ? config.viewCurrency
            : 'all';
        const kindFilter = ['item', 'pokemon', 'diamond'].includes(config.viewKind)
            ? config.viewKind
            : 'all';

        if (currencyFilter !== 'all' && candidate.currency !== currencyFilter) return false;
        if (kindFilter !== 'all' && candidate.kind !== kindFilter) return false;
        return true;
    }

    function candidateSort(a, b) {
        const mode = [
            'discount',
            'newest',
            'price-asc',
            'price-desc',
            'reference-desc',
            'quantity-desc',
            'name'
        ].includes(config.viewSort)
            ? config.viewSort
            : 'discount';

        /*
         * Raw Coin and Gem amounts are not comparable. For value-based sorts
         * with both currencies visible, keep currencies grouped first.
         */
        const currencyGroup = a.currency === b.currency
            ? 0
            : a.currency === 'gold' ? -1 : 1;

        if (mode === 'newest') {
            return Number(b.firstSeenAt || b.seenAt || 0) - Number(a.firstSeenAt || a.seenAt || 0) ||
                a.name.localeCompare(b.name);
        }
        if (mode === 'price-asc') {
            return currencyGroup || Number(a.price || 0) - Number(b.price || 0) ||
                a.name.localeCompare(b.name);
        }
        if (mode === 'price-desc') {
            return currencyGroup || Number(b.price || 0) - Number(a.price || 0) ||
                a.name.localeCompare(b.name);
        }
        if (mode === 'reference-desc') {
            return currencyGroup || Number(b.average || 0) - Number(a.average || 0) ||
                a.name.localeCompare(b.name);
        }
        if (mode === 'quantity-desc') {
            return Number(b.qty || 0) - Number(a.qty || 0) ||
                a.ratio - b.ratio ||
                a.name.localeCompare(b.name);
        }
        if (mode === 'name') {
            return a.name.localeCompare(b.name) ||
                a.ratio - b.ratio;
        }

        return a.ratio - b.ratio ||
            Number(b.qty || 0) - Number(a.qty || 0) ||
            a.name.localeCompare(b.name);
    }

    function sortSelect() {
        const options = [
            ['discount', 'Biggest discount'], ['newest', 'Newest detected'], ['price-asc', 'Price: low → high'],
            ['price-desc', 'Price: high → low'], ['reference-desc', 'Reference: high → low'],
            ['quantity-desc', 'Quantity: high → low'], ['name', 'Name: A → Z']
        ];
        return '<label class="moth-mw-sort"><span class="moth-mw-filter-label">' + escapeHtml(tr('Sort')) + '</span><select id="moth-mw-sort">' +
            options.map(([value, label]) => '<option value="' + value + '"' + (config.viewSort === value ? ' selected' : '') + '>' +
                escapeHtml(tr(label)) + '</option>').join('') + '</select></label>';
    }
    function filterButton(label, group, value, active, icon) {
        return '<button type="button" class="moth-mw-filter' + (active ? ' on' : '') + '"' +
            ' data-moth-filter="' + escapeHtml(group) + '" data-moth-value="' + escapeHtml(value) + '"' +
            ' aria-pressed="' + (active ? 'true' : 'false') + '">' +
            (icon ? '<img src="' + escapeHtml(icon) + '" alt="">' : '') + escapeHtml(tr(label)) + '</button>';
    }



    function setAutomationNotice(text, kind = 'info') {
        state.automationNotice = { text: String(text || ''), kind, at: Date.now() };
        queueRender();
        setTimeout(() => {
            if (state.automationNotice && Date.now() - state.automationNotice.at >= 4200) {
                state.automationNotice = null;
                queueRender();
            }
        }, 4300);
    }

    function automationNoticeHtml() {
        const n = state.automationNotice;
        if (!n?.text) return '<div class="moth-mw-rule-notice" id="moth-mw-rule-notice" hidden></div>';
        return '<div class="moth-mw-rule-notice ' + escapeHtml(n.kind || 'info') +
            '" id="moth-mw-rule-notice" role="status">' + escapeHtml(n.text) + '</div>';
    }

    function fixedAutomationActiveCount() {
        if (!config.enabled || !config.fixedRulesEnabled) return 0;
        return sanitizeFixedItemRules(config.fixedItemRules)
            .filter(rule => rule.buyEnabled && rule.buyMax > 0).length +
            activeAnyItemRules().length + activePokemonRules().length;
    }

    function automationOverviewSummary() {
        const status = config.purchasesPaused ? 'Purchases paused'
            : fixedAutomationActiveCount() ? 'ON' : 'OFF';
        return tr('Rule-based buying: {status}', { status: tr(status) });
    }

    function automationStatusPanelHtml() {
        const active = fixedAutomationActiveCount();
        const unknown = (state.orderJournal?.orders || []).filter(o => o.status === 'unknown').length;
        const sessCoins = orderExposure('session', 'gold').spent;
        const sessGems = orderExposure('session', 'orb').spent;
        const dayCoins = orderExposure('day', 'gold').spent;
        const dayGems = orderExposure('day', 'orb').spent;
        return '<section class="moth-mw-automation-status" id="moth-mw-automation-status">' +
            '<div class="moth-mw-section-title"><h4>' + escapeHtml(tr('Rule-based buying')) + '</h4><span>' +
            escapeHtml(active ? tr(active === 1 ? '{count} active rule' : '{count} active rules', { count: num(active) }) :
                tr('No automatic purchases enabled.')) + '</span></div>' +
            '<p class="moth-mw-rule-hint">' +
            escapeHtml(tr('Enable rule-based buying and at least one Buy rule with a maximum unit price. No other buying switches are required. Coin/Gem reserves and per-purchase caps still apply.')) +
            '</p><p class="moth-mw-rule-hint">' + escapeHtml(tr('Session exposure: {gold} Coins · {orb} Gems', { gold: num(sessCoins), orb: num(sessGems) })) +
            ' · ' + escapeHtml(tr('Daily exposure: {gold} Coins · {orb} Gems', { gold: num(dayCoins), orb: num(dayGems) })) +
            '</p>' + (unknown ? '<p class="moth-mw-budget-warning">' + escapeHtml(tr('Unverified orders: {count}', { count: num(unknown) })) +
            ' · ' + escapeHtml(tr('A purchase may remain unverified after timeout or restart. Never retry that listing until authoritative reconciliation.')) + '</p>' : '') +
            '</section>';
    }

    function refreshAutomationLive(content) {
        if (!content) return;
        const statusHost = q('#moth-mw-automation-status', content);
        if (statusHost) {
            const tpl = document.createElement('template');
            tpl.innerHTML = automationStatusPanelHtml().trim();
            const fresh = tpl.content.firstElementChild;
            if (fresh && statusHost.innerHTML !== fresh.innerHTML) statusHost.innerHTML = fresh.innerHTML;
        }
        const fixed = new Map(sanitizeFixedItemRules(config.fixedItemRules).map(r => [r.id, r]));
        const broad = new Map(sanitizeAnyItemRules(config.anyItemRules).map(r => [r.id, r]));
        const pokemon = new Map(sanitizePokemonBuyRules(config.pokemonBuyRules).map(r => [r.id, r]));
        for (const node of qa('[data-moth-rule-status]', content)) {
            const type = node.dataset.ruleType, id = node.dataset.ruleId;
            const rule = type === 'fixed' ? fixed.get(id) : type === 'any' ? broad.get(id) : pokemon.get(id);
            if (!rule) continue;
            const next = type === 'fixed' ? fixedRuleStatus(rule) : categoryRuleStatus(rule, type);
            if (node.textContent !== next) node.textContent = next;
        }
        const host = q('#moth-mw-rule-notice', content), n = state.automationNotice;
        if (host) {
            if (!n?.text) {
                host.hidden = true; host.textContent = ''; host.className = 'moth-mw-rule-notice';
            } else {
                host.hidden = false; host.className = 'moth-mw-rule-notice ' + (n.kind || 'info'); host.textContent = n.text;
            }
        }
    }

    function filterAutomationItemSelect(input, select) {
        if (!input || !select) return;
        const term = normalize(input.value);
        let first = null;
        for (const option of Array.from(select.options)) {
            const visible = !term || normalize(option.textContent).includes(term);
            option.hidden = !visible;
            if (visible && !first && option.value) first = option;
        }
        if (select.selectedOptions?.[0]?.hidden && first) select.value = first.value;
    }

    function newAutomationRuleId(prefix) {
        return prefix + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 100000).toString(36);
    }

    function automationItemIds() {
        const ids = new Set();
        for (const id of state.catalog.keys()) if (Number(id) > 0) ids.add(Number(id));
        for (const id of Object.keys(state.itemSummary || {})) if (Number(id) > 0) ids.add(Number(id));
        return Array.from(ids).sort((a, b) => catalogName(a).localeCompare(catalogName(b), currentLocale()));
    }

    function automationItemOptions(selected = 0) {
        const ids = automationItemIds();
        if (!ids.length) return '<option value="">' + escapeHtml(tr('Market catalog is not loaded yet.')) + '</option>';
        return ids.map(itemId =>
            '<option value="' + itemId + '"' + (Number(selected) === itemId ? ' selected' : '') + '>' +
            escapeHtml(catalogName(itemId)) + '</option>'
        ).join('');
    }

    function fixedRuleStatus(rule) {
        if (config.purchasesPaused) return tr('Purchases paused');
        if (unverifiedOrdersExist()) return tr('Unknown purchase outcome');
        if (state.pendingBuy) return tr('Waiting for acknowledgement');
        if (remainingBudget(rule.currency, rule.id).spend < 1) return tr('Budget blocked');
        if (!rule.buyEnabled || !(rule.buyMax > 0)) return tr('Rule paused');
        if (!config.enabled) return tr('Moth Watch disabled');
        if (!config.fixedRulesEnabled) return tr('Enable rule-based buying above');
        if (!state.socket || state.socket.readyState !== 1 || gameIsLoading()) return tr('Waiting for game connection');
        const spendable = Math.max(0, balanceFor(rule.currency) - reserveFor(rule.currency));
        if (spendable < 1) return tr('Insufficient spendable balance');
        const detail = state.itemOfferDetails.get(String(rule.itemId) + ':' + rule.currency);
        if (!detail || Date.now() - Number(detail.updatedAt || 0) > 45000) return tr('Checking listings…');
        const candidate = fixedRuleCandidate(rule);
        if (candidate && purchaseQuantity(candidate) > 0) return tr('Eligible listing available');
        if (candidate) return tr('Insufficient spendable balance');
        return tr('Monitoring · no eligible listing');
    }

    function ruleNumber(label, attrs, value, min = 0) {
        return `<label class="moth-mw-rule-field"><span>${escapeHtml(tr(label))}</span><input type="number" inputmode="numeric" min="${min}" step="1" value="${escapeHtml(String(value))}" ${attrs}></label>`;
    }

    function ruleCurrency(attrs, currency) {
        return `<label class="moth-mw-rule-field"><span>${escapeHtml(tr('Currency'))}</span><select ${attrs}>
            <option value="gold"${currency === 'gold' ? ' selected' : ''}>${escapeHtml(tr('Coins'))}</option>
            <option value="orb"${currency === 'orb' ? ' selected' : ''}>${escapeHtml(tr('Gems'))}</option>
        </select></label>`;
    }

    function ruleCapsHtml(type, rule) {
        const id = escapeHtml(rule.id);
        const field = name => 'data-moth-' + type + '-field="' + name + '" data-rule-id="' + id + '"';
        return '<details class="moth-mw-rule-caps"><summary>' + escapeHtml(tr('Rule cumulative limits')) + '</summary>' +
            '<p class="moth-mw-rule-hint">' + escapeHtml(tr('Spend cap is for the selected rule currency. 0 means unlimited.')) + '</p>' +
            ruleNumber('Session spend cap', field('maxSpendSession'), rule.maxSpendSession || 0) +
            ruleNumber('Daily spend cap (UTC)', field('maxSpendDay'), rule.maxSpendDay || 0) +
            ruleNumber('Purchases per session', field('maxPurchasesSession'), rule.maxPurchasesSession || 0) +
            ruleNumber('Units per session', field('maxQuantitySession'), rule.maxQuantitySession || 0) +
            '</details>';
    }

    function ruleSwitch(label, attrs, checked) {
        return `<label class="moth-mw-switch moth-mw-rule-toggle"><input type="checkbox" ${attrs}${checked ? ' checked' : ''}><span>${escapeHtml(tr(label))}</span></label>`;
    }

    function fixedRulesHtml() {
        const rules = sanitizeFixedItemRules(config.fixedItemRules);
        const cards = rules.map(rule => {
            const id = escapeHtml(rule.id);
            return `<article class="moth-mw-rule-card fixed" data-moth-fixed-row="${id}">
                <div class="moth-mw-rule-card-head">
                    <div class="moth-mw-rule-title"><b>${escapeHtml(catalogName(rule.itemId))}</b>
                        <small data-moth-rule-status data-rule-type="fixed" data-rule-id="${id}">${escapeHtml(fixedRuleStatus(rule))}</small>
                    </div>
                    ${ruleCurrency(`data-moth-fixed-field="currency" data-rule-id="${id}"`, rule.currency)}
                </div>
                <div class="moth-mw-rule-compose">
                    <section class="moth-mw-rule-side buy">
                        <div class="moth-mw-rule-side-head">${ruleSwitch('Buy', `data-moth-fixed-field="buyEnabled" data-rule-id="${id}"`, rule.buyEnabled)}</div>
                        ${ruleNumber('Buy at or below', `data-moth-fixed-field="buyMax" data-rule-id="${id}"`, rule.buyMax)}
                        ${ruleCapsHtml('fixed', rule)}
                        <p class="moth-mw-rule-hint">${escapeHtml(tr('Buy every available unit affordable within reserves and purchase limits.'))}</p>
                    </section>
                </div>
                <div class="moth-mw-rule-card-foot">
                    <span class="moth-mw-rule-note">${escapeHtml(tr('Price per unit'))}</span>
                    <button type="button" class="moth-mw-btn danger" data-moth-remove-fixed="${id}">${escapeHtml(tr('Remove'))}</button>
                </div>
            </article>`;
        }).join('');
        return `<section class="moth-mw-automation-block primary">
            <div class="moth-mw-block-heading"><h4>${escapeHtml(tr('Fixed item rules'))}</h4>
                <p>${escapeHtml(tr('Set an item and its maximum unit price, for example Cocoon Stone at 30,000 Coins. Only matching offers can be purchased.'))}</p>
            </div>
            <div class="moth-mw-master-row">${configField('Enable rule-based buying', 'fixedRulesEnabled', 'checkbox')}</div>
            <div class="moth-mw-rule-add-card">
                <h5>${escapeHtml(tr('Create a fixed rule'))}</h5>
                <div class="moth-mw-rule-add-search">
                    <label class="moth-mw-rule-field"><span>${escapeHtml(tr('Find item'))}</span>
                        <input type="search" id="moth-fixed-search" placeholder="${escapeHtml(tr('Search items…'))}"></label>
                    <label class="moth-mw-rule-field"><span>${escapeHtml(tr('Item'))}</span><select id="moth-fixed-item">${automationItemOptions()}</select></label>
                    ${ruleCurrency('id="moth-fixed-currency"', 'gold')}
                </div>
                <div class="moth-mw-rule-compose">
                    <section class="moth-mw-rule-side buy">
                        <h6>${escapeHtml(tr('Buy'))}</h6>
                        ${ruleNumber('Buy at or below', 'id="moth-fixed-buy"', 0)}
                        <p class="moth-mw-rule-hint">${escapeHtml(tr('Buy every available unit affordable within reserves and purchase limits.'))}</p>
                    </section>
                </div>
                <p class="moth-mw-rule-hint">${escapeHtml(tr('Only a positive buy price activates a rule.'))}</p>
                <div class="moth-mw-rule-add-actions">
                    <span>${escapeHtml(tr('Adding a rule does not turn on rule-based buying; enable the switch above.'))}</span>
                    <button type="button" class="moth-mw-btn primary" id="moth-add-fixed-rule">${escapeHtml(tr('Add fixed rule'))}</button>
                </div>
            </div>
            <h5 class="moth-mw-rule-list-title">${escapeHtml(tr('Configured rules'))} (${rules.length})</h5>
            <div class="moth-mw-rule-list">${cards || `<div class="moth-mw-empty">${escapeHtml(tr('No fixed item rules configured.'))}</div>`}</div>
        </section>`;
    }


    function categoryRuleStatus(rule, type) {
        if (config.purchasesPaused) return tr('Purchases paused');
        if (unverifiedOrdersExist()) return tr('Unknown purchase outcome');
        if (state.pendingBuy) return tr('Waiting for acknowledgement');
        if (remainingBudget(rule.currency, rule.id).spend < 1) return tr('Budget blocked');
        if (!rule.buyEnabled || !(rule.buyMax > 0)) return tr('Rule paused');
        if (!config.enabled) return tr('Moth Watch disabled');
        if (!config.fixedRulesEnabled) return tr('Enable rule-based buying above');
        if (!state.socket || state.socket.readyState !== 1 || gameIsLoading()) return tr('Waiting for game connection');
        if (balanceFor(rule.currency) - reserveFor(rule.currency) < 1) return tr('Insufficient spendable balance');
        if (type === 'any') {
            const candidate = anyItemRuleCandidate(rule, anyItemRuleTargets([rule]));
            return tr(candidate && purchaseQuantity(candidate) > 0 ? 'Eligible listing available' : 'Checking listings…');
        }
        const candidate = pokemonRuleCandidate(rule);
        return tr(candidate && purchaseQuantity(candidate) > 0 ? 'Eligible listing available' : 'Monitoring · no eligible listing');
    }

    function categoryRulesHtml(type) {
        const pokemon = type === 'pokemon';
        const rules = pokemon
            ? sanitizePokemonBuyRules(config.pokemonBuyRules)
            : sanitizeAnyItemRules(config.anyItemRules);
        const names = {any: 'Any Pokémon', shiny: 'Shiny Pokémon', p5: 'P5 Pokémon'};
        const cards = rules.map(rule => {
            const id = escapeHtml(rule.id);
            const title = pokemon ? names[rule.kind] : 'Any item';
            return '<article class="moth-mw-rule-card fixed"><div class="moth-mw-rule-card-head">' +
                '<div class="moth-mw-rule-title"><b>' + escapeHtml(tr(title)) + '</b>' +
                '<small data-moth-rule-status data-rule-type="' + type + '" data-rule-id="' + id + '">' +
                escapeHtml(categoryRuleStatus(rule, type)) + '</small></div></div>' +
                '<div class="moth-mw-rule-compose"><section class="moth-mw-rule-side buy">' +
                ruleSwitch('Buy', 'data-moth-' + type + '-field="buyEnabled" data-rule-id="' + id + '"', rule.buyEnabled) +
                ruleNumber('Buy at or below', 'data-moth-' + type + '-field="buyMax" data-rule-id="' + id + '"', rule.buyMax) +
                ruleCurrency('data-moth-' + type + '-field="currency" data-rule-id="' + id + '"', rule.currency) +
                ruleCapsHtml(type, rule) +
                '</section></div><div class="moth-mw-rule-card-foot"><span>' +
                escapeHtml(tr(pokemon ? 'Price per Pokémon' : 'Price per unit')) +
                '</span><button type="button" class="moth-mw-btn danger" data-moth-remove-' + type + '="' + id + '">' +
                escapeHtml(tr('Remove')) + '</button></div></article>';
        }).join('');
        const label = pokemon ? 'Pokémon purchase rules' : 'Any item rules';
        const help = pokemon
            ? 'These rules scan the first market page per currency. Shiny requires Gems.'
            : 'Any-item rules inspect current offers selectively; large catalogs can take time.';
        const controls = pokemon ? '<label class="moth-mw-rule-field"><span>' +
            escapeHtml(tr('Pokémon category')) + '</span><select id="moth-pokemon-kind">' +
            '<option value="any">' + escapeHtml(tr('Any Pokémon')) + '</option>' +
            '<option value="shiny">' + escapeHtml(tr('Shiny Pokémon')) + '</option>' +
            '<option value="p5">' + escapeHtml(tr('P5 Pokémon')) + '</option></select></label>' : '';
        return '<section class="moth-mw-automation-block"><div class="moth-mw-block-heading"><h4>' +
            escapeHtml(tr(label)) + '</h4><p>' + escapeHtml(tr(help)) +
            '</p></div><div class="moth-mw-rule-add-card"><h5>' +
            escapeHtml(tr(pokemon ? 'Add Pokémon rule' : 'Add any-item rule')) +
            '</h5><div class="moth-mw-rule-add-search">' + controls +
            ruleCurrency('id="moth-' + type + '-currency"', 'gold') +
            ruleNumber('Buy at or below', 'id="moth-' + type + '-buy"', 0) +
            '</div><p class="moth-mw-rule-hint">' +
            escapeHtml(tr(pokemon
                ? 'Buy matching Pokémon at or below the listed price; no valuation reference required.'
                : 'Buy any item at or below this price per unit.')) +
            '</p><button type="button" class="moth-mw-btn primary" id="moth-add-' + type + '-rule">' +
            escapeHtml(tr(pokemon ? 'Add Pokémon rule' : 'Add any-item rule')) +
            '</button></div><h5 class="moth-mw-rule-list-title">' +
            escapeHtml(tr('Configured rules')) + ' (' + rules.length + ')</h5>' +
            '<div class="moth-mw-rule-list">' +
            (cards || '<div class="moth-mw-empty">' +
                escapeHtml(tr(pokemon ? 'No Pokémon rules configured.' : 'No any-item rules configured.')) +
                '</div>') + '</div></section>';
    }

    function renderWatch(forceViewBuild = false) {
        const panel = q('#moth-market-watch-panel');
        if (!panel || !state.watchOpen) return;
        const locale = currentLocale();
        if (state.lastLocale !== locale) {
            state.lastLocale = locale;
            if (panel.dataset.mothWatchShell) delete panel.dataset.mothWatchShell;
            forceViewBuild = true;
        }
        const views = ['opportunities', 'inventory', 'pricing', 'automation', 'activity'];
        if (!views.includes(state.watchView)) state.watchView = 'opportunities';

        if (!panel.dataset.mothWatchShell) {
            panel.innerHTML =
                '<div class="moth-mw-head"><div><h3>Moth Watch</h3><span class="moth-mw-status" id="moth-mw-status"></span></div>' +
                '<span class="moth-mw-spacer"></span><button type="button" class="moth-mw-btn" id="moth-mw-scan">' + escapeHtml(tr('Scan now')) + '</button></div>' +
                '<div class="moth-mw-overview" id="moth-mw-overview"></div>' +
                '<nav class="moth-mw-tabs" aria-label="' + escapeHtml(tr('Moth Watch views')) + '">' +
                '<button type="button" class="moth-mw-tab" data-moth-view="opportunities">' + escapeHtml(tr('Opportunities')) + '</button>' +
                '<button type="button" class="moth-mw-tab" data-moth-view="inventory">' + escapeHtml(tr('Market inventory')) + '</button>' +
                '<button type="button" class="moth-mw-tab" data-moth-view="pricing">' + escapeHtml(tr('Pokémon price evidence')) + '</button>' +
                '<button type="button" class="moth-mw-tab" data-moth-view="automation">' + escapeHtml(tr('Automation & budget')) + '</button>' +
                '<button type="button" class="moth-mw-tab" data-moth-view="activity">' + escapeHtml(tr('Activity & references')) + '</button></nav>' +
                '<div class="moth-mw-workspace"><div id="moth-mw-view-content"></div></div>';
            panel.dataset.mothWatchShell = '1';
            bindWatchEvents(panel);
        }

        const baseline = baselineStats();
        const currencyFilter = ['gold', 'orb'].includes(config.viewCurrency) ? config.viewCurrency : 'all';
        const kindFilter = ['item', 'pokemon', 'diamond'].includes(config.viewKind) ? config.viewKind : 'all';
        const searchTerm = normalize(state.opportunitySearch);
        const candidates = Array.from(state.candidates.values()).filter(c => {
            if (searchTerm && ![c.name, c.seller, c.kind, c.listingId].some(value => normalize(value).includes(searchTerm))) return false;
            const manuallyLoaded = c.kind === 'item' && state.loadedItemKeys.has(String(c.itemId) + ':' + c.currency);
            // Unreferenced diamonds remain inspectable. Referenced diamonds must meet the watch threshold.
            const visibleWithoutReference = manuallyLoaded || (c.kind === 'diamond' && !(Number(c.average) > 0));
            return (visibleWithoutReference || c.ratio <= Math.max(0.01, Number(config.watchPercent) / 100)) && candidateVisible(c);
        }).sort(candidateSort);
        const captured = state.baseline.capturedAt ? new Date(state.baseline.capturedAt).toLocaleString(locale) : tr('no reference captured yet');

        const status = q('#moth-mw-status', panel);
        const statusText = tr('Items: {items} · Pokémon: {pokemon} · Diamonds: {diamonds}', {
            items: displayStatus(state.itemStatus), pokemon: displayStatus(state.pokemonStatus), diamonds: displayStatus(state.diamondStatus)
        });
        if (status && status.textContent !== statusText) status.textContent = statusText;

        const overview = q('#moth-mw-overview', panel);
        const countLabel = tr(candidates.length === 1 ? '1 matching listing' : '{count} matching listings', { count: num(candidates.length) });
        const overviewHtml = '<b>' + escapeHtml(countLabel) + '</b>' +
            '<span>' + num(state.gold) + ' ' + escapeHtml(tr('Coins')) + ' · ' + num(state.orbs) + ' ' + escapeHtml(tr('Gems')) + '</span>' +
            '<span>' + escapeHtml(tr('Watch threshold: {value}% of reference', { value: num(config.watchPercent) })) + '</span>' +
            '<span class="moth-mw-overview-automation">' + escapeHtml(tr('Automation: {summary}', { summary: automationOverviewSummary() })) + '</span>';
        if (overview && overview.innerHTML !== overviewHtml) overview.innerHTML = overviewHtml;

        for (const button of qa('[data-moth-view]', panel)) {
            button.setAttribute('aria-selected', button.dataset.mothView === state.watchView ? 'true' : 'false');
        }

        const content = q('#moth-mw-view-content', panel);
        const viewChanged = content.dataset.view !== state.watchView;
        const settingsSignature = JSON.stringify(Object.keys(DEFAULTS).sort().map(key => [key, config[key]]));
        const settingsChanged = state.watchView === 'automation' && !viewChanged &&
            content.dataset.settingsSignature !== settingsSignature &&
            !(content.contains(document.activeElement) && document.activeElement.matches('input, select, textarea'));
        if (forceViewBuild || viewChanged || settingsChanged) {
            content.dataset.view = state.watchView;
            if (state.watchView === 'opportunities') {
                content.innerHTML =
                    '<div class="moth-mw-filters" id="moth-mw-opportunity-filters">' +
                    '<input type="search" id="moth-mw-search" aria-label="' + escapeHtml(tr('Search listings')) + '" placeholder="' + escapeHtml(tr('Search item, Pokémon, seller…')) + '" value="' + escapeHtml(state.opportunitySearch) + '">' +
                    '<div class="moth-mw-filter-group"><span class="moth-mw-filter-label">' + escapeHtml(tr('Currency')) + '</span>' +
                    filterButton('All', 'currency', 'all', currencyFilter === 'all', '') +
                    filterButton('Coins', 'currency', 'gold', currencyFilter === 'gold', '/assets/site/assets/ui/moeda-ouro.png') +
                    filterButton('Gems', 'currency', 'orb', currencyFilter === 'orb', '/img/moeda-gema.png') + '</div>' +
                    '<div class="moth-mw-filter-group"><span class="moth-mw-filter-label">' + escapeHtml(tr('Type')) + '</span>' +
                    filterButton('All', 'kind', 'all', kindFilter === 'all', '') +
                    filterButton('Items', 'kind', 'item', kindFilter === 'item', '/assets/site/assets/ui/menu-bolsa.png') +
                    filterButton('Pokémon', 'kind', 'pokemon', kindFilter === 'pokemon', '/assets/site/assets/ui/ball-poke.png') +
                    filterButton('Diamonds', 'kind', 'diamond', kindFilter === 'diamond', '/img/moeda-gema.png') + '</div>' +
                    sortSelect() + '</div>' +
                    '<div class="moth-mw-inventory-note">' +
                    escapeHtml(tr('Shiny Pokémon can only be listed for Gems. Old Coin listings are ignored.')) +
                    '</div>' +
                    '<div class="moth-mw-section-title"><h4>' + escapeHtml(tr('Opportunities')) + '</h4><span id="moth-mw-opportunity-count"></span></div>' +
                    '<div class="moth-mw-list" id="moth-mw-opportunity-list"></div>';
            } else if (state.watchView === 'inventory') {
                content.innerHTML = '<div class="moth-mw-section-title"><h4>' + escapeHtml(tr('Market inventory')) + '</h4><span>' +
                    escapeHtml(tr('Browse item types, then load the offers for a selected currency.')) + '</span></div><div id="moth-mw-inventory-content"></div>';
            } else if (state.watchView === 'pricing') {
                content.innerHTML = '<div class="moth-mw-section-title"><h4>' +
                    escapeHtml(tr('Pokémon price evidence')) + '</h4><span>' +
                    escapeHtml(tr('Read-only completed-sale comparisons. No purchase authorization.')) +
                    '</span></div><div id="moth-mw-pricing-list"></div>';
            } else if (state.watchView === 'automation') {
                content.innerHTML =
                    '<div class="moth-mw-section-title"><h4>' + escapeHtml(tr('Automation status')) + '</h4><span>' +
                    escapeHtml(tr('Review the systems that can place market orders, then set spending safeguards and advanced monitoring.')) + '</span></div>' +
                    automationNoticeHtml() + automationStatusPanelHtml() +
                    '<section class="moth-mw-settings-card moth-mw-budget-card"><h4>' + escapeHtml(tr('Spending safeguards')) + '</h4>' +
                    '<p class="moth-mw-budget-warning">' +
                    escapeHtml(tr('Automatic buying may use your entire available balance when reserves and spending limits are set to zero.')) +
                    '</p><div class="moth-mw-config">' +
                    configField('Keep Coins in reserve', 'goldReserve', 'number', '') +
                    configField('Keep Gems in reserve', 'gemReserve', 'number', '') +
                    configField('Maximum Coins per purchase', 'maxCoinsPerBuy', 'number', '0 = no extra cap') +
                    configField('Maximum Gems per purchase', 'maxGemsPerBuy', 'number', '0 = no extra cap') +
                    configField('Maximum Coins per session', 'maxCoinsPerSession', 'number', '0 = unlimited cumulative limit') +
                    configField('Maximum Gems per session', 'maxGemsPerSession', 'number', '0 = unlimited cumulative limit') +
                    configField('Maximum Coins per UTC day', 'maxCoinsPerDay', 'number', '0 = unlimited cumulative limit') +
                    configField('Maximum Gems per UTC day', 'maxGemsPerDay', 'number', '0 = unlimited cumulative limit') +
                    configField('Maximum purchases per session', 'maxPurchasesPerSession', 'number', '0 = unlimited cumulative limit') +
                    configField('Maximum units per session', 'maxQuantityPerSession', 'number', '0 = unlimited cumulative limit') +
                    configField('Pause all purchases (kill switch)', 'purchasesPaused', 'checkbox') +
                    '</div><p class="moth-mw-rule-hint">' + escapeHtml(tr('Includes reserved unverified orders. 0 means unlimited; per-purchase caps are separate.')) +
                    '</p></section>' +
                    fixedRulesHtml() + categoryRulesHtml('any') + categoryRulesHtml('pokemon') +
                    '<details class="moth-mw-advanced"><summary>' + escapeHtml(tr('Advanced monitoring & references')) +
                    '</summary><div class="moth-mw-advanced-body"><p class="moth-mw-advanced-note">' +
                    escapeHtml(tr('Scanning and reference-quality controls. These do not authorize orders by themselves.')) +
                    '</p><div class="moth-mw-settings-grid"><section class="moth-mw-settings-card"><h4>' + escapeHtml(tr('Watch rules')) +
                    '</h4><div class="moth-mw-config">' + configField('Watch price threshold', 'watchPercent', 'range', '%') +
                    configField('Scan interval', 'scanSeconds', 'number', 'seconds') + configField('Watch items', 'scanItems', 'checkbox') +
                    configField('Watch Pokémon', 'scanPokemon', 'checkbox') + configField('Watch diamonds', 'scanDiamonds', 'checkbox') +
                    '</div></section><section class="moth-mw-settings-card"><h4>' + escapeHtml(tr('Reference confidence')) +
                    '</h4><div class="moth-mw-config">' + configField('Minimum sold item units', 'minItemUnits', 'number', '') +
                    configField('Minimum Pokémon sale samples', 'minPokemonSamples', 'number', '') +
                    configField('Pokémon history pages', 'pokemonHistoryPages', 'number', '') +
                    '</div></section></div></div></details>';
            } else {
                content.innerHTML =
                    '<div class="moth-mw-section-title"><h4>' + escapeHtml(tr('Price references')) + '</h4><span>' +
                    escapeHtml(tr('Inspect and refresh reference data used to judge offers.')) + '</span></div>' +
                    '<div class="moth-mw-reference-tools" id="moth-mw-reference-tools"></div>' +
                    '<div class="moth-mw-section-title"><h4>' + escapeHtml(tr('Recent activity')) + '</h4><span>' +
                    escapeHtml(tr('Purchase attempts, confirmations, and errors.')) + '</span></div>' +
                    '<div class="moth-mw-log" id="moth-mw-activity-log"></div>';
            }
            if (state.watchView === 'automation') content.dataset.settingsSignature = settingsSignature;
        }

        if (state.watchView === 'opportunities') {
            const filterHost = q('#moth-mw-opportunity-filters', content);
            for (const button of qa('[data-moth-filter]', filterHost)) {
                const active = (button.dataset.mothFilter === 'currency' ? currencyFilter : kindFilter) === button.dataset.mothValue;
                button.classList.toggle('on', active);
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
            }
            const sort = q('#moth-mw-sort', content);
            if (sort && sort.value !== config.viewSort) sort.value = config.viewSort;
            const count = q('#moth-mw-opportunity-count', content);
            if (count) count.textContent = tr('{count} matching listings · purchases are serialized while awaiting server confirmation', { count: num(candidates.length) });
            const list = q('#moth-mw-opportunity-list', content);
            updateCandidateRows(list, candidates);
        } else if (state.watchView === 'inventory') {
            const host = q('#moth-mw-inventory-content', content);
            const html = renderItemInventory();
            if (host && host.innerHTML !== html) {
                const oldScroller = q('.moth-mw-inventory-list', host);
                const scrollTop = oldScroller ? oldScroller.scrollTop : 0;
                host.innerHTML = html;
                const newScroller = q('.moth-mw-inventory-list', host);
                if (newScroller) newScroller.scrollTop = scrollTop;
            }
        } else if (state.watchView === 'pricing') {
            const host = q('#moth-mw-pricing-list', content);
            const html = renderPokemonPriceEvidence();
            if (host && host.innerHTML !== html) host.innerHTML = html;
        } else if (state.watchView === 'automation') {
            refreshAutomationLive(content);
        } else if (state.watchView === 'activity') {
            const refs = q('#moth-mw-reference-tools', content);
            const html = '<div class="moth-mw-reference-info"><b>' + escapeHtml(tr('Item references:')) + '</b> ' +
                escapeHtml(tr('live server 7-day averages with a saved fallback captured')) + ' ' + escapeHtml(captured) + '. ' +
                num(baseline.items) + escapeHtml(tr(' item types; ')) + num(baseline.gold) + escapeHtml(tr(' Coin references; ')) +
                num(baseline.orb) + escapeHtml(tr(' Gem references.')) + '<br>' + escapeHtml(tr('Suspicious prices: ')) +
                num(state.itemScanStats.goldSuspicious) + '/' + num(state.itemScanStats.goldChecked) + escapeHtml(tr(' Coin · ')) +
                num(state.itemScanStats.orbSuspicious) + '/' + num(state.itemScanStats.orbChecked) + escapeHtml(tr(' Gem.')) + '</div>' +
                '<button type="button" class="moth-mw-btn" id="moth-mw-refresh-baseline">' + escapeHtml(tr('Refresh saved fallback')) + '</button>' +
                '<button type="button" class="moth-mw-btn" id="moth-mw-export-baseline">' + escapeHtml(tr('Copy reference data')) + '</button>';
            if (refs && refs.innerHTML !== html) refs.innerHTML = html;
            const log = q('#moth-mw-activity-log', content);
            const logHtml = state.buyLog.length ? state.buyLog.map(row =>
                '<div>' + new Date(row.at).toLocaleTimeString(currentLocale()) + ' · ' + escapeHtml(translateLog(row.text)) + '</div>').join('') :
                '<div>' + escapeHtml(tr('No purchase attempts recorded this session.')) + '</div>';
            if (log && log.innerHTML !== logHtml) log.innerHTML = logHtml;
        }
    }

    function bindWatchEvents(panel) {
        if (panel.dataset.mothWatchEvents) return;
        panel.dataset.mothWatchEvents = '1';

        panel.addEventListener('click', event => {
            // Keep native market delegated handlers from processing Moth Watch clicks.
            event.stopPropagation();
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            const tab = target.closest('[data-moth-view]');
            if (tab) {
                const view = tab.dataset.mothView;
                if (!['opportunities', 'inventory', 'pricing', 'automation', 'activity'].includes(view)) return;
                state.watchView = view;
                try { localStorage.setItem('moth-pokeidle-market-watch-view-v1', view); } catch {}
                renderWatch(true);
                return;
            }
            if (target.closest('#moth-mw-scan')) { runScan(true); return; }
            if (target.closest('#moth-mw-refresh-baseline')) {
                state.forceBaselineNext = true;
                state.baseline = emptyBaseline();
                saveBaseline();
                requestItemSummary();
                queueRender();
                return;
            }
            if (target.closest('#moth-mw-export-baseline')) {
                void copyText(exportBaselineText()).then(ok => {
                    addLog(ok ? 'Reference data copied to clipboard' : 'Could not copy reference data');
                    queueRender();
                });
                return;
            }

            for (const type of ['any', 'pokemon']) {
                if (!target.closest('#moth-add-' + type + '-rule')) continue;
                const pokemon = type === 'pokemon';
                const kind = pokemon ? q('#moth-pokemon-kind', panel)?.value : null;
                if (pokemon && !['any', 'shiny', 'p5'].includes(kind)) return;
                const currency = q('#moth-' + type + '-currency', panel)?.value === 'orb' ? 'orb' : 'gold';
                if (pokemon && kind === 'shiny' && currency !== 'orb') {
                    setAutomationNotice(tr('Shiny purchases require Gems.'), 'warn');
                    q('#moth-pokemon-currency', panel).value = 'orb'; return;
                }
                const buyMax = Number(q('#moth-' + type + '-buy', panel)?.value);
                if (!Number.isSafeInteger(buyMax) || buyMax <= 0) {
                    setAutomationNotice(tr('Set a positive maximum buy price.'), 'warn'); return;
                }
                const key = pokemon ? 'pokemonBuyRules' : 'anyItemRules';
                const rules = pokemon ? sanitizePokemonBuyRules(config[key]) : sanitizeAnyItemRules(config[key]);
                if (rules.some(r => r.currency === currency && (!pokemon || r.kind === kind))) {
                    setAutomationNotice(tr('An equivalent rule already exists for this currency.'), 'warn'); return;
                }
                const rule = {id: newAutomationRuleId(type), currency, buyMax, buyEnabled: true};
                if (pokemon) rule.kind = kind;
                rules.push(rule);
                config[key] = rules; saveConfig();
                setAutomationNotice(tr(config.fixedRulesEnabled ? 'Rule added: {name}.' :
                    'Rule configured — buying remains off until master switch is enabled.',
                    {name: pokemon ? tr('Pokémon') : tr('Any item')}), 'ok');
                renderWatch(true); return;
            }
            for (const type of ['any', 'pokemon']) {
                const button = target.closest('[data-moth-remove-' + type + ']');
                if (!button) continue;
                const key = type === 'any' ? 'anyItemRules' : 'pokemonBuyRules';
                const id = button.getAttribute('data-moth-remove-' + type);
                config[key] = config[key].filter(rule => rule.id !== id);
                saveConfig(); renderWatch(true); return;
            }
            if (target.closest('#moth-add-fixed-rule')) {
                const itemId = Number(q('#moth-fixed-item', panel)?.value);
                if (!(itemId > 0)) { setAutomationNotice(tr('Choose an item before adding a rule.'), 'warn'); return; }
                const currency = q('#moth-fixed-currency', panel)?.value === 'orb' ? 'orb' : 'gold';
                const buyMax = Math.max(0, Math.floor(Number(q('#moth-fixed-buy', panel)?.value) || 0));
                if (!(buyMax > 0)) {
                    setAutomationNotice(tr('Set a positive maximum buy price.'), 'warn'); return;
                }
                const rules = sanitizeFixedItemRules(config.fixedItemRules), name = catalogName(itemId);
                if (rules.some(r => r.itemId === itemId && r.currency === currency)) {
                    setAutomationNotice(tr('A rule for {name} in this currency already exists.', { name }), 'warn'); return;
                }
                rules.push({ id: newAutomationRuleId('fixed'), itemId, currency, buyEnabled: true, buyMax });
                config.fixedItemRules = rules; saveConfig();
                setAutomationNotice(tr(config.fixedRulesEnabled
                    ? 'Rule added: {name}.' : 'Rule saved: {name}. Turn on rule-based buying to start.', { name }), 'ok');
                renderWatch(true); return;
            }
            const removeFixed = target.closest('[data-moth-remove-fixed]');
            if (removeFixed) {
                const rules = sanitizeFixedItemRules(config.fixedItemRules);
                const removed = rules.find(r => r.id === removeFixed.dataset.mothRemoveFixed);
                config.fixedItemRules = rules.filter(r => r.id !== removeFixed.dataset.mothRemoveFixed);
                saveConfig(); setAutomationNotice(tr('Rule removed: {name}.', { name: removed ? catalogName(removed.itemId) : tr('Item') }), 'ok'); renderWatch(true); return;
            }
            const itemButton = target.closest('[data-moth-item-scan]');
            if (itemButton) {
                const itemId = Number(itemButton.dataset.mothItemScan);
                const currency = itemButton.dataset.mothItemCurrency === 'orb' ? 'orb' : 'gold';
                if (!(itemId > 0)) return;
                const key = String(itemId) + ':' + currency;
                state.selectedItemFocus = { itemId, currency, key };
                state.itemDetailStatus = { key, itemId, currency, status: 'loading', at: Date.now() };
                state.loadedItemKeys.add(key);
                state.lastDetailRequest.delete(key);
                queueItemDetail(itemId, currency);
                state.itemStatus = 'loading ' + catalogName(itemId) + ' offers';
                renderWatch(true);
                return;
            }
            if (target.closest('[data-moth-hide-offers]')) {
                state.selectedItemFocus = null;
                renderWatch(true);
                return;
            }
            const inventoryToggle = target.closest('#moth-mw-inventory-toggle');
            if (inventoryToggle) {
                state.itemInventoryCollapsed = !state.itemInventoryCollapsed;
                try { localStorage.setItem(ITEM_INVENTORY_COLLAPSED_KEY, state.itemInventoryCollapsed ? '1' : '0'); } catch {}
                const body = q('#moth-mw-inventory-body', panel);
                if (body) body.hidden = state.itemInventoryCollapsed;
                inventoryToggle.setAttribute('aria-expanded', state.itemInventoryCollapsed ? 'false' : 'true');
                const chevron = q('.moth-mw-inventory-chevron', inventoryToggle);
                if (chevron) chevron.textContent = state.itemInventoryCollapsed ? '▸' : '▾';
                return;
            }
            const filter = target.closest('[data-moth-filter]');
            if (filter) {
                const group = filter.dataset.mothFilter, value = filter.dataset.mothValue;
                if (group === 'currency' && ['all', 'gold', 'orb'].includes(value)) config.viewCurrency = value;
                else if (group === 'kind' && ['all', 'item', 'pokemon', 'diamond'].includes(value)) config.viewKind = value;
                else return;
                saveConfig();
                renderWatch();
                return;
            }
            const buy = target.closest('[data-moth-buy]');
            if (buy) {
                const candidate = state.candidates.get(buy.dataset.mothBuy);
                if (candidate && !tryBuy(candidate, true)) addLog('Purchase not sent; check balance, reserve, listing availability, and pending purchase status');
                queueRender();
            }
        });

        panel.addEventListener('input', event => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            if (target.matches('#moth-mw-search')) {
                state.opportunitySearch = target.value;
                try { localStorage.setItem('moth-pokeidle-market-watch-search-v1', state.opportunitySearch); } catch {}
                renderWatch();
                return;
            }
            if (target.matches('#moth-fixed-search')) { filterAutomationItemSelect(target, q('#moth-fixed-item', panel)); return; }
            if (target.matches('#moth-pokemon-buy') && Number(target.value) < 0) target.value = '0';

            if (target.matches('input[type="range"][data-moth-cfg]')) {
                const output = q('[data-moth-cfg-value="' + target.dataset.mothCfg + '"]', panel);
                if (output) output.textContent = target.value + '%';
            }
        });

        panel.addEventListener('change', event => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;

            for (const type of ['any', 'pokemon']) {
                const attr = 'data-moth-' + type + '-field';
                if (!target.hasAttribute(attr)) continue;
                const key = type === 'any' ? 'anyItemRules' : 'pokemonBuyRules';
                const sanitize = type === 'any' ? sanitizeAnyItemRules : sanitizePokemonBuyRules;
                const rules = sanitize(config[key]), rule = rules.find(r => r.id === target.dataset.ruleId);
                if (!rule) return;
                const field = target.getAttribute(attr);
                if (['maxSpendSession', 'maxSpendDay', 'maxPurchasesSession', 'maxQuantitySession'].includes(field)) {
                    const cap = Number(target.value);
                    if (!Number.isSafeInteger(cap) || cap < 0) { renderWatch(true); return; }
                    rule[field] = cap;
                } else if (field === 'buyMax') {
                    const max = Number(target.value);
                    if (!Number.isSafeInteger(max) || max <= 0) {
                        setAutomationNotice(tr('Set a positive maximum buy price.'), 'warn');
                        renderWatch(true); return;
                    }
                    rule.buyMax = max;
                } else if (field === 'buyEnabled') rule.buyEnabled = target.checked;
                else if (field === 'currency') {
                    const currency = target.value === 'orb' ? 'orb' : 'gold';
                    if (type === 'pokemon' && rule.kind === 'shiny' && currency !== 'orb') {
                        setAutomationNotice(tr('Shiny purchases require Gems.'), 'warn');
                        renderWatch(true); return;
                    }
                    if (rules.some(r => r.id !== rule.id && r.currency === currency &&
                        (type === 'any' || r.kind === rule.kind))) {
                        setAutomationNotice(tr('An equivalent rule already exists for this currency.'), 'warn');
                        renderWatch(true); return;
                    }
                    rule.currency = currency;
                } else return;
                config[key] = rules; saveConfig(); renderWatch(true); return;
            }
            if (target.matches('#moth-pokemon-kind')) {
                const currency = q('#moth-pokemon-currency', panel);
                if (currency) {
                    const shiny = target.value === 'shiny';
                    if (shiny) currency.value = 'orb';
                    const coin = currency.querySelector('option[value="gold"]');
                    if (coin) coin.disabled = shiny;
                }
                return;
            }
            if (target.matches('[data-moth-fixed-field]')) {
                const id = target.dataset.ruleId;
                const field = target.dataset.mothFixedField;
                const rules = sanitizeFixedItemRules(config.fixedItemRules);
                const rule = rules.find(entry => entry.id === id);
                if (!rule) return;
                if (field === 'currency') rule.currency = target.value === 'orb' ? 'orb' : 'gold';
                else if (field === 'buyEnabled') rule.buyEnabled = target.checked;
                else if (field === 'buyMax') rule.buyMax = Math.max(0, Math.floor(Number(target.value) || 0));
                else if (['maxSpendSession', 'maxSpendDay', 'maxPurchasesSession', 'maxQuantitySession'].includes(field)) {
                    const cap = Number(target.value);
                    if (!Number.isSafeInteger(cap) || cap < 0) { renderWatch(true); return; }
                    rule[field] = cap;
                }
                else return;
                config.fixedItemRules = rules;
                saveConfig();
                queueRender();
                return;
            }
            if (target.matches('[data-moth-cfg]')) {
                const key = target.dataset.mothCfg;
                if (!(key in DEFAULTS)) return;
                config[key] = target.type === 'checkbox' ? target.checked : normalizedConfigValue(key, target.value);
                if (target.matches('input[type="range"]')) {
                    const output = q('[data-moth-cfg-value="' + key + '"]', panel);
                    if (output) output.textContent = config[key] + '%';
                }
                saveConfig();
                if (key === 'fixedRulesEnabled') {
                    if (!config.fixedRulesEnabled) state.ruleItemKeys.clear();
                    else if (!hasAnyBuyingRules()) {
                        setAutomationNotice(tr('Rule-based buying is on, but no Buy rules are active. Create or enable a rule first.'), 'warn');
                    } else {
                        setAutomationNotice(tr('Rule-based buying is on. No other purchase switches are required. Spending safeguards still apply.'), 'ok');
                    }
                }
                if (key === 'pokemonHistoryPages' || key === 'minPokemonSamples') ensurePokemonHistory(true);
                // Spending switches and numeric fields do not need a new market scan.
                // Only changes to scanning conditions should request fresh data.
                if (['scanItems', 'scanPokemon', 'scanDiamonds', 'scanSeconds', 'watchPercent'].includes(key)) {
                    runScan(true);
                }
                queueRender();
                return;
            }
            if (target.matches('#moth-mw-sort')) {
                config.viewSort = target.value;
                saveConfig();
                renderWatch();
            }
        });
    }

    function queueRender() {
        if (state.renderQueued) return;
        state.renderQueued = true;

        /*
         * The watch panel is a fairly large DOM tree. During live-market
         * activity several protocol events can arrive in the same second.
         * Rebuilding the whole panel once per animation frame is enough to
         * starve the game thread, especially with many retained listings.
         *
         * Keep the open panel responsive at a bounded refresh rate while
         * still allowing closed-state UI repair immediately.
         */
        const now = Date.now();
        const minInterval = state.watchOpen ? 250 : 0;
        const elapsed = now - Number(state.lastRenderAt || 0);
        const delay = Math.max(0, minInterval - elapsed);

        setTimeout(() => {
            requestAnimationFrame(() => {
                state.renderQueued = false;
                ensureUi();

                if (state.watchOpen) {
                    state.lastRenderAt = Date.now();
                }

                renderWatch();
            });
        }, delay);
    }

    function openWatch() {
        ensureUi();

        const body =
            q('#modal-corpo') ||
            q('.cm-corpo');

        if (!body) return false;

        state.watchOpen = true;
        body.classList.add('moth-watch-active');

        const button =
            q('#moth-market-watch-tab');

        if (button) button.classList.add('on');
        updateWatchButtonLabel(button);

        /*
         * Paint the UI first. Market/history requests can continue from the
         * normal scan timer without making the button click compete with the
         * initial panel construction.
         */
        renderWatch();
        setTimeout(() => {
            if (state.watchOpen) {
                runScan(true);
            }
        }, 0);
        return true;
    }

    function closeWatch() {
        state.watchOpen = false;

        /*
         * The native modal reuses #modal-corpo when navigating between RMT
         * and other screens. Clear every activation class, not just whichever
         * body querySelector happens to find first, or the next RMT render can
         * inherit the CSS rule that hides all of its children.
         */
        for (const body of qa('.moth-watch-active')) {
            body.classList.remove('moth-watch-active');
        }

        const button =
            q('#moth-market-watch-tab');

        if (button) button.classList.remove('on');
        updateWatchButtonLabel(button);
    }

    function updateWatchButtonLabel(button = q('#moth-market-watch-tab')) {
        if (!button) return;
        const label = button.querySelector('span');
        const text = tr(state.watchOpen ? 'Regular market' : 'Moth Watch');
        if (label && label.textContent !== text) label.textContent = text;
        button.title = tr(state.watchOpen ? 'Return to regular market' : 'Open Moth Watch');
        button.setAttribute('aria-pressed', state.watchOpen ? 'true' : 'false');
    }

    function installWatchButton(host) {
        if (!host) return null;

        let button =
            q('#moth-market-watch-tab');

        if (!button) {
            button = document.createElement('button');
            button.id =
                'moth-market-watch-tab';
            button.type = 'button';
            button.className =
                'cm-acao cm-atalho';
            button.innerHTML =
                '<i aria-hidden="true">M</i><span>Moth Watch</span>';
            button.title =
                'Underpriced listings and market sniper settings';
            button.setAttribute(
                'aria-pressed',
                state.watchOpen ? 'true' : 'false'
            );

            button.addEventListener(
                'click',
                event => {
                    event.preventDefault();
                    event.stopPropagation();

                    if (state.watchOpen) {
                        closeWatch();
                    } else {
                        openWatch();
                    }
                }
            );
        }

        if (button.parentElement !== host) {
            host.appendChild(button);
        }

        updateWatchButtonLabel(button);
        return button;
    }

    function ensureUi() {
        injectStyle();
        ensureSellPriceRecommendation();
        if (state.watchOpen && state.lastLocale !== currentLocale()) renderWatch(true);

        /*
         * Current PokéIdle: RMT is a normal top-menu entry that opens the
         * generic #modal. The old .cm-topo/.cm-corpo wrapper is only present
         * inside the community market renderer on older clients.
         *
         * Prefer the actual RMT modal action area. This prevents Moth Watch
         * from being mounted beside an unrelated menu element and makes its
         * button appear where it used to: inside RMT.
         */
        const modal =
            q('#modal');
        const modalBox =
            q('#modal .modal-caixa');
        const modalBody =
            q('#modal-corpo');

        const isCommunity =
            modal &&
            !modal.classList.contains('hidden') &&
            modalBox?.dataset?.modal ===
                'community';

        /*
         * Closing RMT or navigating to another modal must exit Watch mode.
         * The outer modal's inner content is replaced in place by PokéIdle,
         * so a class left on #modal-corpo survives and hides the new screen.
         */
        if (
            !isCommunity &&
            (state.watchOpen || qa('.moth-watch-active').length > 0)
        ) {
            closeWatch();
        }

        if (isCommunity && modalBody) {
            const communityTop =
                q('#modal-corpo .cm-topo');
            const watchHost =
                q('.cm-atalhos', communityTop) ||
                communityTop;

            if (watchHost) {
                installWatchButton(watchHost);
            }

            let panel =
                q('#moth-market-watch-panel');

            if (!panel) {
                panel =
                    document.createElement('section');
                panel.id =
                    'moth-market-watch-panel';
                modalBody.appendChild(panel);
            } else if (
                panel.parentElement !==
                modalBody
            ) {
                modalBody.appendChild(panel);
            }

            if (state.watchOpen) {
                modalBody.classList.add(
                    'moth-watch-active'
                );

                const button =
                    q('#moth-market-watch-tab');

                button?.classList.add('on');
                button?.setAttribute(
                    'aria-pressed',
                    'true'
                );
            }

            return true;
        }

        /*
         * Legacy client support. Keep the old structure working, but do not
         * search the whole document for a button whose text happens to be RMT.
         */
        const legacyTop =
            q('.cm-topo');
        const legacyBody =
            q('.cm-corpo');

        if (!legacyTop || !legacyBody) {
            return false;
        }

        const host =
            q('.cm-atalhos', legacyTop) ||
            legacyTop;

        const button =
            installWatchButton(host);

        let panel =
            q('#moth-market-watch-panel');

        if (!panel) {
            panel =
                document.createElement('section');
            panel.id =
                'moth-market-watch-panel';
            legacyBody.appendChild(panel);
        } else if (
            panel.parentElement !==
            legacyBody
        ) {
            legacyBody.appendChild(panel);
        }

        if (state.watchOpen) {
            legacyBody.classList.add(
                'moth-watch-active'
            );
            button?.classList.add('on');
        }

        return true;
    }

    function controllerSnapshot() {
        const configView = {
            enabled: !!config.enabled,
            scanSeconds: Math.max(1, Number(config.scanSeconds) || 5),
            watchPercent: Math.max(1, Number(config.watchPercent) || 70),
            scanItems: !!config.scanItems,
            scanPokemon: !!config.scanPokemon,
            scanDiamonds: !!config.scanDiamonds,
            goldReserve: Math.max(0, Number(config.goldReserve) || 0),
            gemReserve: Math.max(0, Number(config.gemReserve) || 0),
            maxCoinsPerBuy: Math.max(0, Number(config.maxCoinsPerBuy) || 0),
            maxGemsPerBuy: Math.max(0, Number(config.maxGemsPerBuy) || 0),
            fixedRulesEnabled: !!config.fixedRulesEnabled,
            purchasesPaused: !!config.purchasesPaused,
            maxCoinsPerSession: Number(config.maxCoinsPerSession) || 0,
            maxGemsPerSession: Number(config.maxGemsPerSession) || 0,
            maxCoinsPerDay: Number(config.maxCoinsPerDay) || 0,
            maxGemsPerDay: Number(config.maxGemsPerDay) || 0,
            maxPurchasesPerSession: Number(config.maxPurchasesPerSession) || 0,
            maxQuantityPerSession: Number(config.maxQuantityPerSession) || 0,
            fixedItemRules: sanitizeFixedItemRules(config.fixedItemRules),
            anyItemRules: sanitizeAnyItemRules(config.anyItemRules),
            pokemonBuyRules: sanitizePokemonBuyRules(config.pokemonBuyRules),
            minItemUnits: Math.max(1, Number(config.minItemUnits) || 1),
            minPokemonSamples: Math.max(1, Number(config.minPokemonSamples) || 1),
            pokemonHistoryPages: Math.max(1, Number(config.pokemonHistoryPages) || 12),
            pokemonHistoryRefreshMinutes: Math.max(5, Number(config.pokemonHistoryRefreshMinutes) || 60),
            viewCurrency: String(config.viewCurrency || 'all'),
            viewKind: String(config.viewKind || 'all'),
            viewSort: String(config.viewSort || 'discount')
        };

        const candidates = Array.from(state.candidates.values())
            .map(candidate => ({
                key: String(candidate.key || ''),
                kind: String(candidate.kind || ''),
                listingId: Number(candidate.listingId) || 0,
                itemId: Number(candidate.itemId) || 0,
                name: String(candidate.name || ''),
                currency: candidate.currency === 'orb' ? 'orb' : 'gold',
                price: Number(candidate.price) || 0,
                average: Number(candidate.average) || 0,
                samples: Number(candidate.samples) || 0,
                ratio: Number(candidate.ratio),
                qty: Math.max(1, Number(candidate.qty) || 1),
                unitPrice: Number(candidate.unitPrice || candidate.price) || 0,
                seller: String(candidate.seller || '—'),
                retainedUntil: Number(candidate.retainedUntil) || 0,
                firstSeenAt: Number(candidate.firstSeenAt || candidate.seenAt || 0),
                seenAt: Number(candidate.seenAt || 0),
                purchaseQuantity: purchaseQuantity(candidate),
                canBuy: !state.pendingBuy && !config.purchasesPaused &&
                    !unverifiedOrdersExist() &&
                    !(candidate.retainedUntil && candidate.retainedUntil > serverNow()) &&
                    purchaseQuantity(candidate) > 0,
                referenceSource: String(candidate.referenceSource || ''),
                activeReferenceListings: Number(candidate.activeReferenceListings || 0),
                serverAverage: Number(candidate.serverAverage || 0)
            }));

        const visibleCandidates = candidates
            .filter(candidateVisible)
            .sort(candidateSort);

        const pending = state.pendingBuy
            ? {
                listingId: Number(state.pendingBuy.listingId) || 0,
                candidateKey: String(state.pendingBuy.candidateKey || ''),
                currency: state.pendingBuy.currency === 'orb' ? 'orb' : 'gold',
                unitPrice: Number(state.pendingBuy.unitPrice) || 0,
                qty: Number(state.pendingBuy.qty) || 0,
                spend: Number(state.pendingBuy.spend) || 0,
                sentAt: Number(state.pendingBuy.sentAt) || 0,
                manual: !!state.pendingBuy.manual
            }
            : null;

        const logs = state.buyLog.slice(0, 12).map(row => ({
            at: Number(row.at) || 0,
            text: String(row.text || '')
        }));

        return {
            version: 1,
            connected: !!state.gameSocket && state.gameSocket.readyState === 1,
            nick: String(state.nick || ''),
            gold: Number(state.gold) || 0,
            orbs: Number(state.orbs) || 0,
            itemStatus: String(state.itemStatus || 'waiting'),
            pokemonStatus: String(state.pokemonStatus || 'waiting'),
            protocolMessages: Number(state.protocolMessages) || 0,
            lastScanAt: Number(state.lastScanAt) || 0,
            serverClockOffset: Number(state.serverClockOffset) || 0,
            pendingBuy: pending,
            lastPurchaseOutcome: String(state.lastPurchaseOutcome || 'idle'),
            unknownOrders: (state.orderJournal?.orders || []).filter(o => o.status === 'unknown').length,
            exposure: { sessionGold: orderExposure('session', 'gold').spent,
                sessionGems: orderExposure('session', 'orb').spent,
                dayGold: orderExposure('day', 'gold').spent,
                dayGems: orderExposure('day', 'orb').spent },
            candidates: visibleCandidates,
            allCandidates: candidates.length,
            baseline: baselineStats(),
            itemScanStats: copy(state.itemScanStats) || {},
            config: configView,
            buyLog: logs,
            controllerResult: state.lastControllerResult
                ? {
                    at: Number(state.lastControllerResult.at) || 0,
                    ok: !!state.lastControllerResult.ok,
                    source: String(state.lastControllerResult.source || ''),
                    error: String(state.lastControllerResult.error || ''),
                    listingId: Number(state.lastControllerResult.listingId || 0)
                }
                : null
        };
    }

    page.__mothMarketWatchControllerV1 = {
        version: 1,
        buy: buyFromController,
        configure: configureFromController,
        scan: scanFromController,
        snapshot: controllerSnapshot,
        refreshBaseline: () => {
            state.forceBaselineNext = true;
            state.baseline = emptyBaseline();
            saveBaseline();
            requestItemSummary();
            queueRender();
            return { ok: true };
        },
        exportBaseline: () => exportBaselineText()
    };

    function bootstrap() {
        try {
            document.documentElement?.setAttribute(
                'data-moth-watch-ready',
                '1'
            );
        } catch {}
        try { installSocketHook(); } catch {}
        try { injectStyle(); } catch {}
        loadNameCatalogs();

        state.scanTimer = setInterval(() => {
            adoptBridgeSocket();
            ensureUi();
            runMarketAutomation();
            // Give queued rule listings first use of the shared request slot.
            if (!state.detailPending && state.detailQueue.some(job => state.ruleItemKeys.has(job.key))) {
                pumpItemDetails();
            }
            runScan(false);
            if (state.pendingBuy && Date.now() - state.pendingBuy.sentAt > 5000) {
                finishPendingBuy('watchdog');
            }
            }, 1000);

        /*
         * Observe only the modal shell. The previous whole-document observer
         * woke up for every combat/asset DOM mutation during game boot and
         * repeatedly scanned the page while it was still loading.
         */
        const modal =
            q('#modal');

        if (modal) {
            const modalBox = q('#modal .modal-caixa');

            const observer =
                new MutationObserver(records => {
                    /*
                     * Ignore mutations caused solely by Moth Watch rendering
                     * its own panel. Native modal changes still reach ensureUi.
                     */
                    const panel = q('#moth-market-watch-panel');
                    const relevant = records.some(record => {
                        if (record.type === 'childList' && panel) {
                            const target = record.target;
                            if (
                                target === panel ||
                                target?.closest?.('#moth-market-watch-panel')
                            ) {
                                return false;
                            }
                        }
                        return true;
                    });

                    if (relevant) {
                        ensureUi();
                    }
                });

            /*
             * Watch DOM replacement inside the modal so the button/panel can
             * be reattached when PokéIdle redraws RMT, but do not watch every
             * descendant attribute. The old attribute observer could feed on
             * Moth Watch's own class/aria updates while it was rendering.
             */
            observer.observe(
                modal,
                {
                    childList: true,
                    subtree: true
                }
            );

            observer.observe(
                modal,
                {
                    attributes: true,
                    attributeFilter: ['class']
                }
            );

            if (modalBox) {
                observer.observe(
                    modalBox,
                    {
                        attributes: true,
                        attributeFilter: ['data-modal']
                    }
                );
            }
        }

        ensureUi();
        console.info('[Moth Watch] v0.1.51 loaded');
    }

    bootstrap();
})();
