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
        const sent = send(payload);
        if (sent) diagnosticOutbound(payload);
        return sent;
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
        diagnosticOutcome('rate-limit');
        queueRender();
    }

    function serverNow() {
        return Date.now() - Number(state.serverClockOffset || 0);
    }
