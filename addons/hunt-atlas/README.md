# PokéIdle Hunt Atlas (experimental)

This is the **premium experiment**, separate from the Hunt Atlas shipped through `pokeidle-addons`. Changes are not synchronized automatically. It replaces PokéIdle's **Map** view with a searchable hunt/Pokémon list—not a graphical map.

![Hunt Atlas preview](assets/map-preview.png)

## Português (Brasil)

### Instalação

1. Entre no GitHub com acesso ao repositório privado e abra [hunt-atlas.user.js](hunt-atlas.user.js).
2. Copie o código para um novo script do Violentmonkey ou Tampermonkey.
3. **Desative qualquer outra cópia do Hunt Atlas** neste perfil para evitar conflito com o mapa e os hooks do jogo.
4. Recarregue [PokéIdle](https://pokeidle.io/app) e abra **Mapa**.

A instalação e as atualizações são **manuais**: o repositório privado não oferece atualização automática autenticada para o gerenciador de userscripts.

### Recursos

- Busca por Pokémon, hunt e região; filtros por nível, disponibilidade, tipos, fraquezas e capturados.
- Ordenação e Top 5 conforme o objetivo escolhido, com botão **Ir** para hunts disponíveis.
- Recomendações de XP/h com **medição da sessão** quando há dados suficientes e projeções sinalizadas quando não há.
- Economia de farming: Moedas por abate, valor esperado dos drops NPC, receita confirmada e custos de reposição, sem misturar valores realizados e projetados.
- Comparação de Outland 1–8, previsões de drops raros e fragmentos, captura com Ultra/Beast Ball e estimativas de shiny.
- Bônus de XP detectados no estado do jogo separados das **simulações opcionais** de bônus de captura/drops.

Abra **Detalhes da hunt** para consultar fontes, cobertura e incertezas. O Atlas prioriza taxas medidas; previsões com dados faltando não são garantias. Fórmulas da wiki, drops e alguns campos do servidor ainda podem exigir validação no jogo. O experimento não compra bolas, não vende itens e não altera o Auto Catch+.

### Diagnóstico e testes

Para examinar um resumo local dos eventos de farming, execute no console:

```js
window.__mothHuntAtlasExperimentV1.snapshot()
```

Não há envio automático desse resumo. Funcionamento visual, precisão em jogo e consumo de CPU/RAM exigem observação em uma sessão real. Veja os [documentos técnicos](../../docs/README.md).

## English

### Installation

1. Sign into GitHub with access to this private repository and open [hunt-atlas.user.js](hunt-atlas.user.js).
2. Copy its source into a new Violentmonkey or Tampermonkey userscript.
3. **Disable any other Hunt Atlas copy** in the same profile to avoid duplicate map/WebSocket hooks.
4. Reload [PokéIdle](https://pokeidle.io/app) and open **Map**.

Updates are manual; private repository files are not a reliable unauthenticated userscript update feed.

### Features and limits

Hunt Atlas provides Pokémon/hunt/region search; filters for level, availability, type, weaknesses and collection; objective-specific sorting and Top 5 recommendations; and navigation to accessible hunts.

Its detail panels distinguish **measured** from **modeled** trainer XP/hour, farming income and costs, Outland rare-drop estimates, Ultra/Beast catch and shiny projections, and detected XP bonuses versus hypothetical bonus simulations. Missing evidence remains unknown rather than being presented as a certain rate. The addon does not purchase supplies or change Auto Catch+.

For local diagnostics, run `window.__mothHuntAtlasExperimentV1.snapshot()` in the browser console. Live-game/Firefox validation is needed for performance and model accuracy. See the [technical references](../../docs/README.md).
