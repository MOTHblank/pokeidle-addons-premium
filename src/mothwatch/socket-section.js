    function handleProtocolObject(message, sourceSocket = null) {
        if (!message || typeof message !== 'object') return;
        diagnosticProtocol(message);
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
            state.economyHoldings = loadEconomyHoldings();
            state.economyNotice = '';
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
