# PokéIdle Hunt Atlas

> **Versão experimental 1.9.3.** Esta pasta no repositório premium é o ambiente de testes do Hunt Atlas. A cópia do `pokeidle-addons` não recebe automaticamente nenhuma mudança daqui. **Desative a outra instalação do Hunt Atlas antes de testar**, pois duas cópias podem disputar o mapa e os hooks de WebSocket.
>
> Não há mapa visual novo. O Atlas continua sendo uma lista pesquisável; o índice `map-markers.json` só adiciona contexto textual de localização para hunts com slug correspondente. O índice `moves-index.json` oferece golpes possíveis por espécie/nível, não uma lista de golpes equipados. Agora o Atlas compara os golpes dos índices com o catálogo mais recente de Pokémon e mostra divergências. Quando o jogo fornece nomes de golpes, o modelo usa **amostras por execução**, sem contar várias vítimas de um ataque em área como vários golpes. Quando o nome não chega, mantém o modelo por tipo. XP/h **medido** continua acima de qualquer projeção. Os índices são opcionais e podem estar desatualizados.
>
**Precisão na 1.9.1:** o Atlas agora calcula a cobertura do modelo por **pontos de aparição** de cada hunt. Se o HP ou dano de qualquer inimigo não puder ser estimado, a projeção personalizada não será calculada só com os inimigos conhecidos: será usada a estimativa-base com aviso **⚠ modelo cobre X%**. Imunidades conhecidas continuam impedindo previsões de abate, e XP/h medido tem prioridade. O agrupamento de ataques em área usa identificadores de execução quando existirem; sem eles, só une golpes com o mesmo nome/tipo em alvos distintos dentro de 350 ms. Golpes sem nome e sem ID ficam separados para evitar unir ataques diferentes.

**Testes de regressão:** `node --test tests/accuracy.test.cjs` (Node.js recente; não é necessário abrir o jogo). Os testes verificam cobertura, HP/dano ausentes, imunidade, AoE atrasado, golpes consecutivos e eventos sem nome. A confirmação do protocolo real ainda depende dos diagnósticos capturados em jogo.

### 🎮 Correio Maluco — minigame experimental (1.9.3)

O botão **🎮 Correio Maluco**, dentro do Atlas, abre um jogo de entregas que usa as coordenadas **`pixel`** e a região **`area`** do índice de locais já consultado pelo Atlas. Ele mostra pequenas constelações de hunts, destinos de entrega (📮), um caminhão (🚚) e fiscais fantasmas (👻). Você tem **60 segundos e três vidas**; cada entrega dá um ponto e mais cinco segundos. O recorde fica salvo *localmente*, separado por região.

**Controles:** WASD ou setas com o tabuleiro em foco; clique/arraste ou toque/arraste no tabuleiro; quatro botões direcionais para tela sensível ao toque. O seletor começa por **Outland** (quando o índice estiver disponível), mas também permite **Kanto** e **Orre**. Ao fechar o Atlas, desligar o addon ou sair do minigame, a animação para.

**É um brinquedo, não uma alternativa de navegação:** os caminhos são inventados; o mapa é distorcido para ocupar a tela; as posições não representam rotas, distâncias reais ou desbloqueios. O minigame não envia comandos ao PokéIdle, não altera a hunt e não concede XP real. Só roda enquanto estiver aberto e jogando. Depende do índice de locais já usado pelo Atlas; não exige uma segunda extensão.

Para verificar a lógica isoladamente: `node --test tests/parcel-panic.test.cjs`. Os testes não substituem uma checagem visual dentro do Firefox.

Um addon para **PokéIdle** que substitui a tela **Mapa**.

O Hunt Atlas mostra informações úteis diretamente ao lado de cada Pokémon, como tipos, matchup com o líder da equipe, valor de venda, etc.
**Para testar o experimento:** abra algumas hunts e deixe o Pokémon lutar. Em `Recomendações de XP/hora → Detalhes`, confira se o modelo capturou nomes de golpes e quais campos chegam nos eventos sem nome. Se precisar registrar o diagnóstico, abra o console do navegador e execute `copy(JSON.stringify(window.__mothHuntAtlasExperimentV1.snapshot(), null, 2))` (no Firefox, `copy` pode exigir o console habilitado para colagem). É um resumo local, sem envio automático de dados. A curva de XP/h foi alterada para contar o primeiro ataque até em abates de um único golpe.


![Prévia do Hunt Atlas](docs/map-preview.png)

### Instalação experimental

Este repositório é **privado**. Links `raw.githubusercontent.com` podem não funcionar no Violentmonkey/Tampermonkey sem autenticação. Esta versão **não tem atualização automática**.

1. Abra [hunt-atlas.user.js](https://github.com/MOTHblank/pokeidle-addons-premium/blob/main/huntatlas/hunt-atlas.user.js) usando uma conta com acesso ao repositório premium.
2. Copie o conteúdo para um novo script no Violentmonkey ou Tampermonkey e salve-o.
3. Desative qualquer outra instalação do Hunt Atlas no perfil para evitar conflito de hooks.
4. Recarregue [PokéIdle](https://pokeidle.io/app) e abra **Mapa**.

Execute os testes a partir da pasta `huntatlas/` com `node --test tests/*.test.cjs`.

### Como usar

Use a busca para encontrar um Pokémon, uma hunt ou uma região. Os filtros permitem limitar os resultados por:

- região;
- nível;
- disponibilidade;
- tipo;
- fraqueza;
- Pokémon capturados ou não capturados.

Em **Ordenar**, escolha o que deseja comparar e use **↑ / ↓** para alternar entre ordem crescente e decrescente.

As opções incluem:

- **XP/hora**
- **Nome**
- **Número da Pokédex**
- **Nível**
- **MKT**
- **RMT**
- **Matchup**

### Informações mostradas

Cada Pokémon corresponde à sua própria hunt. No PokéIdle, ele é o único Pokémon daquela hunt e aparece continuamente; por isso o Atlas não mostra porcentagem ou taxa de encontro.

Cada Pokémon pode mostrar:
- a hunt onde ele é encontrado e o nível dela;
- se já foi capturado;
- tipos;
- como ele se sai contra o Pokémon líder da sua equipe e vice-versa;
- **MKT**, o valor estimado de venda para o NPC;
- **RMT**, o valor médio observado em vendas entre jogadores.

Quando um valor ainda não estiver disponível, será mostrado **—**.

O bloco **Recomendações de XP/hora** indica a melhor hunt encontrada para o líder atual da equipe dentro dos filtros selecionados. O **Top 5** mostra as cinco melhores opções estimadas.

Use o botão **Ir** em uma hunt liberada para viajar diretamente até ela.

O idioma do Hunt Atlas acompanha o idioma selecionado no PokéIdle. Atualmente há suporte para **Português do Brasil** e **English**.

---

## English

> **Experimental version 1.9.3.** This premium repository subdirectory is Hunt Atlas's test environment. Changes here are **not** synchronized into `pokeidle-addons`. **Disable any other installed Hunt Atlas copy when testing**; concurrent copies can interfere with map replacement and WebSocket hooks.
>
> There is no new visual map. Atlas remains a searchable list; `map-markers.json` only adds textual location context when slugs match the game's current hunt catalog. `moves-index.json` provides moves *learnable* at the Pokémon's current level, not confirmed equipped moves. The experiment compares moves against the newer creature catalog and flags disagreements. When battle events name the move, modeling uses **one sample per cast**, avoiding double-counting multi-target hits; unnamed attacks continue using the measured type-based fallback. **Measured** XP/hour always takes priority. Both indexes are optional and may be stale.
>
**Accuracy in 1.9.1:** Hunt model coverage is now **spawn-point weighted**. If any enemy lacks HP or damage information, the personalized prediction no longer averages only known enemies: it uses an explicitly marked baseline estimate (**⚠ model covers X%**). Known immunity still prevents a kill prediction, and measured XP/hour retains priority. Area attacks use execution-specific cast IDs when supplied; without IDs, only same-name/type hits on distinct targets within 350 ms are grouped. Unnamed attacks without cast IDs remain separate to avoid merging unrelated attacks.

**Regression tests:** `node --test tests/accuracy.test.cjs` (recent Node.js, game not required). Tests cover missing HP/damage, spawn weights, immunity, delayed AoE, consecutive casts, and unnamed events. Final protocol verification still needs player battle snapshots.

### 🎮 Parcel Panic — experimental mini-game (1.9.3)

The **🎮 Parcel Panic** button inside Atlas opens a delivery game that reuses the existing location index's **`pixel`** coordinates and **`area`** region. Hunt markers become a silly constellation, parcel destinations (📮), a delivery truck (🚚), and ghost auditors (👻). You get **60 seconds and three hearts**; every delivery gives one point and five extra seconds. Each region has a separate **locally stored** best score.

**Controls:** WASD or arrow keys when the playfield is focused; click/drag or touch/drag on the board; four on-screen directional buttons. The default is **Outland**, with **Kanto** and **Orre** selectable when marker data loads. Closing Atlas, disabling it, or leaving the game stops the animation.

**Not a real navigation map:** roads are invented; each region is stretched to fill the screen; placements are not real routes, walking distances, or unlock information. The mini-game never sends PokéIdle actions, never changes the current hunt, and never awards actual XP. It only animates while visible and playing. It reuses the Atlas location index, with no additional extension.

To test the isolated logic: `node --test tests/parcel-panic.test.cjs`. A visual check in Firefox is still recommended.

A **PokéIdle** addon that replaces the **Map** screen.

Hunt Atlas shows useful information directly beside each Pokémon, including types, matchup with your party leader, sale value, etc.
**Experimental test:** open hunts and allow the lead Pokémon to fight. Under `XP/hour recommendations → Details`, inspect named move counts and the field names available on unnamed attacks. For a compact diagnostic snapshot, run `copy(JSON.stringify(window.__mothHuntAtlasExperimentV1.snapshot(), null, 2))` in the browser console (Firefox console paste rules may apply). This is a local snapshot and is not uploaded automatically. The XP model now also includes first-hit time for one-hit kills.


### Experimental installation

This is a **private** repository. `raw.githubusercontent.com` URLs may not work in Violentmonkey/Tampermonkey without authentication. This version has **no automatic updates**.

1. Open [hunt-atlas.user.js](https://github.com/MOTHblank/pokeidle-addons-premium/blob/main/huntatlas/hunt-atlas.user.js) with an account authorized to access the premium repository.
2. Copy its contents into a new script in Violentmonkey or Tampermonkey and save.
3. Disable any other Hunt Atlas script in that profile to avoid duplicate hooks.
4. Reload [PokéIdle](https://pokeidle.io/app) and open **Map**.

Run the regression tests from `huntatlas/` using `node --test tests/*.test.cjs`.

### How to use

Use search to find a Pokémon, hunt, or region. Filters can narrow the results by:

- region;
- level;
- availability;
- type;
- weakness;
- caught or uncaught Pokémon.

Under **Sort**, choose what you want to compare and use **↑ / ↓** to switch between ascending and descending order.

Available sorting options include:

- **XP/hour**
- **Name**
- **Pokédex number**
- **Level**
- **MKT**
- **RMT**
- **Matchup**

### Information shown

Each Pokémon corresponds to its own hunt. In PokéIdle, it is the only Pokémon in that hunt and spawns continuously, so Hunt Atlas does not show encounter-rate percentages.

Each Pokémon can show:

- the hunt where it is found and its level;
- whether it has already been caught;
- types;
- how it matches up against your current party leader, and vice versa;
- **MKT**, the estimated NPC sale value;
- **RMT**, the observed average value from player sales.

If a value is not available yet, it is shown as **—**.

The **XP/hour recommendations** block shows the best hunt found for your current party leader within the selected filters. The **Top 5** lists the five best estimated options.

Use **Go** on an unlocked hunt to travel directly to it.

Hunt Atlas follows the language selected in PokéIdle. It currently supports **Brazilian Portuguese** and **English**.

---

**MOTHblank** · [Google Play](https://play.google.com/store/apps/developer?id=MOTHblank) · [X](https://x.com/MOTHblank) · [WhatsApp / Pix](https://wa.me/+5537999933376)
