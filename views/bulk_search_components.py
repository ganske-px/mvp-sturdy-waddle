"""
Componentes de Visualização de Pesquisa em Lote
Componentes de UI para exibição de resultados de pesquisa em lote
"""
import streamlit as st
from datetime import datetime
from typing import Dict
from controllers.bulk_search import BulkSearchManager
from utils.data_helpers import DataFormatter, CNPJValidator
from views.process_components import ProcessViewComponents


class BulkSearchViewComponents:
    """Componentes de UI para resultados de pesquisa em lote"""

    @staticmethod
    def render_bulk_search_results(bulk_results: Dict):
        """Renderiza resultados da pesquisa em lote de CPFs e CNPJs"""
        if not bulk_results:
            return

        manager = BulkSearchManager(None)
        manager.results = bulk_results
        summary_stats = manager.get_summary()

        # Métricas do resumo
        st.subheader("📊 Resumo da Pesquisa em Lote")
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            st.metric("Total Pesquisado", summary_stats['total_searched'])
        with col2:
            nada_consta_total = summary_stats['nada_consta'] + summary_stats.get('nada_consta_cnpj', 0)
            st.metric("✅ Nada Consta", nada_consta_total)
        with col3:
            with_processes_total = summary_stats['with_processes'] + summary_stats.get('with_processes_cnpj', 0)
            st.metric("⚠️ Com Processos", with_processes_total)
        with col4:
            st.metric("📋 Total de Processos", summary_stats['total_processes'])

        # Botão de exportação
        if summary_stats['total_searched'] > 0:
            csv_data = manager.export_results_to_csv()
            st.download_button(
                label="📥 Baixar Resultados (CSV)",
                data=csv_data,
                file_name=f"resultados_pesquisa_lote_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                mime="text/csv",
                use_container_width=True
            )

        st.markdown("---")

        # Seção Nada Consta - CPFs
        if bulk_results.get('nada_consta'):
            with st.expander(f"✅ Nada Consta - CPFs ({len(bulk_results['nada_consta'])})", expanded=True):
                st.success(f"**{len(bulk_results['nada_consta'])}** CPFs sem processos judiciais")

                # Exibir CPFs
                cpf_list = bulk_results['nada_consta']
                for cpf in cpf_list:
                    st.write(f"✓ {DataFormatter.format_cpf(cpf)}")

        # Seção Nada Consta - CNPJs
        if bulk_results.get('nada_consta_cnpj'):
            with st.expander(f"✅ Nada Consta - CNPJs ({len(bulk_results['nada_consta_cnpj'])})", expanded=True):
                st.success(f"**{len(bulk_results['nada_consta_cnpj'])}** CNPJs sem processos judiciais")

                # Exibir CNPJs
                cnpj_list = bulk_results['nada_consta_cnpj']
                for cnpj in cnpj_list:
                    st.write(f"✓ {CNPJValidator.format_cnpj(cnpj)}")

        # Seção de processos encontrados - CPFs
        if bulk_results.get('found_processes'):
            st.markdown("---")
            st.subheader(f"⚠️ CPFs com Processos ({len(bulk_results['found_processes'])})")

            for cpf, processes in bulk_results['found_processes'].items():
                with st.expander(f"CPF: {DataFormatter.format_cpf(cpf)} - {len(processes)} processo(s)", expanded=False):
                    st.warning(f"**{len(processes)} processo(s) judicial(is) encontrado(s) para este CPF**")

                    # Exibir cada processo
                    for idx, process in enumerate(processes):
                        ProcessViewComponents.render_process_details(process, idx)

        # Seção de processos encontrados - CNPJs
        if bulk_results.get('found_processes_cnpj'):
            st.markdown("---")
            st.subheader(f"⚠️ CNPJs com Processos ({len(bulk_results['found_processes_cnpj'])})")

            for cnpj, processes in bulk_results['found_processes_cnpj'].items():
                with st.expander(f"CNPJ: {CNPJValidator.format_cnpj(cnpj)} - {len(processes)} processo(s)", expanded=False):
                    st.warning(f"**{len(processes)} processo(s) judicial(is) encontrado(s) para este CNPJ**")

                    # Exibir cada processo
                    for idx, process in enumerate(processes):
                        ProcessViewComponents.render_process_details(process, idx)

        # Seção de erros - CPFs
        if bulk_results.get('errors'):
            st.markdown("---")
            with st.expander(f"❌ Erros - CPFs ({len(bulk_results['errors'])})", expanded=False):
                st.error(f"**{len(bulk_results['errors'])}** CPFs tiveram erros durante a pesquisa")

                for error in bulk_results['errors']:
                    st.write(f"• {DataFormatter.format_cpf(error['cpf'])}: {error['error']}")

        # Seção de erros - CNPJs
        if bulk_results.get('errors_cnpj'):
            st.markdown("---")
            with st.expander(f"❌ Erros - CNPJs ({len(bulk_results['errors_cnpj'])})", expanded=False):
                st.error(f"**{len(bulk_results['errors_cnpj'])}** CNPJs tiveram erros durante a pesquisa")

                for error in bulk_results['errors_cnpj']:
                    st.write(f"• {CNPJValidator.format_cnpj(error['cnpj'])}: {error['error']}")
