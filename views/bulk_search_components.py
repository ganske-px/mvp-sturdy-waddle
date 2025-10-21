"""
Bulk Search View Components
UI components for bulk search results display
"""
import streamlit as st
from datetime import datetime
from typing import Dict
from controllers.bulk_search import BulkSearchManager
from utils.data_helpers import DataFormatter
from views.risk_components import RiskViewComponents
from views.process_components import ProcessViewComponents


class BulkSearchViewComponents:
    """UI components for bulk search results"""

    @staticmethod
    def render_bulk_search_results(bulk_results: Dict):
        """Render results from bulk CPF search"""
        if not bulk_results:
            return

        manager = BulkSearchManager(None, None)
        manager.results = bulk_results
        summary_stats = manager.get_summary()

        # Summary metrics
        st.subheader("📊 Bulk Search Summary")
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            st.metric("Total Searched", summary_stats['total_searched'])
        with col2:
            st.metric("✅ Nada Consta", summary_stats['nada_consta'])
        with col3:
            st.metric("⚠️ With Processes", summary_stats['with_processes'])
        with col4:
            st.metric("📋 Total Processes", summary_stats['total_processes'])

        # Risk summary metrics
        st.subheader("🎯 Risk Assessment Summary")
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            st.metric("✅ Low Risk", summary_stats.get('low_risk', 0))
        with col2:
            st.metric("⚠️ Medium Risk", summary_stats.get('medium_risk', 0))
        with col3:
            st.metric("🔴 High Risk", summary_stats.get('high_risk', 0))
        with col4:
            st.metric("⛔ Critical Risk", summary_stats.get('critical_risk', 0))

        # Export button
        if summary_stats['total_searched'] > 0:
            csv_data = manager.export_results_to_csv()
            st.download_button(
                label="📥 Download Results (CSV)",
                data=csv_data,
                file_name=f"bulk_search_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                mime="text/csv",
                use_container_width=True
            )

        st.markdown("---")

        # Nada Consta section
        if bulk_results['nada_consta']:
            with st.expander(f"✅ Nada Consta ({len(bulk_results['nada_consta'])} CPFs)", expanded=True):
                st.success(f"**{len(bulk_results['nada_consta'])}** CPFs without judicial processes")

                # Display with risk badges
                cpf_list = bulk_results['nada_consta']
                risk_assessments = bulk_results.get('risk_assessments', {})

                for cpf in cpf_list:
                    risk_data = risk_assessments.get(cpf, {})
                    risk_badge = RiskViewComponents.render_risk_badge(risk_data)
                    st.write(f"✓ {DataFormatter.format_cpf(cpf)} - {risk_badge}")

        # Found processes section
        if bulk_results['found_processes']:
            st.markdown("---")
            st.subheader(f"⚠️ CPFs with Processes ({len(bulk_results['found_processes'])})")

            risk_assessments = bulk_results.get('risk_assessments', {})

            for cpf, processes in bulk_results['found_processes'].items():
                risk_data = risk_assessments.get(cpf, {})
                risk_badge = RiskViewComponents.render_risk_badge(risk_data)

                with st.expander(f"CPF: {DataFormatter.format_cpf(cpf)} - {len(processes)} process(es) - {risk_badge}", expanded=False):
                    st.warning(f"**{len(processes)} judicial process(es) found for this CPF**")

                    # Display risk assessment
                    if risk_data:
                        RiskViewComponents.render_risk_assessment(risk_data, expanded=False)
                        st.markdown("---")

                    # Display each process
                    for idx, process in enumerate(processes):
                        ProcessViewComponents.render_process_details(process, idx)

        # Errors section
        if bulk_results['errors']:
            st.markdown("---")
            with st.expander(f"❌ Errors ({len(bulk_results['errors'])})", expanded=False):
                st.error(f"**{len(bulk_results['errors'])}** CPFs had errors during search")

                for error in bulk_results['errors']:
                    st.write(f"• {DataFormatter.format_cpf(error['cpf'])}: {error['error']}")
