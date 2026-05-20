"""
Componentes de Visualização de Autenticação
Componentes de UI para login e exibição de informações do usuário
"""
import streamlit as st
from datetime import datetime
from models.auth import AuthenticationManager


class AuthViewComponents:
    """Componentes de UI para autenticação"""

    @staticmethod
    def render_login_screen():
        """Renderiza tela de login"""
        st.markdown("""
        <style>
        .login-container {
            max-width: 400px;
            margin: 0 auto;
            padding: 2rem;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            background-color: #f8f9fa;
        }
        .login-title {
            text-align: center;
            color: #1f77b4;
            margin-bottom: 2rem;
        }
        </style>
        """, unsafe_allow_html=True)

        with st.container():
            _, col2, _ = st.columns([1, 2, 1])

            with col2:
                st.markdown('<div class="login-container">', unsafe_allow_html=True)
                st.markdown('<h1 class="login-title">🔐 Login</h1>', unsafe_allow_html=True)
                st.markdown('<h3 style="text-align: center; color: #666;">Consulta de Processos Judiciais</h3>', unsafe_allow_html=True)
                st.markdown("---")

                username = st.text_input("👤 Usuário:", placeholder="Digite seu nome de usuário")
                password = st.text_input("🔒 Senha:", type="password", placeholder="Digite sua senha")

                st.markdown("<br>", unsafe_allow_html=True)

                if st.button("🚀 Entrar", type="primary", use_container_width=True):
                    if not username or not password:
                        st.error("❌ Por favor, preencha todos os campos!")
                    elif AuthenticationManager.verify_credentials(username, password):
                        st.session_state.authenticated = True
                        st.session_state.username = username
                        st.session_state.login_time = datetime.now()

                        st.success("✅ Login realizado com sucesso!")
                        st.rerun()
                    else:
                        st.error("❌ Usuário ou senha inválidos!")

                st.markdown("---")
                st.markdown('</div>', unsafe_allow_html=True)

    @staticmethod
    def render_user_info():
        """Renderiza informações do usuário na barra lateral"""
        if AuthenticationManager.is_authenticated():
            with st.sidebar:
                st.markdown("---")
                st.markdown("### 👤 Usuário Logado")
                st.write(f"**Usuário:** {st.session_state.username}")

                login_time = st.session_state.get('login_time')
                if login_time:
                    st.write(f"**Login:** {login_time.strftime('%d/%m/%Y %H:%M')}")

                if st.button("🚪 Sair", use_container_width=True):
                    AuthenticationManager.logout()
