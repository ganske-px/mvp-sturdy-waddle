"""
Legal Process Search Application - Refactored with MVC Pattern
Main application entry point
"""
import re
import streamlit as st
from datetime import datetime

# Configuration
from config.settings import MAX_HISTORY_ITEMS

# Models
from models.auth import AuthenticationManager
from models.predictus_api import PredictusAPI
from models.analytics import PosthogAPI
from models.risk_assessment import RiskAssessor

# Controllers
from controllers.csv_processor import CSVProcessor
from controllers.bulk_search import BulkSearchManager

# Views
from views.auth_components import AuthViewComponents
from views.risk_components import RiskViewComponents
from views.process_components import ProcessViewComponents
from views.bulk_search_components import BulkSearchViewComponents

# Utils
from utils.data_helpers import CPFValidator, DataFormatter
from utils.file_storage import FileStorage


def initialize_session_state():
    """Initialize session state variables"""
    defaults = {
        'resultados': None,
        'historico_pesquisas': FileStorage.load_search_history(),
        'ph': PosthogAPI(),
        'risk_assessment': None
    }

    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def render_search_interface():
    """Render the main search interface"""
    st.title("Legal Process Search")
    st.markdown("---")

    # Create tabs for single and bulk search
    tab1, tab2 = st.tabs(["🔍 Single Search", "📂 Bulk Search (CSV)"])

    with tab1:
        render_single_search_tab()

    with tab2:
        render_bulk_search_tab()


def render_single_search_tab():
    """Render single search tab"""
    st.subheader("Search by Name or CPF")

    col1, col2 = st.columns([3, 1])

    with col1:
        search_input = st.text_input(
            "Full name or CPF:",
            placeholder="Ex: João Silva or 123.456.789-10"
        )

    with col2:
        if st.button("🔍 New Search", type="primary", use_container_width=True):
            if not search_input.strip():
                st.warning("Enter a name or CPF to search.")
                return

            perform_search(search_input)


def render_bulk_search_tab():
    """Render bulk search tab"""
    st.subheader("Bulk CPF Search via CSV")

    st.markdown("""
    Upload a CSV file containing CPFs to search multiple records at once.
    The system will automatically extract all CPFs from the file.
    """)

    # File upload
    uploaded_file = st.file_uploader(
        "Choose a CSV file",
        type=['csv'],
        help="Upload a CSV file containing CPFs. Maximum file size: 10MB"
    )

    if uploaded_file is not None:
        # Validate file
        is_valid, message = CSVProcessor.validate_csv_file(uploaded_file)

        if not is_valid:
            st.error(f"❌ {message}")
            return

        # Process CSV
        with st.spinner("Processing CSV file..."):
            cpf_list, _ = CSVProcessor.process_csv_file(uploaded_file)

        if not cpf_list:
            st.warning("⚠️ No valid CPFs found in the uploaded file.")
            return

        # Display preview
        st.success(f"✅ Found {len(cpf_list)} unique CPFs in the file")

        with st.expander("📋 Preview extracted CPFs", expanded=False):
            # Format CPFs for display
            formatted_cpfs = [DataFormatter.format_cpf(cpf) for cpf in cpf_list[:50]]

            if len(cpf_list) <= 50:
                st.write(", ".join(formatted_cpfs))
            else:
                st.write(", ".join(formatted_cpfs))
                st.info(f"... and {len(cpf_list) - 50} more CPFs")

        # Search button
        col1, col2 = st.columns([1, 3])

        with col1:
            if st.button("🔍 Start Bulk Search", type="primary", use_container_width=True):
                perform_bulk_search(cpf_list)

        with col2:
            st.info(f"This will search {len(cpf_list)} CPFs. This may take several minutes.")

    # Display previous bulk search results if available
    if 'bulk_results' in st.session_state and st.session_state.bulk_results:
        st.markdown("---")
        st.subheader("📊 Last Bulk Search Results")
        BulkSearchViewComponents.render_bulk_search_results(st.session_state.bulk_results)


def perform_search(search_input: str):
    """Perform search based on input"""
    api = st.session_state.get('api') or PredictusAPI()
    st.session_state.api = api

    # Clear previous risk assessment
    st.session_state.risk_assessment = None

    with st.spinner("Searching processes..."):
        if CPFValidator.is_cpf(search_input):
            cpf = re.sub(r'\D', '', search_input)
            st.info(f"Searching by CPF: {cpf}")
            results = api.search_by_cpf(cpf)
            search_type, display_term = "CPF", cpf
        else:
            st.info(f"Searching by name: {search_input}")
            results = api.search_by_name(search_input)
            search_type, display_term = "Name", search_input

        st.session_state.ph.track_search(search_input, is_new=True)

    st.session_state.resultados = results
    st.session_state.last_search_term = display_term

    if results is not None:
        search_info = {
            'termo': display_term,
            'tipo': search_type,
            'data_hora': datetime.now().strftime('%d/%m/%Y %H:%M'),
            'total_processos': len(results),
            'resultados': results
        }

        st.session_state.historico_pesquisas.insert(0, search_info)
        if len(st.session_state.historico_pesquisas) > MAX_HISTORY_ITEMS:
            st.session_state.historico_pesquisas = st.session_state.historico_pesquisas[:MAX_HISTORY_ITEMS]

        if FileStorage.save_search_history(st.session_state.historico_pesquisas):
            st.success("✅ Search saved to permanent history!")


def perform_bulk_search(cpf_list: list):
    """Perform bulk CPF search"""
    api = st.session_state.get('api') or PredictusAPI()
    st.session_state.api = api

    posthog = st.session_state.get('ph') or PosthogAPI()
    st.session_state.ph = posthog

    # Create bulk search manager
    bulk_manager = BulkSearchManager(api, posthog)

    # Progress tracking
    progress_bar = st.progress(0)
    status_text = st.empty()

    def update_progress(current: int, total: int, cpf: str):
        """Update progress bar and status"""
        progress = current / total
        progress_bar.progress(progress)
        status_text.text(f"Searching {current}/{total}: {DataFormatter.format_cpf(cpf)}")

    # Perform search
    with st.spinner("Performing bulk search..."):
        results = bulk_manager.search_cpf_list(cpf_list, progress_callback=update_progress)

    # Clear progress indicators
    progress_bar.empty()
    status_text.empty()

    # Store results
    st.session_state.bulk_results = results

    # Display summary
    summary = bulk_manager.get_summary()
    st.success(f"✅ Bulk search completed! Searched {summary['total_searched']} CPFs")

    # Rerun to display results
    st.rerun()


def render_search_results():
    """Render search results"""
    if st.session_state.resultados is None:
        return

    results = st.session_state.resultados

    if len(results) == 0:
        st.warning("No processes found.")

        # Even for clean records, show risk assessment
        if 'risk_assessment' not in st.session_state or st.session_state.risk_assessment is None:
            risk_assessor = RiskAssessor()
            search_term = st.session_state.get('last_search_term', 'N/A')
            risk_data = risk_assessor.assess_risk([], {"search_term": search_term})
            st.session_state.risk_assessment = risk_data

        RiskViewComponents.render_risk_assessment(st.session_state.risk_assessment, expanded=True)
        return

    st.success(f"Found {len(results)} processes")

    # Calculate risk assessment
    if 'risk_assessment' not in st.session_state or st.session_state.risk_assessment is None:
        with st.spinner("Analyzing risk factors..."):
            risk_assessor = RiskAssessor()
            search_term = st.session_state.get('last_search_term', 'N/A')
            risk_data = risk_assessor.assess_risk(results, {"search_term": search_term})
            st.session_state.risk_assessment = risk_data

    # Display risk assessment
    RiskViewComponents.render_risk_assessment(st.session_state.risk_assessment, expanded=True)

    st.markdown("---")

    # Statistics
    courts = {}
    total_value = 0

    for proc in results:
        court = proc.get('tribunal', 'N/A')
        courts[court] = courts.get(court, 0) + 1

        value = proc.get('valorCausa', {}).get('valor', 0)
        if value:
            try:
                total_value += float(value)
            except (ValueError, TypeError):
                pass

    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("Total", len(results))
    with col2:
        main_court = max(courts, key=courts.get) if courts else "N/A"
        st.metric("Main Court", main_court)
    with col3:
        st.metric("Total Value", DataFormatter.format_currency(total_value))

    st.markdown("---")
    st.subheader("📋 Found Processes")

    for i, process in enumerate(results):
        ProcessViewComponents.render_process_details(process, i)


def render_sidebar():
    """Render sidebar with information and history"""
    with st.sidebar:
        st.header("Information")
        st.markdown("""
        **How to use:**
        1. Enter full name or CPF
        2. Click "Search"
        3. Navigate through processes
        4. Use "Get Details" for movements

        **Features:**
        - 💾 History saved automatically
        - 🔄 Searches + details persist after reload
        - 🔍 Search by name or CPF
        - 📋 Complete process details
        - ⚖️ Saved process movements
        - 🎯 AI-powered risk assessment
        """)

        render_search_history()
        AuthViewComponents.render_user_info()


def render_search_history():
    """Render search history in sidebar"""
    st.markdown("---")
    st.header("Search History")

    history = st.session_state.historico_pesquisas

    if not history:
        st.info("No searches saved yet.")
        st.caption("💾 Searches and details are saved automatically")
        return

    st.write(f"**{len(history)} saved searches**")
    st.caption("💾 History saved automatically")

    for i, search in enumerate(history):
        details_count = len(search.get('detalhes_processos', {}))
        details_info = f" + {details_count} detailed" if details_count > 0 else ""
        term_display = search['termo'][:20] + ('...' if len(search['termo']) > 20 else '')

        with st.expander(f"{search['tipo']}: {term_display}", expanded=False):
            st.write(f"**Type:** {search['tipo']}")
            st.write(f"**Term:** {search['termo']}")
            st.write(f"**Date/Time:** {search['data_hora']}")
            st.write(f"**Processes:** {search['total_processos']}{details_info}")

            if details_count > 0:
                st.write(f"**💾 Details saved:** {details_count} processes")

            col1, col2 = st.columns(2)

            with col1:
                if st.button("📂 Open", key=f"reopen_{i}"):
                    reopen_search(search)

            with col2:
                if st.button("🗑️ Delete", key=f"delete_{i}"):
                    delete_search(search, i)


def reopen_search(search: dict):
    """Reopen a saved search"""
    st.session_state.resultados = search['resultados']
    st.session_state.risk_assessment = None  # Force recalculation

    # Load saved details
    details_processes = search.get('detalhes_processos', {})
    for process_number, details in details_processes.items():
        st.session_state[f"detalhes_{process_number}"] = details

    details_count = len(details_processes)
    if details_count > 0:
        st.success(f"Search opened: {search['total_processos']} processes + {details_count} with saved details")
    else:
        st.success(f"Search opened: {search['total_processos']} processes")

    st.session_state.ph.track_search(search['termo'], is_new=False)
    st.rerun()


def delete_search(search: dict, index: int):
    """Delete a search from history"""
    st.session_state.historico_pesquisas.pop(index)

    if FileStorage.save_search_history(st.session_state.historico_pesquisas):
        st.success(f"✅ Search '{search['termo']}' deleted from history!")
    else:
        st.error("❌ Error deleting search from file.")

    st.rerun()


def main_app():
    """Main application after login"""
    initialize_session_state()
    render_search_interface()
    render_search_results()
    render_sidebar()


def main():
    """Main function controlling authentication flow"""
    st.set_page_config(
        page_title="Legal Process Search MVP",
        page_icon="⚖️",
        layout="wide"
    )

    if "ph" not in st.session_state:
        st.session_state.ph = PosthogAPI()

    if not AuthenticationManager.is_authenticated():
        AuthViewComponents.render_login_screen()
    else:
        main_app()


if __name__ == "__main__":
    main()
