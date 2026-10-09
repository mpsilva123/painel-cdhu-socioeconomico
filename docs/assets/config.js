/* Configurações do painel — edite aqui sem mexer no código principal. */
window.PAINEL_CONFIG = {
  // Arquivo gerado a cada hora pelo GitHub Actions a partir do Kobo
  dataUrl: "data/data.json",
  geoUrl: "data/sp_municipios.geojson",
  // Reserva: malha do IBGE direto no navegador, se o arquivo local faltar
  geoFallbackUrl:
    "https://servicodados.ibge.gov.br/api/v3/malhas/estados/35?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio",
  geoNamesUrl: "https://servicodados.ibge.gov.br/api/v1/localidades/estados/35/municipios",

  // Proteção de privacidade: quando um filtro deixa menos famílias que isto,
  // os gráficos de detalhe ficam ocultos (evita identificar famílias em
  // municípios pequenos). Use 1 para desativar.
  minFamiliasDetalhe: 3,

  // Recarrega os dados enquanto a página estiver aberta (minutos)
  autoRefreshMin: 15,

  // Texto do rodapé (a data de geração é adicionada automaticamente)
  rodape: "Base inclui registros de teste — gerado em",
};
