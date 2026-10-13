# PokéIdle Hunt Atlas

> **Versão experimental 1.9.15.** Esta pasta no repositório premium é o ambiente de testes do Hunt Atlas. A cópia do `pokeidle-addons` não recebe automaticamente nenhuma mudança daqui. **Desative a outra instalação do Hunt Atlas antes de testar**, pois duas cópias podem disputar o mapa e os hooks de WebSocket.
>
> Não há mapa visual novo. O Atlas continua sendo uma lista pesquisável; o índice `map-markers.json` só adiciona contexto textual de localização para hunts com slug correspondente. O índice `moves-index.json` oferece golpes possíveis por espécie/nível, não uma lista de golpes equipados. Agora o Atlas compara os golpes dos índices com o catálogo mais recente de Pokémon e mostra divergências. Quando o jogo fornece nomes de golpes, o modelo usa **amostras por execução**, sem contar várias vítimas de um ataque em área como vários golpes. Quando o nome não chega, mantém o modelo por tipo. XP/h **medido** continua acima de qualquer projeção. Os índices são opcionais e podem estar desatualizados.
>
**Precisão na 1.9.1:** o Atlas agora calcula a cobertura do modelo por **pontos de aparição** de cada hunt. Se o HP ou dano de qualquer inimigo não puder ser estimado, a projeção personalizada não será calculada só com os inimigos conhecidos: será usada a estimativa-base com aviso **⚠ modelo cobre X%**. Imunidades conhecidas continuam impedindo previsões de abate, e XP/h medido tem prioridade. O agrupamento de ataques em área usa identificadores de execução quando existirem; sem eles, só une golpes com o mesmo nome/tipo em alvos distintos dentro de 350 ms. Golpes sem nome e sem ID ficam separados para evitar unir ataques diferentes.

**Testes de regressão:** `node --test tests/accuracy.test.cjs` (Node.js recente; não é necessário abrir o jogo). Os testes verificam cobertura, HP/dano ausentes, imunidade, AoE atrasado, golpes consecutivos e eventos sem nome. A confirmação do protocolo real ainda depende dos diagnósticos capturados em jogo.

### Medições de farming (v1.9.4 · Marco A)

Os **XP/h medidos** agora exigem pelo menos **6 abates selvagens e 60 segundos** de amostragem da sessão atual. O denominador é **tempo corrido**, incluindo ondas e pausas breves; após 2 minutos sem abate a medição fica desatualizada e volta a aquecer no próximo abate. Trocar hunt, recarregar/reconectar ou mudar Pokémon/equipamento/estado relevante impede reutilizar uma medição incompatível. O cálculo conserva separados XP do treinador, XP do Pokémon, ouro por morte e ouro de venda automática. Eventos `bola`, `capturado`, `cura`, `revive` e boss são interpretados separadamente em um contador local, sem presumir que cada clique é uma bola aceita.

O painel indica **aquecendo** enquanto o modelo ainda não reúne dados suficientes. Em `window.__mothHuntAtlasExperimentV1.snapshot().farmingEvidence`, podem ser consultadas apenas contagens e nomes de campos previamente permitidos, **sem** pacotes completos ou tokens. O protocolo ainda apresenta algumas ambiguidades; veja [a matriz técnica e os limites](../docs/HUNTATLAS_MILESTONE_A_PROTOCOL.md). Os cálculos puros de chances, Outland e Ovo Shiny são preparação para versões futuras; **não** foi adicionado um seletor de Outland nem previsão de captura nesta entrega.

### Projeções de XP/h (v1.9.5 · Marco B)

- **XP do treinador e do Pokémon são leituras distintas.** Se o evento não trouxe XP de um dos dois, a leitura daquele canal fica desconhecida; não se assume zero nem se soma os dois para anunciar uma taxa individual.
- **Projeções para outras hunts são SEM bônus estimados** enquanto VIP, guilda, lives, eventos e catch-up não tiverem valores/aplicação confirmados pelo servidor. O Atlas deixou de copiar multiplicadores antigos de XP para uma hunt não visitada.
- **Calibração contextual:** nível, identidade, atributos/IV de Speed, golpes declarados, TMs, Mega, região, boosts e catálogo são relevantes. O modelo pode comparar uma projeção feita *antes* de obter amostras suficientes com a taxa medida posteriormente na mesma hunt. Os erros ficam limitados à sessão, por até 90 minutos, sem histórico global de contas.
- O Top 5 apresenta **candidato principal (incerto)** para projeções, fonte e **faixa heurística** (não é intervalo de confiança estatística). Projeções incertas quase empatadas não ultrapassam automaticamente resultados medidos.
- As regras de Speed IV/cooldown têm testes matemáticos, mas o agendamento exato de ataques e o empilhamento de bônus ainda **não foram validados em jogo**. Detalhes: [Marco B](../docs/HUNTATLAS_MILESTONE_B.md).

### Economia de farming (v1.9.6 · Marco C)

O Atlas agora calcula **Moedas/h por abate** usando o nível da hunt e o teto real de 25.000; quando existe uma janela válida com recibos de morte do servidor, usa o valor medido. A ordenação por **Moedas/h por abate** continua disponível; Moedas líquidas/h seguem nos detalhes econômicos, mas não são critério de ordenação.

No painel de XP/h aparece também a **Economia da hunt**, com quatro números separados: Moedas/h pelos abates, **valor esperado** de loot ordinário vendável ao NPC, Moedas/h **já realizadas** (abates + venda automática confirmada) e **líquido após custo de reposição dos itens consumidos**. O EV dos drops não é somado à renda realizada; itens guardados ou anúncios no mercado não viram Moedas recebidas. Custos dependem dos preços apresentados pelo jogo; itens sem preço conhecido tornam o líquido **indisponível**, e Diamantes ficam em sua própria moeda. Com estoque conhecido há estimativa de duração.

Os drops NPC são calculados de um catálogo reconstruído com regras compartilhadas upstream, **não** de uma leitura certificada dos drops finais do servidor; quando a cobertura é incompleta o valor fica **—**. O painel e os testes estão prontos, mas a validação no jogo ainda é necessária. Veja [o contrato de economia e os limites](../docs/HUNTATLAS_MILESTONE_C.md). Não foram adicionados pedidos periódicos à loja nem venda automática.

### Outland e raros (v1.9.7 · Marco D)

- O seletor **Comparar Outland 1–8** é apenas uma **prévia** e funciona mesmo quando sua conta está em outra hunt. O tier ativo é mostrado separadamente, somente quando recebido do jogo. A prévia não altera a localização, o tier ou as regras da hunt atual; tiers bloqueados informam o nível necessário.
- **Usar este tier no jogo** aparece somente se o estado do jogo informou o tier ativo, o novo tier está desbloqueado e há conexão. O Atlas envia o comando nativo `outland.tier`, mas **só considera a troca confirmada quando um estado posterior mostra o novo tier**; caso contrário a solicitação expira. O protocolo/cooldown do servidor ainda requer confirmação em uma sessão real.
- Boss Token, Fragmento de Chave, Fragmento de Shiny Stone e Fragmento de Bicicleta têm previsão individual de **chance por abate, itens/h, horas médias por item e por dez fragmentos, e chance de ≥1 em 1h/24h**. O fragmento de Bicicleta permanece **reportado pela wiki / não confirmado no servidor**.
- O **Fragmento de Ovo Shiny** aparece somente nas hunts elegíveis de Unova para frente, com os 30 degraus fixos de nível. O custo de 10 fragmentos e as 168h adicionais de incubação aparecem em separado. **Outland nunca recebe o Ovo Shiny**.
- Probabilidades são **sem bônus não confirmados** e indicam expectativas, **não garantias**. Drops efetivamente vistos nesta sessão aparecem separados da previsão, sem confundir tiers. Preços de mercado ficam **—** na ausência de vendas concluídas verificadas; nada é comprado/vendido.
- Detalhes e limitações: [Marco D](../docs/HUNTATLAS_MILESTONE_D.md).

### Captura, Ultra/Beast e shiny (v1.9.8 · Marco E)

**Ultra Ball ×4 é o padrão**, com **Beast Ball ×8 como opção**, sem inventar câmbio de Diamantes para Moedas. Na lista de hunts, cada espécie informa **chance condicional de captura para Ultra e Beast**, **capturas/h estimadas do alvo** e **shinies capturados/h estimados**, ponderando quantas vezes a espécie aparece. Agora é possível ordenar por **capturas/h** e **shinies capturados/h** do Pokémon desejado, com a bola escolhida.

No painel **Planejador de capturas e shinies**, a escolha Ultra/Beast e a simulação de **Shiny Secret Lure ×2** (explicitamente hipotética, sem afirmar que está ativa) atualizam chances, capturas/h, shinies vistos/h e capturados/h, tempo médio para shiny e chance de conseguir pelo menos um em 24h. **Shiny é sorteado por arremesso aceito elegível (1/24.000 normalmente), NÃO por abate**; mesmo após um shiny ser visto, ainda é preciso conseguir capturá-lo. A Beast não é sempre duas vezes melhor após o teto de 10% de captura.

**Dados medidos** vêm de `morte`, `bola` e `capturado` correlacionados: ao menos seis abates e 60 segundos, com denominador de tempo corrido, separando tentativas aceitas, capturas confirmadas e shiny visto/capturado. Para outras hunts, as projeções indicam claramente um **teto condicional se uma bola for aceita por corpo**, não que o Auto Catch alcance esse ritmo. Quando um Pokémon não fornece raridade econômica confiável, a chance fica indisponível; não usamos preço de venda MKT/RMT. A chance é o **modelo da wiki, ainda não confirmado com a fórmula do servidor**. Na Outland, a elegibilidade para shiny continua não verificada, portanto não é inventada. Arena Mística usa tabela própria e ticket por tentativa.

Veja [contrato técnico, cenários de teste e limitações](../docs/HUNTATLAS_MILESTONE_E.md). O addon não compra bolas automaticamente nem altera o Auto Catch+.

### Correções de precisão e desempenho (v1.9.15)

A normalização dos eventos passou a descartar retransmissões quando o servidor fornece um identificador explícito, mas **não** colapsa usos iguais de poções/revives sem identificação. Eventos explícitos de desaparecimento fecham o corpo; arremessos sem ID de bola continuam registrados, mas o custo fica desconhecido. Leituras parciais de inventário não apagam os demais itens.

As estimativas de XP não tratam o nível nominal da hunt como prova do nível do inimigo para detectar bônus. Fora da hunt atual, ataques sem cadência medida usam um tempo conservador; erros posteriores de previsão podem **aumentar**, nunca diminuir, a faixa de incerteza. O loot vendido a NPC respeita elegibilidade explícita e pode utilizar a mistura observada após pelo menos 30 abates inteiramente atribuídos. Essa mistura é calculada apenas com dados recentes; a média estática é memorizada por catálogo para evitar trabalho repetido.

No planejador de captura, uma bola com 30+ arremessos aceitos apresenta sua frequência observada de sucesso (não confundir com fórmula de captura do servidor). Estoque zerado é indicado. Se a arena ativa for identificada como `arena_mistica`, a seção mostra a tabela especial de cinco bolas e o estoque conhecido de MysticTickets, sem misturar com odds das hunts comuns.

O modelo continua deliberadamente conservador onde faltam dados do servidor, sem novos sockets, scanners de mercado ou compras. Consulte o [registro de avanço do roadmap](../docs/HUNTATLAS_ROADMAP.md#follow-through-after-milestones-af-2026-10-13-experimental-v1915) e os testes `receipt-identity.test.cjs` e `roadmap-followthrough.test.cjs`. Os testes são determinísticos; a validação no jogo continua sob responsabilidade do operador.

### Top 5 direto, sem clique (v1.9.14)

O **Top 5 aparece diretamente** na área principal de recomendações, com até cinco opções, valores e botões **Ir**; não é necessário clicar em “Ver top 5”. O botão de expansão e a recomendação principal duplicada foram removidos. Se faltarem dados, uma explicação aparece na própria lista. Os detalhes de calibração e confiança continuam acessíveis em **Detalhes da hunt**, sem ocupar espaço da lista.

A ordenação **“Menor custo Moedas/captura (Ultra)”** foi retirada da interface, da seleção de métricas, das recomendações e do código de classificação. **Capturas estimadas** e **shinies capturados** continuam disponíveis; cálculos de custo e chance das bolas no planejador de captura não foram removidos. Quem tinha a ordenação retirada salva passa a **capturas (decrescente)**, sem alterar o jogo.

### Taxas de raros/shinies legíveis (v1.9.12)

**Uma frequência positiva pequena não deve aparecer como 0/h.** A lista, o Top 5, as estimativas individuais de captura/shiny, as taxas de fragmentos da Outland/Ovo Shiny e as simulações opcionais agora alternam entre **eventos por hora, por dia ou tempo médio para um evento** (dias/anos) de acordo com a grandeza. Exemplo: `0,05 evento/h` aparece como `1,2/d`; `0,0001 evento/h` como **~1 por 1,14 ano** (tempo médio, não garantia). Números exatos de zero permanecem distintos de taxas desconhecidas. Probabilidades extremamente baixas ganham casas decimais ou notação científica quando necessário.

Os **tempos médios de espera e fabricação** também usam dias/anos quando ficariam enormes em horas. As taxas dos rankings permanecem ordenadas com precisão completa, sem alterar o modelo; a antiga métrica de ordenação por Moedas/captura foi retirada na v1.9.14. Moedas líquidas negativas são apresentadas com sinal, não como dados ausentes.

Na revisão visual, os cartões do Top 5 e os campos numéricos dos cenários ganharam limites de largura, quebra de texto e organização responsiva para que descrições longas não escondam os botões **Ir**. Todas as mudanças são de interface: nenhuma nova consulta periódica, WebSocket, compra automática ou alteração dos odds do jogo. Veja [auditoria de taxas e UI](../docs/HUNTATLAS_RATE_UI_AUDIT.md) e `tests/rare-rate-ui.test.cjs`.

### Revisão de UI/UX (v1.9.11)

A interface agora prioriza navegação e leitura em sessões longas. Os filtros podem ser recolhidos; em telas de até 620 px começam recolhidos para preservar espaço à lista. O campo de pesquisa e o intervalo de níveis agrupam digitação por 160 ms antes de atualizar os resultados, sem novas leituras periódicas do jogo. **Limpar filtros** passa a limpar somente busca, região, níveis, tipos, fraquezas, disponibilidade e coleção: mantém tier Outland, bola escolhida, ordenação e os cenários opcionais. Sem resultados, há ação direta para limpar os filtros. Alternar fraquezas e atualizar o resumo preserva foco do teclado; tamanho de fontes e controles, contraste e rolagem nos painéis foram ajustados para desktop e mobile.

O atalho de Outland permanece no resumo principal e agora diferencia **tier ativo**, **prévia**, **bloqueio por nível**, **sem conexão**, **aguardando estado**, **pedido pendente** e **troca não confirmada em seis segundos**. O botão de alteração continua visível mas desativado quando não é seguro enviar o comando. Nenhum pedido é considerado sucesso antes de um estado real do jogo mostrar o tier. Painéis de detalhes longos têm rolagem própria para não bloquear a lista.

Veja [a revisão técnica e roteiro de QA](../docs/HUNTATLAS_UI_UX_AUDIT.md) e o teste `tests/ui-ux-audit.test.cjs`. A validação visual e de servidor deve ser feita no Firefox pelo usuário.

### Troca rápida de tier Outland (v1.9.10)

O seletor **Tier Outland (troca rápida)** fica na área principal do Atlas quando a Outland está desbloqueada. Escolha um tier de 1 a 8 e clique em **Mudar para este tier**, sem desativar o HuntAtlas ou expandir Detalhes da hunt. Ele informa o tier realmente ativo quando o jogo transmite esse dado, respeita bloqueios por nível, exige conexão, evita reenvios simultâneos e aguarda confirmação do estado do jogo. **Mudar a prévia sozinho não muda o tier da conta.** Se o jogo não enviar o tier atual, o botão continua indisponível; a conexão e o protocolo precisam ser verificados em uma sessão real.

### Cenários de referência PokeIdle Tools (v1.9.10)

Dentro de **Detalhes da hunt → Cenários de bônus de referência externa**, há uma simulação opcional, **desligada por padrão**, que incorpora os coeficientes matemáticos que o site externo realmente usa: bônus shiny e de captura ×1,5, hipóteses de Kick ×1,15, percentuais de eventos e multiplicadores de loot/guilda/evento/Kick para os drops raros. Todos os valores são escolhidos manualmente e a interface deixa claro que **não foram observados nem confirmados no servidor**. Kick é apenas uma hipótese numérica, não uma reintegração ao Controller.

O cenário usa o modelo de espécie/Ultra/Beast e a taxa de bolas aceitas do próprio Atlas; para raros, parte da probabilidade já ajustada pelo tier Outland. Exibe também a probabilidade complementar de **nenhuma ocorrência em 24h** e utiliza mais casas decimais para chances muito pequenas. **Não altera rankings, medições reais, bônus usados automaticamente, automações nem os cálculos padrão**, e não consulta a rede. Quando faltar chance, ritmo ou elegibilidade do shiny na Outland, permanece **—**. Os detalhes e a comparação de funcionalidades estão em [PokeIdle Tools vs HuntAtlas](../docs/references/pokeidle-tools/HUNTATLAS_COMPARISON.md). Os simuladores XP/moedas, IV e DPS anunciados no site externo ainda não estão implementados nele.

### Rankings, detalhes compactos e desempenho (v1.9.9 · Marco F)

O **Top 5 agora acompanha a métrica selecionada** — XP do treinador, Moedas por abate, valor esperado de loot NPC, item raro/h (escolha o item e a prévia do tier Outland), capturas/h ou shinies capturados/h. Uma hunt excelente em XP não lidera automaticamente uma pesquisa de raros. Valores indisponíveis ficam no fim e **não viram zero**. A ordenação também respeita os filtros de busca, fraqueza, tipo e desbloqueio. Em capturas, é o resultado do **Pokémon alvo correspondente ao filtro**, com Ultra como padrão e Beast opcional, não uma porcentagem genérica da região.

A lista de hunts está mais compacta. **Clique em “Detalhes da hunt”** para ver K/h, XP/h dos dois canais, economia, chance de captura, previsão de shiny, item raro escolhido, fonte e confiança. O painel geral de economia/captura/raros também fica recolhido por padrão, com um diagnóstico **opcional e somente local**, sem mensagens brutas ou tokens. O botão **Top 5** continua independente.

**Performance:** as medições de eventos continuam independentes da interface. Com o mapa fechado ou nativo, o Atlas não repinta a lista nem faz uma leitura pesada do Controller Bridge a cada 3 segundos. Quando visível, repinturas de eventos são agrupadas (intervalo mínimo de 1,5 s) e a atualização passiva é muito menos frequente (12 s). Os caches, amostras e janelas são limitados. O resultado real de CPU/RAM em sessões longas permanece para verificar no jogo, assim como os bônus e a fórmula de captura do servidor.

Detalhes: [Marco F](../docs/HUNTATLAS_MILESTONE_F.md).

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

### Farming measurements (v1.9.4 · Milestone A)

**Measured** XP/h now requires **6 wild kills and 60 seconds** within the current session. The denominator is **wall-clock time**, including waves and temporary downtime; after 2 minutes without a kill the reading is stale, and the next kill begins warming up again. Switching hunts, reconnecting/reloading or changing the relevant lead/loadout/context prevents incompatible reuse. Trainer XP, Pokémon XP, kill Coins and already-realized auto-NPC-sale Coins are recorded separately. `bola`, `capturado`, `cura`, `revive` and boss events have distinct local ledgers rather than counting automation clicks as accepted throws.

The UI shows a **warming up** label until enough sustained evidence exists. `window.__mothHuntAtlasExperimentV1.snapshot().farmingEvidence` exposes only allowlisted field-name counts and totals, **never** raw packets or tokens. Live protocol ambiguity remains; see the [technical matrix and limitations](../docs/HUNTATLAS_MILESTONE_A_PROTOCOL.md). The deterministic Outland, Shiny Egg and probability helpers lay groundwork for later releases; this does **not** add an Outland tier picker or capture-rate predictor.

### XP/h forecasts (v1.9.5 · Milestone B)

- **Trainer and active Pokémon XP are independent channels.** Missing values stay unknown, never replaced with the other channel or combined as one training rate.
- **Unvisited hunts use explicitly UNBOOSTED XP estimates** until the actual server bonus stacking is verified. Old VIP, guild, stream, event and catch-up multipliers are no longer extrapolated.
- **Context-specific calibration:** exact lead, level, stats/Speed IV, move information, TMs/Mega, hunt, bonuses and catalog revision matter. A forecast frozen *before* sustained measurements can later be evaluated against the observed result from that hunt. Error samples are session-local, bounded and expire after 90 minutes.
- A model-only Top 5 leader is marked a **leading candidate (uncertain)**. Source, coverage and a **heuristic** range—not a statistical confidence interval—are displayed. Close uncertain estimates do not automatically outrank reliable measured ones.
- Speed IV/cooldown formulas have deterministic fixtures, but live move scheduling and native XP bonuses are **not yet server-verified**. Read the [Milestone B technical notes](../docs/HUNTATLAS_MILESTONE_B.md).

### Farming economy (v1.9.6 · Milestone C)

Hunt Atlas now estimates **kill Coins/hour** with the proper level-25,000 cap and uses real wild-kill receipts whenever a representative current-session window exists. You can sort by **kill Coins/hour**, separately from the XP rank; net Coins/hour remains visible in economic details.

The XP details include four distinct measures: kill Coins/h, ordinary NPC-resellable **loot expected value/h**, **realized** Coins/h (native kill receipts and one occurrence of auto NPC resale), and **net Coins/h** after replacement cost of actually consumed supplies. Unsold drops and potential listings are never counted as already realized Coins. Costs require explicit game catalog prices; unknown prices leave net unavailable, and Diamonds remain separate. When inventory quantity is known, the panel estimates remaining stock coverage.

Ordinary loot is derived from a **reconstructed shared-upstream catalog**, not a server-certified final loot table. Incomplete NPC eligibility or price coverage yields **—**, not a made-up number. See the [economy contract and live-validation limits](../docs/HUNTATLAS_MILESTONE_C.md). No extra continuous shop polling or automatic selling was added.

### Outland and rare drops (v1.9.7 · Milestone D)

- **Compare Outland 1–8** is a **read-only preview**, even while hunting elsewhere. The active in-game tier is separate and shown only if explicitly reported by game state. Locked tiers disclose their trainer-level gate, without phantom maps.
- **Use this tier in game** appears only when the game exposes its current tier, you have the required level, and the socket is connected. Atlas sends the documented native `outland.tier` command but **does not claim success** until a subsequent game-state update confirms the tier. Real-server protocol/cooldown behavior still needs owner-led verification.
- Bronze Boss Token, Key Fragment, Shiny Stone Fragment and Bicycle Fragment each show **per-kill %, units/hour, mean hours for one/ten fragments and chance of ≥1 within 1h/24h**. The Bicycle drop hook remains **wiki-reported and server-unverified**.
- **Shiny Egg Fragments** follow the exact fixed 30-level ladder in eligible non-Outland hunts. Ten fragments craft an egg; a separate 168-hour incubation follows. Outland never receives these egg drops.
- All probabilities are **unboosted expectations, not guarantees**. Real observed drops remain separate from projections, and another preview tier cannot borrow the active tier's drop totals. Market prices show **—** until verified completed-sale evidence exists; no buying/selling is added.
- See the [Milestone D contract](../docs/HUNTATLAS_MILESTONE_D.md) for evidence and limitations.

### Capture, Ultra/Beast and shiny planning (v1.9.8 · Milestone E)

**Ultra Ball ×4 is the default**, with **Beast Ball ×8 as an option**, keeping Diamonds separate from Coins. Each hunt species now shows its **conditional Ultra/Beast success chance**, **estimated captures/hour for that target** and **target shiny catches/hour** weighted by encounter prevalence. Sort by target **captures/hour** or **shiny catches/hour** using your selected ball.

In the **Catch and shiny planner**, switching Ultra/Beast or simulating **Shiny Secret Lure ×2** (explicitly hypothetical, **not** inferred as active) updates expected captures/hour, shinies seen/hour vs actually caught/hour, mean wait for a shiny catch and probability of one or more in 24 hours. Shiny is rolled **per eligible accepted ball, not per kill** (1/24,000 normal), and a seen shiny can still fail its capture roll. Beast need not double Ultra's odds near the 10% cap.

**Measured throughput** is based on correlated `morte`, accepted `bola` and confirmed `capturado` server events, requiring at least six kills and 60 seconds. For unvisited hunts, estimates are explicitly **ceilings conditional on one accepted ball per fallen body**, not guarantees that automation will reach that rate. Missing trustworthy species economic rarity yields an unknown chance, never the Pokémon's sale/listing price. This is the **wiki-conditional capture equation, not a deployed-server-verified formula**. Outland shiny eligibility stays unknown; Mystic Arena has a separate ticket-gated capture table.

Read the [technical contract, tests and limitations](../docs/HUNTATLAS_MILESTONE_E.md). No automatic buying or changes to Auto Catch+ were introduced.

### Meaningful rankings, compact details and performance (v1.9.9 · Milestone F)

**Top Five now follows your chosen metric**: trainer XP, kill Coins, NPC loot expected value, selected rare item/hour (choose both the item and the preview Outland tier), target captures/hour, shiny catches/hour or fewest Ultra Coins per expected capture. An XP-heavy hunt can no longer lead an unrelated rare-item list. Missing values rank last **without being treated as zero**. Existing search, weakness, type, collection and unlock filters still apply. Capture recommendations rank the **matching target species**, with Ultra by default or Beast when selected.

Hunt rows are now compact: expand **Hunt details** to see K/h, the two XP channels, economics, target capture/shiny chances, selected rare units, source and confidence. The main capture/economy/rare sections are also collapsed by default; an optional **local-only** diagnostics toggle reveals safe aggregate evidence, never full packets or tokens. The separate Top Five toggle remains.

**Performance:** accepted-event recording is independent of the visual panel. Closed/native-map/headless sessions no longer redraw the full list or parse heavyweight controller snapshots every three seconds. Visible redraws are coalesced (at least 1.5 seconds apart), while the passive refresh is every 12 seconds or more. All histories remain bounded. Actual four-profile CPU/RAM and live probability/bonus semantics still need owner testing.

See the [Milestone F implementation details](../docs/HUNTATLAS_MILESTONE_F.md).

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
