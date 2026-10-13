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
            state.itemInventoryMemo = null;
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
        if (candidate.kind === 'item' && state.selectedItemFocus?.key ===
            String(candidate.itemId) + ':' + candidate.currency) state.itemInventoryMemo = null;
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
        const lines = Array.isArray(message.linhas) ? message.linhas : null;
        if (!lines) return;
        const pending = state.detailPending?.itemId === itemId &&
            state.detailPending.currency === currency ? state.detailPending : null;
        // A native item-market response is also authenticated listing evidence.
        // Do not lose it when an automated detail request was not outstanding.
        if (!pending && !communityMarketIsOpen()) return;
        if (pending) finishItemDetailRequest(pending, lines.length ? 'loaded' : 'empty');
        processItemListingPayload(itemId, currency, lines);
    }

    function processItemListingPayload(itemId, currency, lines) {
        const detailKey = String(itemId) + ':' + currency;
        const offers = Array.isArray(lines) ? lines.slice(0, 120) : [];
        snatchConfirmItemListingSet(itemId,currency,offers);
        const explicitlyLoaded = state.loadedItemKeys.has(detailKey);
        const selected = state.selectedItemFocus?.key === detailKey;
        const neededForRecommendation = state.sellRecommendationKey === detailKey;
        // Retain every verified item detail we requested (plus native browsing
        // responses). Broad rules rotate targets each tick; their queue key can
        // disappear before the packet arrives. The bounded cache is the correct
        // source of purchase quotes, not the transient priority set.
        state.itemOfferDetails.set(detailKey, { itemId, currency, offers, updatedAt: Date.now() });
        pruneDetailCache();
        if (explicitlyLoaded || selected || neededForRecommendation || state.ruleItemKeys.has(detailKey)) {
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
