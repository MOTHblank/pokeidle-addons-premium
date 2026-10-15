# Battle Trace · 30 seconds

Temporary, **read-only** userscript for diagnosing why Hunt Atlas can estimate **46m trainer XP/hour** when a real session with the user's strongest Pokémon measures **13m/hour**. It is a standalone test addon in the **premium** repository. It does not alter Hunt Atlas, attack rotation, pathfinding, movement, timers, purchases, or the public addon registry.

## Install and record

1. Open [battle-trace-30s.user.js](./battle-trace-30s.user.js) on GitHub, open **Raw**, and install it in Violentmonkey for the Firefox profile you want to test. If the private repository prevents installing from a Raw URL, create a **new userscript** in Violentmonkey, paste the script contents from GitHub, and save it.
2. **Reload the PokéIdle game page once after installation.** The script needs to observe the game WebSocket when the page creates it. Do not uninstall or disable Hunt Atlas.
3. Go to the hunt whose XP/hour is wrong, ensure the Pokémon you're testing is already fighting, and stay in that hunt.
4. Press the small **Battle Trace · Record 30s** button in the lower-right corner of the game. The indicator counts down and then **automatically downloads** a `pokeidle-battle-trace-30s-*.json` file. If Firefox suppresses the download, press **Download JSON again**.
5. **Upload that JSON file to the ChatGPT project conversation.** It contains 30 seconds of combat observations suitable for comparison with Hunt Atlas's formulas. You can disable/remove the temporary script afterward.

Do not test during boss combat, travel, or a hunt switch. If the JSON warns that no battle packets were captured, reload again with the diagnostic installed **before** the game establishes the connection and repeat.

## Collected evidence

- Confirmed active Pokémon's species, level, combat stats, IVs, types, quality and **published moves / move-source field** (if available). Names/nicknames and owned collection are not exported.
- Current hunt's slug, level and species spawn weighting.
- Observed battle timeline: **browser packet receipt timestamps**, per-packet event order, spawn HP, attack damage, element/effectiveness, names of explicitly identified moves, anonymized cast and target IDs, enemy attacks, kills, item-healing events and separate trainer/Pokémon XP receipts.
- Game state changes affecting the lead/hunt, limited bonus information, and pre/post snapshot of Hunt Atlas XP source/forecast diagnostics if it is running.
- Summary of counted kills, attack timestamps, kill intervals and **30-second** XP rate, with warnings for missing packets and hunt changes.
- Raw field **names** (never values) to identify changes to the battle protocol.

No raw WebSocket messages, login/account IDs, chat, inventory, market data, session tokens or passwords are stored or exported. The addon opens **no extra sockets**, sends **no messages** and makes **no network requests**. It only adds a passive listener to PokéIdle's ordinary game WebSocket. The full local file is human-readable JSON.

**Important:** a 30-second kill/XP projection is **not** a reliable long-run measured XP/hour estimate. The main purpose is to inspect whether the actual attacks, cooldown gaps, movement/wave pauses and server rewards differ from the speculative combat simulator. Individual events in the same batch share the browser receipt timestamp; that does not prove they happened at precisely the same server time.

## Regression checks

Run `node --test addons/battle-trace/tests/battle-trace.test.cjs` in this repository to test read-only socket hooking, allowlisting/anonymization, the 30-second export, battle hunt transitions and an explicit warning if traffic cannot be captured.
