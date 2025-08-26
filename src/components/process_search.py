import streamlit as st
import re
from src.services.api_predictus import PredictusAPI
from src.core.utils import is_cpf, limpar_texto, formatar_valor, formatar_data
from src.components.history import salvar_pesquisa_processo

def exibir_movimentos(movimentos):
    if not movimentos:
        st.info("Nenhum movimento processual encontrado.")
        return
    
    st.subheader(f"Movimentações Processuais ({len(movimentos)} movimentos)")
    for mov in sorted(movimentos, key=lambda x: x.get('data', ''), reverse=True):
        data_mov = formatar_data(mov.get('data'))
        nome_class = limpar_texto(mov.get('classificacaoCNJ', {}).get('nome', 'N/A'))
        descricao = limpar_texto(mov.get('descricao', ''))
        
        with st.expander(f"{data_mov} - {nome_class}", expanded=False):
            col1, col2 = st.columns(2)
            with col1:
                st.write(f"**Índice:** {mov.get('indice', 'N/A')}")
                st.write(f"**Código CNJ:** {mov.get('classificacaoCNJ', {}).get('codigoCNJ', '')}")
            with col2:
                st.write(f"**Data:** {data_mov}")
                st.write(f"**Classificação:** {nome_class}")
            if descricao:
                st.write("**Descrição:**")
                st.write(descricao)

def exibir_processo(processo, indice):
    numero_processo = processo.get('numeroProcessoUnico', 'N/A')
    key_detalhes = f"detalhes_{numero_processo}"
    tem_detalhes = key_detalhes in st.session_state
    
    if tem_detalhes:
        movimentos_count = len(st.session_state[key_detalhes].get('movimentos', []))
        titulo = f"Processo: {numero_processo} (DETALHES CARREGADOS - {movimentos_count} movimentos)" if movimentos_count else f"Processo: {numero_processo} (DETALHES CARREGADOS)"
    else:
        titulo = f"Processo: {numero_processo}"
    
    with st.expander(titulo, expanded=False):
        _exibir_info_processo(processo)
        _exibir_movimentos_processo(processo, numero_processo, indice)

def _exibir_info_processo(processo):
    col1, col2 = st.columns(2)
    
    with col1:
        st.subheader("Informações do Tribunal")
        st.write(f"**Tribunal:** {limpar_texto(processo.get('tribunal', 'N/A'))}")
        st.write(f"**UF:** {processo.get('uf', 'N/A')}")
        st.write(f"**Órgão:** {limpar_texto(processo.get('orgaoJulgador', 'N/A'))}")
        st.write(f"**Grau:** {processo.get('grauProcesso', 'N/A')}")
    
    with col2:
        st.subheader("Datas")
        st.write(f"**Distribuição:** {formatar_data(processo.get('dataDistribuicao'))}")
        st.write(f"**Autuação:** {formatar_data(processo.get('dataAutuacao'))}")
    
    classe = processo.get('classeProcessual', {})
    if classe:
        st.write(f"**Classe:** {limpar_texto(classe.get('nome', 'N/A'))}")
    
    assuntos = processo.get('assuntosCNJ', [])
    if assuntos:
        st.write("**Assuntos:**")
        for assunto in assuntos:
            principal = "Principal" if assunto.get('ePrincipal') else "Secundário"
            titulo = limpar_texto(assunto.get('titulo', 'N/A'))
            st.write(f"  {principal}: {titulo}")
    
    valor_causa = processo.get('valorCausa', {})
    if valor_causa:
        st.write(f"**Valor da Causa:** {formatar_valor(valor_causa.get('valor'))}")
    
    st.subheader("Partes")
    for parte in processo.get('partes', []):
        tipo = limpar_texto(parte.get('tipo', 'N/A'))
        nome = limpar_texto(parte.get('nome', 'N/A'))
        doc = parte.get('cpf') or parte.get('cnpj', '')
        doc_info = f" (CPF/CNPJ: {doc})" if doc else ""
        st.write(f"**{tipo}:** {nome}{doc_info}")
        
        for adv in parte.get('advogados', []):
            nome_adv = limpar_texto(adv.get('nome', 'N/A'))
            oab = adv.get('oab', {})
            oab_info = f"OAB/{oab.get('uf')}: {oab.get('numero')}" if oab else ""
            st.write(f"  {nome_adv} {oab_info}")
    
    url_processo = processo.get('urlProcesso')
    if url_processo:
        st.write(f"[Acessar no tribunal]({url_processo})")

def _exibir_movimentos_processo(processo, numero_processo, indice):
    key_detalhes = f"detalhes_{numero_processo}"
    tem_detalhes = key_detalhes in st.session_state
    
    movimentos = processo.get('movimentos', [])
    if tem_detalhes:
        movimentos_detalhados = st.session_state[key_detalhes].get('movimentos', [])
        if len(movimentos_detalhados) > len(movimentos):
            movimentos = movimentos_detalhados
    
    if movimentos:
        exibir_movimentos(movimentos)
    else:
        if st.button("Buscar Detalhes", key=f"btn_detalhes_{numero_processo}_{indice}"):
            _buscar_detalhes_processo(numero_processo, key_detalhes)

def _buscar_detalhes_processo(numero_processo, key_detalhes):
    api = st.session_state.get('predictus_api') or PredictusAPI()
    st.session_state.predictus_api = api
    
    with st.spinner("Buscando detalhes..."):
        detalhes = api.buscar_por_numero_cnj(numero_processo)
        
        if detalhes and len(detalhes) > 0:
            processo_detalhado = detalhes[0]
            st.session_state[key_detalhes] = processo_detalhado
            
            movimentos = processo_detalhado.get('movimentos', [])
            if movimentos:
                st.success(f"✅ Encontrados {len(movimentos)} movimentos!")
                exibir_movimentos(movimentos)
            else:
                st.success("✅ Processo consultado! Sem movimentos adicionais.")
            
            if f"atualizar_{numero_processo}" not in st.session_state:
                st.session_state[f"atualizar_{numero_processo}"] = True
                st.rerun()
        else:
            st.warning("Não foi possível obter detalhes do processo.")

def secao_processos():
    st.header("⚖️ Consulta de Processos Judiciais")
    
    if 'resultados_processos' not in st.session_state:
        st.session_state.resultados_processos = None
    
    st.subheader("Buscar Processos")
    
    col1, col2 = st.columns([3, 1])
    
    with col1:
        entrada = st.text_input("Nome completo ou CPF:", placeholder="Ex: João Silva ou 123.456.789-10", key="entrada_processos")
    
    with col2:
        if st.button("🔍 Buscar Processos", type="primary", use_container_width=True):
            _realizar_busca_processos(entrada)
    
    _exibir_resultados_processos()

def _realizar_busca_processos(entrada):
    if not entrada.strip():
        st.warning("Digite um nome ou CPF para pesquisar.")
        return
    
    api = st.session_state.get('predictus_api') or PredictusAPI()
    st.session_state.predictus_api = api
    
    with st.spinner("Buscando processos..."):
        if is_cpf(entrada):
            cpf = re.sub(r'\D', '', entrada)
            st.info(f"Buscando por CPF: {cpf}")
            resultados = api.buscar_por_cpf(cpf)
            tipo_busca, termo_exibicao = "CPF", cpf
        else:
            st.info(f"Buscando por nome: {entrada}")
            resultados = api.buscar_por_nome(entrada)
            tipo_busca, termo_exibicao = "Nome", entrada
    
    st.session_state.resultados_processos = resultados
    
    if resultados is not None:
        if salvar_pesquisa_processo(termo_exibicao, tipo_busca, resultados):
            st.success("✅ Pesquisa salva no histórico!")

def _exibir_resultados_processos():
    if st.session_state.resultados_processos is not None:
        resultados = st.session_state.resultados_processos
        
        if len(resultados) == 0:
            st.warning("Nenhum processo encontrado.")
        else:
            st.success(f"Encontrados {len(resultados)} processos")
            _exibir_estatisticas_processos(resultados)
            st.markdown("---")
            st.subheader("📋 Processos Encontrados")
            for i, processo in enumerate(resultados):
                exibir_processo(processo, i)

def _exibir_estatisticas_processos(resultados):
    tribunais = {}
    valor_total = 0
    
    for proc in resultados:
        tribunal = proc.get('tribunal', 'N/A')
        tribunais[tribunal] = tribunais.get(tribunal, 0) + 1
        valor = proc.get('valorCausa', {}).get('valor', 0)
        if valor:
            try:
                valor_total += float(valor)
            except:
                pass
    
    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("Total", len(resultados))
    with col2:
        tribunal_top = max(tribunais, key=tribunais.get) if tribunais else "N/A"
        st.metric("Tribunal Principal", tribunal_top)
    with col3:
        st.metric("Valor Total", formatar_valor(valor_total))