import streamlit as st
from src.core.auth import verificar_autenticacao, tela_login, exibir_info_usuario
from src.components.process_search import secao_processos
from src.components.cnh_search import secao_cnh
from src.components.history import carregar_historico, exibir_historico_sidebar

def inicializar_sessao():
    if 'historico_pesquisas' not in st.session_state:
        historico_carregado = carregar_historico()
        # Converter formato antigo para novo se necessário
        if isinstance(historico_carregado, list):
            st.session_state.historico_pesquisas = {"processos": historico_carregado, "cnh": []}
        else:
            st.session_state.historico_pesquisas = historico_carregado

def app_principal():
    st.set_page_config(
        page_title="Sistema de Consultas", 
        page_icon="🔍", 
        layout="wide"
    )
    
    st.title("🔍 Sistema de Consultas")
    st.markdown("---")
    
    inicializar_sessao()
    
    # Seleção do tipo de consulta
    tipo_consulta = st.selectbox(
        "Escolha o tipo de consulta:",
        ["processos", "cnh"],
        format_func=lambda x: "⚖️ Processos Judiciais" if x == "processos" else "🚗 Impedimentos CNH",
        key="tipo_consulta"
    )
    
    st.markdown("---")
    
    # Renderizar seção baseada na seleção
    if tipo_consulta == "processos":
        secao_processos()
    else:
        secao_cnh()
    
    # Sidebar
    exibir_historico_sidebar()
    exibir_info_usuario()

def main():
    if not verificar_autenticacao():
        tela_login()
    else:
        app_principal()

if __name__ == "__main__":
    main()