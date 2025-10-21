"""
Process View Components
UI components for displaying judicial process information
"""
import streamlit as st
from typing import Dict, List
from utils.data_helpers import DataFormatter
from models.predictus_api import PredictusAPI
from utils.file_storage import FileStorage


class ProcessViewComponents:
    """UI components for process display"""

    @staticmethod
    def render_process_movements(movements: List[Dict]):
        """Render process movements"""
        if not movements:
            st.info("No process movements found.")
            return

        st.subheader(f"Process Movements ({len(movements)} movements)")

        for mov in sorted(movements, key=lambda x: x.get('data', ''), reverse=True):
            date = DataFormatter.format_date(mov.get('data'))
            classification = DataFormatter.clean_text(
                mov.get('classificacaoCNJ', {}).get('nome', 'N/A')
            )
            description = DataFormatter.clean_text(mov.get('descricao', ''))

            with st.expander(f"{date} - {classification}", expanded=False):
                col1, col2 = st.columns(2)

                with col1:
                    st.write(f"**Index:** {mov.get('indice', 'N/A')}")
                    st.write(f"**CNJ Code:** {mov.get('classificacaoCNJ', {}).get('codigoCNJ', '')}")

                with col2:
                    st.write(f"**Date:** {date}")
                    st.write(f"**Classification:** {classification}")

                if description:
                    st.write("**Description:**")
                    st.write(description)

    @staticmethod
    def render_process_details(process: Dict, index: int):
        """Render detailed process information"""
        process_number = process.get('numeroProcessoUnico', 'N/A')
        details_key = f"detalhes_{process_number}"
        has_details = details_key in st.session_state

        # Build title
        if has_details:
            movements_count = len(st.session_state[details_key].get('movimentos', []))
            title_suffix = f" (DETAILS LOADED - {movements_count} movements)" if movements_count else " (DETAILS LOADED)"
            title = f"Process: {process_number}{title_suffix}"
        else:
            title = f"Process: {process_number}"

        with st.expander(title, expanded=False):
            # Basic information
            col1, col2 = st.columns(2)

            with col1:
                st.subheader("Court Information")
                st.write(f"**Court:** {DataFormatter.clean_text(process.get('tribunal', 'N/A'))}")
                st.write(f"**State:** {process.get('uf', 'N/A')}")
                st.write(f"**Judge:** {DataFormatter.clean_text(process.get('orgaoJulgador', 'N/A'))}")
                st.write(f"**Level:** {process.get('grauProcesso', 'N/A')}")

            with col2:
                st.subheader("Dates")
                st.write(f"**Distribution:** {DataFormatter.format_date(process.get('dataDistribuicao'))}")
                st.write(f"**Filing:** {DataFormatter.format_date(process.get('dataAutuacao'))}")

            # Class and subjects
            process_class = process.get('classeProcessual', {})
            if process_class:
                st.write(f"**Class:** {DataFormatter.clean_text(process_class.get('nome', 'N/A'))}")

            subjects = process.get('assuntosCNJ', [])
            if subjects:
                st.write("**Subjects:**")
                for subject in subjects:
                    is_main = "Main" if subject.get('ePrincipal') else "Secondary"
                    title = DataFormatter.clean_text(subject.get('titulo', 'N/A'))
                    st.write(f"  {is_main}: {title}")

            # Case value
            case_value = process.get('valorCausa', {})
            if case_value:
                st.write(f"**Case Value:** {DataFormatter.format_currency(case_value.get('valor'))}")

            # Parties
            st.subheader("Parties")
            for party in process.get('partes', []):
                party_type = DataFormatter.clean_text(party.get('tipo', 'N/A'))
                name = DataFormatter.clean_text(party.get('nome', 'N/A'))
                doc = party.get('cpf') or party.get('cnpj', '')
                doc_info = f" (CPF/CNPJ: {doc})" if doc else ""
                st.write(f"**{party_type}:** {name}{doc_info}")

                # Lawyers
                for lawyer in party.get('advogados', []):
                    lawyer_name = DataFormatter.clean_text(lawyer.get('nome', 'N/A'))
                    oab = lawyer.get('oab', {})
                    oab_info = f"OAB/{oab.get('uf')}: {oab.get('numero')}" if oab else ""
                    st.write(f"  {lawyer_name} {oab_info}")

            # URL
            process_url = process.get('urlProcesso')
            if process_url:
                st.write(f"[Access on court website]({process_url})")

            # Movements
            movements = process.get('movimentos', [])
            if has_details:
                detailed_movements = st.session_state[details_key].get('movimentos', [])
                if len(detailed_movements) > len(movements):
                    movements = detailed_movements

            if movements:
                ProcessViewComponents.render_process_movements(movements)
            else:
                if st.button("Get Details", key=f"btn_details_{process_number}_{index}"):
                    ProcessViewComponents._fetch_process_details(process_number)

    @staticmethod
    def _fetch_process_details(process_number: str):
        """Fetch detailed process information"""
        api = st.session_state.get('api') or PredictusAPI()
        st.session_state.api = api

        with st.spinner("Fetching details..."):
            details = api.search_by_process_number(process_number)

            if details and len(details) > 0:
                detailed_process = details[0]
                details_key = f"detalhes_{process_number}"
                st.session_state[details_key] = detailed_process

                # Save to history
                history = st.session_state.get('historico_pesquisas', [])
                FileStorage.save_process_details(process_number, detailed_process, history)
                st.session_state.historico_pesquisas = history

                movements = detailed_process.get('movimentos', [])
                if movements:
                    st.success(f"✅ Found {len(movements)} movements! 💾 Details saved.")
                    ProcessViewComponents.render_process_movements(movements)
                else:
                    st.success("✅ Process consulted and saved! No additional movements.")

                # Force re-render
                update_key = f"update_{process_number}"
                if update_key not in st.session_state:
                    st.session_state[update_key] = True
                    st.rerun()
            else:
                st.warning("Could not obtain process details.")
