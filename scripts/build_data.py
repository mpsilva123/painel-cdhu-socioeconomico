#!/usr/bin/env python3
"""
Gera docs/data/data.json para o painel a partir do KoboToolbox.

Modos
-----
1) API Kobo (usado pelo GitHub Actions, a cada hora):
     KOBO_TOKEN=xxxx KOBO_ASSET_UID=azVZhQG6BNYi9hoJxM5BfK python scripts/build_data.py
2) Arquivo exportado do Kobo (.xlsx, "XML values and headers"), para testes locais:
     python scripts/build_data.py --xlsx caminho/arquivo.xlsx

Privacidade
-----------
Nenhum dado pessoal é publicado: nomes, CPF, RG, NIS, telefones, e-mails,
endereço (logradouro, número, complemento, bairro), nomes de técnicos e
anexos são descartados aqui, antes de qualquer coisa ir para o repositório.
Ficam só variáveis categóricas, contagens, idades e renda.

Também baixa (uma única vez) a malha dos municípios de SP do IBGE para o mapa.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "data"
DATA_FILE = OUT_DIR / "data.json"
GEO_FILE = OUT_DIR / "sp_municipios.geojson"

KOBO_SERVER = os.environ.get("KOBO_SERVER", "https://kf.kobotoolbox.org").rstrip("/")
KOBO_ASSET_UID = os.environ.get("KOBO_ASSET_UID", "azVZhQG6BNYi9hoJxM5BfK")
KOBO_TOKEN = os.environ.get("KOBO_TOKEN", "")
SALARIO_MINIMO = float(os.environ.get("SALARIO_MINIMO", "1621"))
TZ = dt.timezone(dt.timedelta(hours=-3))  # America/Sao_Paulo

# --------------------------------------------------------------------------
# Critérios CDHU (campos calculados do formulário -> nº do critério)
# Os rótulos abaixo são reserva; quando há acesso à API, o texto oficial
# é lido das notas do próprio formulário (campo que contém ${calc_...}).
# --------------------------------------------------------------------------
PRECARIEDADE = [
    (1, "calc_casa_frente_fundos", "Casa frente-fundos"),
    (2, "calc_reside_cortico", "Cortiço"),
    (3, "calc_pensao_hotel", "Pensão ou hotel"),
    (4, "calc_acesso_viela", "Acesso por viela, beco ou escadaria"),
    (5, "calc_fossa_rudimentar", "Esgoto em fossa rudimentar"),
    (6, "calc_vala_ceu_aberto", "Esgoto em vala a céu aberto"),
    (7, "calc_sem_banheiro_esgoto", "Sem banheiro ou esgotamento"),
    (8, "calc_parede_precaria", "Parede de material precário"),
    (9, "calc_desmoronamento", "Desmoronamento"),
    (10, "calc_inundacao", "Inundação ou enchente"),
    (11, "calc_interdicao", "Moradia interditada"),
    (12, "calc_sem_abertura", "Cômodos sem abertura externa"),
]
VULNERABILIDADE = [
    (1, "calc_transferencia_renda", "Beneficiária de transferência de renda"),
    (2, "calc_vulnerabilidade_2", "Mulher responsável sem cônjuge, com dependentes"),
    (3, "calc_vulnerabilidade_3", "Pessoa idosa que mora só, renda até 1 SM"),
    (4, "calc_vulnerabilidade_4", "2+ pessoas, renda per capita até ½ SM"),
    (5, "calc_vulnerabilidade_5", "2+ pessoas com idoso/PcD, renda até ½ SM"),
    (6, "calc_vulnerabilidade_6", "Renda per capita até ½ SM"),
    (7, "calc_vulnerabilidade_7", "Com pessoa idosa ou com deficiência"),
    (8, "calc_vulnerabilidade_8", "Pessoa só, idosa ou PcD, renda até 1 SM"),
    (9, "calc_vulnerabilidade_9", "Critério 9 de vulnerabilidade"),
]
RISCO_CHOICES = [
    (1, "Mulher_chefe_de_família_sob_medida_pr", "Mulher chefe de família sob medida protetiva"),
    (2, "Família_com_pessoas_em_situações_de_m", "Pessoas em situação de maus-tratos"),
    (3, "Família_com_pessoas_menores_de_18_ano", "Menores de 18 anos em situação de risco"),
    (4, "Família_com_crianças_menores_de_14_an", "Crianças menores de 14 anos em situação de risco"),
    (5, "Outras_situações.", "Outras situações"),
]

# Rótulos de reserva para as escolhas (valores XML -> texto)
FALLBACK_LABELS = {
    "Invadia_/_Ocupada": "Invadida / Ocupada",
    "Própria_de_algum_residente_atual": "Própria (de morador)",
    "casa_frente-fundos": "Casa frente-fundos",
    "cortico": "Cortiço",
    "Casa_isolada_no_lote_(inclui_casa_de": "Casa isolada no lote",
    "Apartamento_em_conjunto_habitacional": "Apto. em conjunto habitacional",
    "Apartamento_em_prédio_isolado_ou_em_c": "Apto. em prédio isolado",
    "Casa_em_conjunto_habitacional_popular": "Casa em conjunto habitacional",
    "Viela,_beco,_escadaria,_pinguela": "Viela, beco, escadaria ou pinguela",
    "Rede_pública_geral_de_esgoto_ou_pluvi": "Rede pública de esgoto",
    "Vala_a_céu_aberto,_direto_em_rio,_cór": "Vala a céu aberto / córrego",
    "Rede_construída_pelos_moradores": "Rede feita pelos moradores",
    "Todas_de_tijolo_ou_material_pré-fabri": "Tijolo / pré-fabricado",
    "Todas_ou_parte_de_madeirit_/_aglomera": "Madeirite / aglomerado",
    "Sim,_com_uma_unidade_habitacional,_lo": "Sim, com unidade habitacional",
    "Remoção_devido_a_execução_de_obra_púb": "Remoção por obra pública",
    "Remoção_de_área_de_risco_ou_calamidad": "Remoção de área de risco",
    "Assalariado(a)_com_registro_1": "Assalariado(a) com registro",
    "Assalariado(a)_sem_registro_1": "Assalariado(a) sem registro",
    "Autônomo(a)_com_registro_(MEI_ou_INSS": "Autônomo(a) com registro",
    "Beneficiário(a)_do_BPC_(Benefício_de_1": "BPC",
    "Cônjuge/companheiro(a)_de_sexo_difere": "Cônjuge / companheiro(a)",
    "Demanda_passível_de_acolhimento.": "Passível de acolhimento",
}


def pretty(value: str | None) -> str | None:
    """Rótulo legível para um valor XML de escolha."""
    if value is None:
        return None
    v = str(value)
    if v in FALLBACK_LABELS:
        return FALLBACK_LABELS[v]
    v = v.replace("_", " ").strip()
    v = re.sub(r"^\d+\.\s*", "", v)
    v = v.rstrip(".")
    return v[:1].upper() + v[1:] if v else v


def norm_key(s: str | None) -> str:
    """Normaliza nome de município para casar com a malha do IBGE."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def http_json(url: str, token: str | None = None, timeout: int = 120):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    if token:
        req.add_header("Authorization", f"Token {token}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# --------------------------------------------------------------------------
# Leitura das submissões
# --------------------------------------------------------------------------
def strip_groups(rec: dict) -> dict:
    """A API devolve chaves com caminho de grupo (grupo/sub/campo). Fica só o campo."""
    out = {}
    for k, v in rec.items():
        key = k if k.startswith("_") and "/" not in k else k.split("/")[-1]
        if isinstance(v, list) and v and isinstance(v[0], dict):
            v = [strip_groups(x) for x in v]
            key = k.split("/")[-1]
        out[key] = v
    return out


def load_from_api() -> tuple[list[dict], dict]:
    asset = http_json(f"{KOBO_SERVER}/api/v2/assets/{KOBO_ASSET_UID}/?format=json", KOBO_TOKEN)
    rows, url = [], f"{KOBO_SERVER}/api/v2/assets/{KOBO_ASSET_UID}/data/?format=json&limit=1000"
    while url:
        page = http_json(url, KOBO_TOKEN)
        rows.extend(page.get("results", []))
        url = page.get("next")
    recs = []
    for r in rows:
        r = strip_groups(r)
        members = None
        for k, v in r.items():  # o grupo de repetição é a lista de dicts
            if isinstance(v, list) and v and isinstance(v[0], dict) and "q4_4_sexo" in v[0]:
                members = v
        r["_members"] = members or []
        recs.append(r)
    return recs, asset


def load_from_xlsx(path: str) -> tuple[list[dict], dict]:
    import openpyxl  # só necessário no modo local

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    main, rep = wb.worksheets[0], wb["rep"]

    def sheet_dicts(ws):
        it = ws.iter_rows(values_only=True)
        header = [str(h) for h in next(it)]
        return [dict(zip(header, row)) for row in it]

    recs = sheet_dicts(main)
    by_parent: dict[str, list] = {}
    for m in sheet_dicts(rep):
        by_parent.setdefault(str(m.get("_submission__id")), []).append(m)
    for r in recs:
        r["_members"] = by_parent.get(str(r.get("_id")), [])
    return recs, {}


# --------------------------------------------------------------------------
# Rótulos oficiais a partir do formulário (quando disponível)
# --------------------------------------------------------------------------
def first_label(row: dict) -> str | None:
    lab = row.get("label")
    if isinstance(lab, list):
        lab = next((x for x in lab if x), None)
    return lab


def labels_from_asset(asset: dict):
    content = (asset or {}).get("content") or {}
    survey, choices = content.get("survey", []), content.get("choices", [])
    field_list = {}
    for row in survey:
        name = row.get("name") or row.get("$autoname")
        if name and row.get("select_from_list_name"):
            field_list[name] = row["select_from_list_name"]
    choice_labels: dict[str, dict[str, str]] = {}
    for c in choices:
        lab = first_label(c)
        if lab:
            nm = c.get("name") or c.get("$autoname")
            choice_labels.setdefault(c.get("list_name"), {})[str(nm)] = clean_md(lab)
    by_field = {f: choice_labels.get(l, {}) for f, l in field_list.items()}

    def crit_label(calc: str) -> str | None:
        for row in survey:
            lab = first_label(row) or ""
            if "${" + calc + "}" in lab:
                t = re.sub(r"\$\{[^}]+\}", "", clean_md(lab))
                t = re.sub(r"^\s*\d+\s*[\.\)\-–]\s*", "", t).strip(" :;-–.")
                return t or None
        return None

    return by_field, crit_label, (asset or {}).get("name")


def clean_md(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", str(s))
    s = re.sub(r"[*_#`]{1,3}", "", s)
    return re.sub(r"\s+", " ", s).strip()


# --------------------------------------------------------------------------
# Transformação -> registros anonimizados
# --------------------------------------------------------------------------
def yes(v) -> bool:
    return str(v).strip().lower() in ("sim", "yes", "true", "1", "1.0")


def num(v):
    try:
        if v is None or v == "":
            return None
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def multi(v) -> list[str]:
    return [x for x in str(v).split() if x] if v not in (None, "") else []


def escolaridade(v) -> str:
    s = str(v or "")
    if not s or "Sem_informa" in s:
        return "Sem informação"
    if "0_a_6" in s:
        return "Não se aplica (0–6 anos)"
    if s.startswith("Nenhuma"):
        return "Sem instrução"
    if "Superior_completo" in s:
        return "Superior completo"
    if "Superior_incompleto" in s:
        return "Superior incompleto"
    m = re.match(r"(\d)[ºª]_(Ano|Série)_do_E\.(F|M)", s)
    if m:
        n, _, nivel = int(m.group(1)), m.group(2), m.group(3)
        if nivel == "F":
            return "Fundamental completo" if n >= 9 else "Fundamental incompleto"
        return "Médio completo" if n >= 3 else "Médio incompleto"
    return pretty(s)


def faixa_etaria(idade) -> str | None:
    if idade is None:
        return None
    i = int(idade)
    for lim, lab in [(17, "0–17"), (29, "18–29"), (39, "30–39"), (49, "40–49"), (59, "50–59")]:
        if i <= lim:
            return lab
    return "60+"


def build(recs: list[dict], asset: dict) -> dict:
    by_field, crit_label, form_name = labels_from_asset(asset)

    def lab(field: str, value):
        if value in (None, ""):
            return None
        v = str(value)
        return by_field.get(field, {}).get(v) or pretty(v)

    prec_labels = {n: (crit_label(c) or fb) for n, c, fb in PRECARIEDADE}
    vuln_labels = {n: (crit_label(c) or fb) for n, c, fb in VULNERABILIDADE}
    risco_labels = {n: (by_field.get("situacoes_risco_social", {}).get(c) or fb) for n, c, fb in RISCO_CHOICES}

    out = []
    for r in recs:
        members = r.get("_members") or []
        resp = next((m for m in members if str(m.get("q4_3_posicao_morador", "")).startswith("Pessoa_respons")), None)
        resp = resp or (members[0] if members else {})
        moradores = int(num(r.get("total_moradores")) or len(members) or 0)
        renda = num(r.get("total"))
        if renda is None:
            renda = sum(num(m.get("renda_total_individual")) or 0 for m in members)
        sub = str(r.get("_submission_time") or r.get("end") or "")[:10]

        mem_out = []
        for m in members:
            idade = num(m.get("calc_idade"))
            mem_out.append({
                "sx": "F" if str(m.get("q4_4_sexo")).startswith("F") else "M",
                "id": int(idade) if idade is not None else None,
                "pcd": yes(m.get("q4_6_possui_deficiencia")),
                "def": [lab("q4_6_1_qual_deficiencia", x) for x in multi(m.get("q4_6_1_qual_deficiencia"))],
                "esc": escolaridade(m.get("q4_8_3_ultima_serie_concluida")),
                "trab": lab("q4_9_condicao_trabalho", m.get("q4_9_condicao_trabalho")),
                "fonte": lab("q4_10_2_fonte_rendimento_princ", m.get("q4_10_2_fonte_rendimento_princ")) if yes(m.get("q4_10_tem_rendimento_princ")) else None,
                "pos": lab("q4_3_posicao_morador", m.get("q4_3_posicao_morador")),
            })

        flag = lambda calc: yes(r.get(calc))
        risco = []
        if yes(r.get("existe_risco_social")):
            sel = multi(r.get("situacoes_risco_social"))
            risco = [n for n, c, _ in RISCO_CHOICES if c in sel]

        idade_resp = num(resp.get("calc_idade"))
        out.append({
            "dt": sub,
            "mun": (str(r.get("q2_7_municipio") or "").strip() or "Não informado"),
            "org": (str(r.get("orgao_tecnico") or "").strip() or "Não informado"),
            "uso": lab("q2_9_uso_edificacao", r.get("q2_9_uso_edificacao")),
            "mor": moradores,
            "renda": round(renda, 2) if renda is not None else None,
            "rpc": round(renda / moradores, 2) if renda is not None and moradores else None,
            "alug": num(r.get("q5_1_1_valor_aluguel")),
            "posse": lab("q5_1_situacao_moradia", r.get("q5_1_situacao_moradia")),
            "tipo": lab("q5_2_tipo_moradia", r.get("q5_2_tipo_moradia")),
            "acesso": lab("q5_4_acesso_moradia", r.get("q5_4_acesso_moradia")),
            "esgoto": lab("q5_5_esgoto_banheiro_escoado", r.get("q5_5_esgoto_banheiro_escoado")),
            "agua": lab("q5_6_tem_cavalete", r.get("q5_6_tem_cavalete")),
            "energia": lab("q5_7_tem_poste_energia", r.get("q5_7_tem_poste_energia")),
            "parede": lab("q5_9_material_parede_externa", r.get("q5_9_material_parede_externa")),
            "inst": {k: yes(r.get(f)) for k, f in [
                ("Caixa d'água", "q5_8_1_tem_caixa_dagua"), ("Lavatório", "q5_8_2_tem_lavatorio"),
                ("Vaso sanitário", "q5_8_3_tem_vaso_sanitario"), ("Tanque", "q5_8_4_tem_tanque"),
                ("Pia", "q5_8_5_tem_pia"), ("Chuveiro", "q5_8_6_tem_chuveiro")]},
            "com": int(num(r.get("calc_total_comodos")) or 0),
            "dorm": int(num(r.get("q5_11_qdt_comodos_dormir")) or 0),
            "compart": yes(r.get("q5_13_1_compartilha_cozinha")) or yes(r.get("q5_13_2_compartilha_banheiro")),
            "entorno": {k: yes(r.get(f)) for k, f in [
                ("Sofreu desmoronamento", "q5_14_1_sofreu_desmoronamento"),
                ("Sofreu inundação/enchente", "q5_14_2_sofreu_inundacao_enche"),
                ("Via sem guia/sarjeta", "q5_14_3_via_sem_guia_sarjeta"),
                ("Via sem pavimentação", "q5_14_4_via_sem_pavimentacao"),
                ("Próxima a lixão", "q5_14_5_moradia_proxima_lixao"),
                ("Em APP", "q5_14_6_moradia_localizada_app")]},
            "trabMor": yes(r.get("q5_17_trabalho_na_moradia")),
            "progHab": not str(r.get("q6_1_atendimento_programa_habi") or "Não").startswith("Não"),
            "auxMor": yes(r.get("q6_2_recebe_auxilio_moradia")),
            "parecer": lab("parecer_tecnico_preliminar", r.get("parecer_tecnico_preliminar")),
            "prec": [n for n, c, _ in PRECARIEDADE if flag(c)],
            "vuln": [n for n, c, _ in VULNERABILIDADE if flag(c)],
            "risco": risco,
            "resp": {
                "sx": "F" if str(resp.get("q4_4_sexo", "")).startswith("F") else "M",
                "id": int(idade_resp) if idade_resp is not None else None,
                "fx": faixa_etaria(idade_resp),
                "ec": lab("q3_11_a_estado_civil_resp", resp.get("q3_11_a_estado_civil_resp")),
                "esc": escolaridade(resp.get("q4_8_3_ultima_serie_concluida")),
                "migr": str(resp.get("q3_23_onde_morava") or "").startswith("Em_outro"),
            },
            "m": mem_out,
        })

    out.sort(key=lambda x: x["dt"])
    return {
        "gerado_em": dt.datetime.now(TZ).strftime("%Y-%m-%dT%H:%M:%S%z"),
        "fonte": f"KoboToolbox · {form_name or 'Questionário de Avaliação Socioeconômica'}",
        "salario_minimo": SALARIO_MINIMO,
        "criterios": {
            "prec": {str(k): v for k, v in prec_labels.items()},
            "vuln": {str(k): v for k, v in vuln_labels.items()},
            "risco": {str(k): v for k, v in risco_labels.items()},
        },
        "registros": out,
    }


# --------------------------------------------------------------------------
# Malha municipal de SP (IBGE) para o mapa — baixada uma vez e versionada
# --------------------------------------------------------------------------
def round_coords(c, nd=3):
    if isinstance(c, (int, float)):
        return round(c, nd)
    return [round_coords(x, nd) for x in c]


def ensure_geojson():
    if GEO_FILE.exists() and GEO_FILE.stat().st_size > 10_000:
        return
    try:
        nomes = {str(m["id"]): m["nome"] for m in http_json(
            "https://servicodados.ibge.gov.br/api/v1/localidades/estados/35/municipios")}
        gj = http_json("https://servicodados.ibge.gov.br/api/v3/malhas/estados/35"
                       "?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio")
        for f in gj["features"]:
            cod = str(f["properties"].get("codarea"))
            f["properties"] = {"cod": cod, "nome": nomes.get(cod, cod)}
    except Exception as e:  # reserva: repositório público geodata-br
        print("IBGE indisponível, usando geodata-br:", e, file=sys.stderr)
        gj = http_json("https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-35-mun.json")
        for f in gj["features"]:
            p = f["properties"]
            f["properties"] = {"cod": str(p.get("id")), "nome": p.get("name")}
    for f in gj["features"]:
        f["geometry"]["coordinates"] = round_coords(f["geometry"]["coordinates"])
    GEO_FILE.write_text(json.dumps(gj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Malha municipal salva: {len(gj['features'])} municípios")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", help="arquivo exportado do Kobo (modo local)")
    ap.add_argument("--skip-geo", action="store_true")
    a = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if a.xlsx:
        recs, asset = load_from_xlsx(a.xlsx)
    else:
        if not KOBO_TOKEN:
            sys.exit("Defina KOBO_TOKEN (secret do repositório) ou use --xlsx.")
        recs, asset = load_from_api()

    data = build(recs, asset)
    DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"data.json: {len(data['registros'])} famílias")
    if not a.skip_geo:
        ensure_geojson()


if __name__ == "__main__":
    main()
