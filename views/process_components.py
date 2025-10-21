"""
Componentes de Visualização de Processos
Componentes de UI para exibição de informações de processos judiciais
"""
import streamlit as st
from typing import Dict, List
from utils.data_helpers import DataFormatter
from models.predictus_api import PredictusAPI
from utils.file_storage import FileStorage


class ProcessViewComponents:
    """Componentes de UI para exibição de processos"""

    @staticmethod
    def render_process_movements(movements: List[Dict]):
        """Renderiza movimentações do processo"""
        if not movements:
            st.info("Nenhuma movimentação do processo encontrada.")
            return

        st.subheader(f"Movimentações do Processo ({len(movements)} movimentações)")

        for mov in sorted(movements, key=lambda x: x.get('data', ''), reverse=True):
            date = DataFormatter.format_date(mov.get('data'))
            classification = DataFormatter.clean_text(
                mov.get('classificacaoCNJ', {}).get('nome', 'N/A')
            )
            description = DataFormatter.clean_text(mov.get('descricao', ''))

            with st.expander(f"{date} - {classification}", expanded=False):
                col1, col2 = st.columns(2)

                with col1:
                    st.write(f"**Índice:** {mov.get('indice', 'N/A')}")
                    st.write(f"**Código CNJ:** {mov.get('classificacaoCNJ', {}).get('codigoCNJ', '')}")

                with col2:
                    st.write(f"**Data:** {date}")
                    st.write(f"**Classificação:** {classification}")

                if description:
                    st.write("**Descrição:**")
                    st.write(description)

    @staticmethod
    def render_process_details(process: Dict, index: int):
        """Renderiza informações detalhadas do processo"""
        process_number = process.get('numeroProcessoUnico', 'N/A')
        details_key = f"detalhes_{process_number}"
        has_details = details_key in st.session_state

        # Construir título
        if has_details:
            movements_count = len(st.session_state[details_key].get('movimentos', []))
            title_suffix = f" (DETALHES CARREGADOS - {movements_count} movimentações)" if movements_count else " (DETALHES CARREGADOS)"
            title = f"Processo: {process_number}{title_suffix}"
        else:
            title = f"Processo: {process_number}"

        with st.expander(title, expanded=False):
            # Informações básicas
            col1, col2 = st.columns(2)

            with col1:
                st.subheader("Informações do Tribunal")
                st.write(f"**Tribunal:** {DataFormatter.clean_text(process.get('tribunal', 'N/A'))}")
                st.write(f"**Estado:** {process.get('uf', 'N/A')}")
                st.write(f"**Órgão Julgador:** {DataFormatter.clean_text(process.get('orgaoJulgador', 'N/A'))}")
                st.write(f"**Grau:** {process.get('grauProcesso', 'N/A')}")

            with col2:
                st.subheader("Datas")
                st.write(f"**Distribuição:** {DataFormatter.format_date(process.get('dataDistribuicao'))}")
                st.write(f"**Autuação:** {DataFormatter.format_date(process.get('dataAutuacao'))}")

            # Classe e assuntos
            process_class = process.get('classeProcessual', {})
            if process_class:
                st.write(f"**Classe:** {DataFormatter.clean_text(process_class.get('nome', 'N/A'))}")

            subjects = process.get('assuntosCNJ', [])
            if subjects:
                st.write("**Assuntos:**")
                for subject in subjects:
                    is_main = "Principal" if subject.get('ePrincipal') else "Secundário"
                    title = DataFormatter.clean_text(subject.get('titulo', 'N/A'))
                    st.write(f"  {is_main}: {title}")

            # Valor da causa
            case_value = process.get('valorCausa', {})
            if case_value:
                st.write(f"**Valor da Causa:** {DataFormatter.format_currency(case_value.get('valor'))}")

            # Partes
            st.subheader("Partes")
            for party in process.get('partes', []):
                party_type = DataFormatter.clean_text(party.get('tipo', 'N/A'))
                name = DataFormatter.clean_text(party.get('nome', 'N/A'))
                doc = party.get('cpf') or party.get('cnpj', '')
                doc_info = f" (CPF/CNPJ: {doc})" if doc else ""
                st.write(f"**{party_type}:** {name}{doc_info}")

                # Advogados
                for lawyer in party.get('advogados', []):
                    lawyer_name = DataFormatter.clean_text(lawyer.get('nome', 'N/A'))
                    oab = lawyer.get('oab', {})
                    oab_info = f"OAB/{oab.get('uf')}: {oab.get('numero')}" if oab else ""
                    st.write(f"  {lawyer_name} {oab_info}")

            # URL
            process_url = process.get('urlProcesso')
            if process_url:
                st.write(f"[Acessar no site do tribunal]({process_url})")

            # Movimentações
            movements = process.get('movimentos', [])
            if has_details:
                detailed_movements = st.session_state[details_key].get('movimentos', [])
                if len(detailed_movements) > len(movements):
                    movements = detailed_movements

            if movements:
                ProcessViewComponents.render_process_movements(movements)
            else:
                if st.button("Obter Detalhes", key=f"btn_details_{process_number}_{index}"):
                    ProcessViewComponents._fetch_process_details(process_number)

    @staticmethod
    def _fetch_process_details(process_number: str):
        """Busca informações detalhadas do processo"""
        api = st.session_state.get('api') or PredictusAPI()
        st.session_state.api = api

        with st.spinner("Buscando detalhes..."):
            details = api.search_by_process_number(process_number)

            if details and len(details) > 0:
                detailed_process = details[0]
                details_key = f"detalhes_{process_number}"
                st.session_state[details_key] = detailed_process

                # Salvar no histórico
                history = st.session_state.get('historico_pesquisas', [])
                FileStorage.save_process_details(process_number, detailed_process, history)
                st.session_state.historico_pesquisas = history

                movements = detailed_process.get('movimentos', [])
                if movements:
                    st.success(f"✅ Encontradas {len(movements)} movimentações! 💾 Detalhes salvos.")
                    ProcessViewComponents.render_process_movements(movements)
                else:
                    st.success("✅ Processo consultado e salvo! Sem movimentações adicionais.")

                # Forçar re-renderização
                update_key = f"update_{process_number}"
                if update_key not in st.session_state:
                    st.session_state[update_key] = True
                    st.rerun()
            else:
                st.warning("Não foi possível obter detalhes do processo.")
