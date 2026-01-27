"""
Aplicação de Consulta de Processos Judiciais - Refatorado com Padrão MVC
Ponto de entrada principal da aplicação
"""
import re
import streamlit as st
from datetime import datetime

# Configuration
from config.settings import MAX_HISTORY_ITEMS

# Models
from models.auth import AuthenticationManager
from models.predictus_api import PredictusAPI

# Controllers
from controllers.csv_processor import CSVProcessor
from controllers.bulk_search import BulkSearchManager

# Views
from views.auth_components import AuthViewComponents
from views.process_components import ProcessViewComponents
from views.bulk_search_components import BulkSearchViewComponents

# Utils
from utils.data_helpers import CPFValidator, CNPJValidator, DataFormatter
from utils.file_storage import FileStorage


def initialize_session_state():
    """Inicializa variáveis de estado da sessão"""
    defaults = {
        'resultados': None,
        'historico_pesquisas': FileStorage.load_search_history()
    }

    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def render_search_interface():
    """Renderiza a interface principal de pesquisa"""
    st.title("Consulta de Processos Judiciais")
    st.markdown("---")

    # Criar abas para pesquisa individual e em lote
    tab1, tab2 = st.tabs(["🔍 Pesquisa Individual", "📂 Pesquisa em Lote (CSV)"])

    with tab1:
        render_single_search_tab()

    with tab2:
        render_bulk_search_tab()


def render_single_search_tab():
    """Renderiza aba de pesquisa individual"""
    st.subheader("Pesquisar por Nome, CPF ou CNPJ")

    # JavaScript para máscara de CPF/CNPJ
    st.markdown("""
    <script>
    function formatCPF(value) {
        // Remove tudo que não é dígito
        value = value.replace(/\\D/g, '');

        // Limita a 11 dígitos
        value = value.substring(0, 11);

        // Aplica a máscara
        if (value.length <= 3) {
            return value;
        } else if (value.length <= 6) {
            return value.substring(0, 3) + '.' + value.substring(3);
        } else if (value.length <= 9) {
            return value.substring(0, 3) + '.' + value.substring(3, 6) + '.' + value.substring(6);
        } else {
            return value.substring(0, 3) + '.' + value.substring(3, 6) + '.' + value.substring(6, 9) + '-' + value.substring(9);
        }
    }

    function formatCNPJ(value) {
        // Remove tudo que não é dígito
        value = value.replace(/\\D/g, '');

        // Limita a 14 dígitos
        value = value.substring(0, 14);

        // Aplica a máscara XX.XXX.XXX/XXXX-XX
        if (value.length <= 2) {
            return value;
        } else if (value.length <= 5) {
            return value.substring(0, 2) + '.' + value.substring(2);
        } else if (value.length <= 8) {
            return value.substring(0, 2) + '.' + value.substring(2, 5) + '.' + value.substring(5);
        } else if (value.length <= 12) {
            return value.substring(0, 2) + '.' + value.substring(2, 5) + '.' + value.substring(5, 8) + '/' + value.substring(8);
        } else {
            return value.substring(0, 2) + '.' + value.substring(2, 5) + '.' + value.substring(5, 8) + '/' + value.substring(8, 12) + '-' + value.substring(12);
        }
    }

    function formatDocument(value) {
        // Remove tudo que não é dígito
        var digits = value.replace(/\\D/g, '');

        // Se tem mais de 11 dígitos, é CNPJ
        if (digits.length > 11) {
            return formatCNPJ(value);
        } else {
            return formatCPF(value);
        }
    }

    // Aguarda o DOM carregar
    setTimeout(function() {
        const inputs = document.querySelectorAll('input[type="text"]');
        inputs.forEach(function(input) {
            if (input.placeholder && (input.placeholder.includes('CPF') || input.placeholder.includes('CNPJ'))) {
                input.addEventListener('input', function(e) {
                    const cursorPos = e.target.selectionStart;
                    const oldLength = e.target.value.length;
                    e.target.value = formatDocument(e.target.value);
                    const newLength = e.target.value.length;

                    // Ajusta posição do cursor
                    const diff = newLength - oldLength;
                    e.target.setSelectionRange(cursorPos + diff, cursorPos + diff);
                });
            }
        });
    }, 100);
    </script>
    """, unsafe_allow_html=True)

    col1, col2 = st.columns([3, 1])

    with col1:
        search_input = st.text_input(
            "Nome completo, CPF ou CNPJ:",
            placeholder="Ex: João Silva, 123.456.789-10 ou 11.222.333/0001-44",
            key="search_input"
        )

    with col2:
        if st.button("🔍 Nova Pesquisa", type="primary", use_container_width=True):
            if not search_input.strip():
                st.warning("Digite um nome ou CPF para pesquisar.")
                return

            perform_search(search_input)


def render_bulk_search_tab():
    """Renderiza aba de pesquisa em lote"""
    st.subheader("Pesquisa em Lote de CPFs e CNPJs via CSV")

    st.markdown("""
    Faça upload de um arquivo CSV contendo CPFs e/ou CNPJs para pesquisar múltiplos registros de uma vez.
    O sistema extrairá automaticamente todos os CPFs e CNPJs do arquivo.
    """)

    # Upload de arquivo
    uploaded_file = st.file_uploader(
        "Escolha um arquivo CSV",
        type=['csv'],
        help="Faça upload de um arquivo CSV contendo CPFs e/ou CNPJs. Tamanho máximo: 10MB"
    )

    if uploaded_file is not None:
        # Validar arquivo
        is_valid, message = CSVProcessor.validate_csv_file(uploaded_file)

        if not is_valid:
            st.error(f"❌ {message}")
            return

        # Processar CSV
        with st.spinner("Processando arquivo CSV..."):
            cpf_list, cnpj_list, _ = CSVProcessor.process_csv_file(uploaded_file)

        if not cpf_list and not cnpj_list:
            st.warning("⚠️ Nenhum CPF ou CNPJ válido encontrado no arquivo enviado.")
            return

        # Exibir prévia de CPFs
        if cpf_list:
            st.success(f"✅ Encontrados {len(cpf_list)} CPFs únicos no arquivo")

            with st.expander("📋 Prévia dos CPFs extraídos", expanded=False):
                formatted_cpfs = [DataFormatter.format_cpf(cpf) for cpf in cpf_list[:50]]

                if len(cpf_list) <= 50:
                    st.write(", ".join(formatted_cpfs))
                else:
                    st.write(", ".join(formatted_cpfs))
                    st.info(f"... e mais {len(cpf_list) - 50} CPFs")

        # Exibir prévia de CNPJs
        if cnpj_list:
            st.success(f"✅ Encontrados {len(cnpj_list)} CNPJs únicos no arquivo")

            with st.expander("📋 Prévia dos CNPJs extraídos", expanded=False):
                formatted_cnpjs = [CNPJValidator.format_cnpj(cnpj) for cnpj in cnpj_list[:50]]

                if len(cnpj_list) <= 50:
                    st.write(", ".join(formatted_cnpjs))
                else:
                    st.write(", ".join(formatted_cnpjs))
                    st.info(f"... e mais {len(cnpj_list) - 50} CNPJs")

        # Botão de pesquisa
        total_docs = len(cpf_list) + len(cnpj_list)
        col1, col2 = st.columns([1, 3])

        with col1:
            if st.button("🔍 Iniciar Pesquisa em Lote", type="primary", use_container_width=True):
                perform_bulk_search(cpf_list, cnpj_list)

        with col2:
            st.info(f"Isso pesquisará {total_docs} documentos ({len(cpf_list)} CPFs e {len(cnpj_list)} CNPJs). Pode levar alguns minutos.")

    # Exibir resultados anteriores de pesquisa em lote, se disponíveis
    if 'bulk_results' in st.session_state and st.session_state.bulk_results:
        st.markdown("---")
        st.subheader("📊 Resultados da Última Pesquisa em Lote")
        BulkSearchViewComponents.render_bulk_search_results(st.session_state.bulk_results)


def perform_search(search_input: str):
    """Realiza pesquisa baseada na entrada"""
    api = st.session_state.get('api') or PredictusAPI()
    st.session_state.api = api

    with st.spinner("Pesquisando processos..."):
        if CNPJValidator.is_cnpj(search_input):
            cnpj = re.sub(r'\D', '', search_input)
            st.info(f"Pesquisando por CNPJ: {CNPJValidator.format_cnpj(cnpj)}")
            results = api.search_by_cnpj(cnpj)
            search_type, display_term = "CNPJ", cnpj
        elif CPFValidator.is_cpf(search_input):
            cpf = re.sub(r'\D', '', search_input)
            st.info(f"Pesquisando por CPF: {DataFormatter.format_cpf(cpf)}")
            results = api.search_by_cpf(cpf)
            search_type, display_term = "CPF", cpf
        else:
            st.info(f"Pesquisando por nome: {search_input}")
            results = api.search_by_name(search_input)
            search_type, display_term = "Nome", search_input

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
            st.success("✅ Pesquisa salva no histórico permanente!")


def perform_bulk_search(cpf_list: list, cnpj_list: list = None):
    """Realiza pesquisa em lote de CPFs e CNPJs"""
    if cnpj_list is None:
        cnpj_list = []

    api = st.session_state.get('api') or PredictusAPI()
    st.session_state.api = api

    # Criar gerenciador de pesquisa em lote
    bulk_manager = BulkSearchManager(api)

    # Total de documentos a pesquisar
    total_docs = len(cpf_list) + len(cnpj_list)

    # Rastreamento de progresso
    progress_bar = st.progress(0)
    status_text = st.empty()

    def update_cpf_progress(current: int, _total: int, cpf: str):
        """Atualiza barra de progresso para CPFs"""
        progress = current / total_docs
        progress_bar.progress(progress)
        status_text.text(f"Pesquisando CPF {current}/{len(cpf_list)}: {DataFormatter.format_cpf(cpf)}")

    def update_cnpj_progress(current: int, _total: int, cnpj: str):
        """Atualiza barra de progresso para CNPJs"""
        progress = (len(cpf_list) + current) / total_docs
        progress_bar.progress(progress)
        status_text.text(f"Pesquisando CNPJ {current}/{len(cnpj_list)}: {CNPJValidator.format_cnpj(cnpj)}")

    # Realizar pesquisa de CPFs
    with st.spinner("Realizando pesquisa em lote..."):
        if cpf_list:
            bulk_manager.search_cpf_list(cpf_list, progress_callback=update_cpf_progress)

        # Realizar pesquisa de CNPJs
        if cnpj_list:
            bulk_manager.search_cnpj_list(cnpj_list, progress_callback=update_cnpj_progress)

    # Limpar indicadores de progresso
    progress_bar.empty()
    status_text.empty()

    # Armazenar resultados
    st.session_state.bulk_results = bulk_manager.results

    # Exibir resumo
    summary = bulk_manager.get_summary()
    st.success(f"✅ Pesquisa em lote concluída! Pesquisados {summary['total_searched']} documentos ({summary.get('cpfs_searched', 0)} CPFs e {summary.get('cnpjs_searched', 0)} CNPJs)")

    # Recarregar para exibir resultados
    st.rerun()


def render_search_results():
    """Renderiza resultados da pesquisa"""
    if st.session_state.resultados is None:
        return

    results = st.session_state.resultados

    if len(results) == 0:
        st.warning("Nenhum processo encontrado.")
        return

    st.success(f"Encontrados {len(results)} processos")
    st.markdown("---")

    # Estatísticas
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
        st.metric("Tribunal Principal", main_court)
    with col3:
        st.metric("Valor Total", DataFormatter.format_currency(total_value))

    st.markdown("---")
    st.subheader("📋 Processos Encontrados")

    for i, process in enumerate(results):
        ProcessViewComponents.render_process_details(process, i)


def render_sidebar():
    """Renderiza barra lateral com informações e histórico"""
    with st.sidebar:
        st.header("Informações")
        st.markdown("""
        **Como usar:**
        1. Digite nome completo ou CPF
        2. Clique em "Pesquisar"
        3. Navegue pelos processos
        4. Use "Obter Detalhes" para movimentações

        **Recursos:**
        - 💾 Histórico salvo automaticamente
        - 🔄 Pesquisas + detalhes persistem após recarregar
        - 🔍 Pesquisa por nome ou CPF
        - 📋 Detalhes completos dos processos
        - ⚖️ Movimentações de processos salvos
        """)

        render_search_history()
        AuthViewComponents.render_user_info()


def render_search_history():
    """Renderiza histórico de pesquisas na barra lateral"""
    st.markdown("---")
    st.header("Histórico de Pesquisas")

    history = st.session_state.historico_pesquisas

    if not history:
        st.info("Nenhuma pesquisa salva ainda.")
        st.caption("💾 Pesquisas e detalhes são salvos automaticamente")
        return

    st.write(f"**{len(history)} pesquisas salvas**")
    st.caption("💾 Histórico salvo automaticamente")

    for i, search in enumerate(history):
        details_count = len(search.get('detalhes_processos', {}))
        details_info = f" + {details_count} detalhados" if details_count > 0 else ""
        term_display = search['termo'][:20] + ('...' if len(search['termo']) > 20 else '')

        with st.expander(f"{search['tipo']}: {term_display}", expanded=False):
            st.write(f"**Tipo:** {search['tipo']}")
            st.write(f"**Termo:** {search['termo']}")
            st.write(f"**Data/Hora:** {search['data_hora']}")
            st.write(f"**Processos:** {search['total_processos']}{details_info}")

            if details_count > 0:
                st.write(f"**💾 Detalhes salvos:** {details_count} processos")

            col1, col2 = st.columns(2)

            with col1:
                if st.button("📂 Abrir", key=f"reopen_{i}"):
                    reopen_search(search)

            with col2:
                if st.button("🗑️ Deletar", key=f"delete_{i}"):
                    delete_search(search, i)


def reopen_search(search: dict):
    """Reabre uma pesquisa salva"""
    st.session_state.resultados = search['resultados']

    # Carregar detalhes salvos
    details_processes = search.get('detalhes_processos', {})
    for process_number, details in details_processes.items():
        st.session_state[f"detalhes_{process_number}"] = details

    details_count = len(details_processes)
    if details_count > 0:
        st.success(f"Pesquisa aberta: {search['total_processos']} processos + {details_count} com detalhes salvos")
    else:
        st.success(f"Pesquisa aberta: {search['total_processos']} processos")

    st.rerun()


def delete_search(search: dict, index: int):
    """Deleta uma pesquisa do histórico"""
    st.session_state.historico_pesquisas.pop(index)

    if FileStorage.save_search_history(st.session_state.historico_pesquisas):
        st.success(f"✅ Pesquisa '{search['termo']}' deletada do histórico!")
    else:
        st.error("❌ Erro ao deletar pesquisa do arquivo.")

    st.rerun()


def main_app():
    """Aplicação principal após login"""
    initialize_session_state()
    render_search_interface()
    render_search_results()
    render_sidebar()


def main():
    """Função principal controlando fluxo de autenticação"""
    st.set_page_config(
        page_title="Consulta de Processos Judiciais MVP",
        page_icon="⚖️",
        layout="wide"
    )

    if not AuthenticationManager.is_authenticated():
        AuthViewComponents.render_login_screen()
    else:
        main_app()


if __name__ == "__main__":
    main()
