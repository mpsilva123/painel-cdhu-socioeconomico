# Painel CDHU · Pesquisa Socioeconômica

Painel online da **Avaliação Socioeconômica CDHU** (formulário Kobo `0772`). Ele mostra o perfil das famílias, as condições da moradia e os indicadores de **precariedade habitacional**, **vulnerabilidade social** e **risco social**, além de um **mapa de incidência por município**.

- **Dados:** API do KoboToolbox (`kf.kobotoolbox.org`, asset `azVZhQG6BNYi9hoJxM5BfK`)
- **Atualização:** automática **a cada hora** (GitHub Actions) e manual pelo botão *Run workflow*
- **Hospedagem:** GitHub Pages (site estático, sem servidor)
- **Identidade visual:** Manual de Marca CDHU 2024. Vermelho `#FF1100`, preto e cinza institucional; Poppins e Source Sans 3 substituem Axiforma e Myriad na web.

## Como funciona

```
KoboToolbox API ──(a cada hora)──► GitHub Actions ──► scripts/build_data.py
                                                     │  • baixa submissões + rótulos do formulário
                                                     │  • remove dados pessoais
                                                     ▼
                                    docs/data/data.json + malha IBGE ──► GitHub Pages
```

O navegador agrega os dados localmente. Por isso, os filtros (município, órgão, posse, tipo de moradia e período) respondem na hora.

## Configuração (uma vez)

1. **Token do Kobo.** No Kobo, abra *Account Settings → Security → API Key* e copie o token.
2. **Secret no GitHub.** No repositório, vá em *Settings → Secrets and variables → Actions → New repository secret*. Use o nome `KOBO_TOKEN` e cole o token como valor.
3. **Pages.** Em *Settings → Pages → Build and deployment*, escolha **Source: GitHub Actions**.
4. **Primeira atualização.** Vá em *Actions → "Atualizar painel" → Run workflow*. Daí em diante, a atualização é automática a cada hora.

Variáveis opcionais, em *Settings → Variables*:

| Variável | Padrão | Uso |
|---|---|---|
| `KOBO_SERVER` | `https://kf.kobotoolbox.org` | servidor Kobo |
| `KOBO_ASSET_UID` | `azVZhQG6BNYi9hoJxM5BfK` | formulário |
| `SALARIO_MINIMO` | `1621` | base das faixas de renda em SM |

## Privacidade (LGPD)

O formulário coleta nome, CPF, RG, NIS, telefone, e-mail e endereço. **Nada disso é publicado.** O script `build_data.py` descarta esses campos antes de gerar o JSON. Também ficam de fora os nomes dos técnicos e os anexos. O que vai para o site são apenas variáveis categóricas, contagens, idades e renda.

Mesmo assim, em municípios com pouquíssimas famílias, cruzar filtros poderia permitir identificar alguém. Por isso, quando uma seleção tem menos de **3 famílias**, o painel oculta os detalhes e mostra os percentuais por município como "—". Esse limite fica em `docs/assets/config.js` (`minFamiliasDetalhe`).

> **Atenção:** um site do GitHub Pages é público, inclusive quando o repositório é privado (em planos pagos). Se o painel precisar ser restrito, use GitHub Enterprise com Pages privado ou outra hospedagem com login.

## Rodar localmente

```bash
# a partir de um export do Kobo (XLSX, "XML values and headers")
python scripts/build_data.py --xlsx export.xlsx
# ou direto da API
KOBO_TOKEN=xxxx python scripts/build_data.py
python -m http.server -d docs 8000   # abrir http://localhost:8000
```

## Estrutura

```
docs/                 site publicado
  index.html
  assets/app.js       agregações, gráficos (Chart.js 4) e mapa SVG
  assets/style.css    identidade visual CDHU
  assets/config.js    parâmetros editáveis (privacidade, rodapé, auto-refresh)
  data/data.json      gerado automaticamente (anonimizado)
scripts/build_data.py coleta Kobo → JSON
.github/workflows/    agendamento horário + deploy no Pages
```

## Observações

- **Rótulos dos critérios.** Os textos de precariedade, vulnerabilidade e risco são lidos do próprio formulário Kobo, na nota que contém `${calc_...}`. Os rótulos de reserva em `build_data.py` só aparecem se a API não trouxer o texto.
- **Municípios no mapa.** O nome digitado é comparado com a malha do IBGE, ignorando acentos e maiúsculas. Grafias que não casam (ex.: "São Pabla") aparecem na nota abaixo do mapa e com `*` na tabela. Basta corrigir no Kobo.
- **Agendamento.** O GitHub pode atrasar execuções agendadas em alguns minutos. Repositórios sem atividade por 60 dias têm o agendamento pausado; o job `keepalive` evita isso.
