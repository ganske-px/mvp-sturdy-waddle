import streamlit as st
import hashlib
from datetime import datetime

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def verificar_credenciais(username, password):
    usuarios_validos = st.secrets.get("USUARIOS_APP", {})
    
    if not usuarios_validos:
        usuarios_validos = {
            "admin": "admin123",
            "user": "user123"
        }
    
    if username in usuarios_validos:
        return password == usuarios_validos[username]
    return False

def tela_login():
    st.set_page_config(page_title="Login - Sistema de Consultas", page_icon="🔐", layout="centered")
    
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
        col1, col2, col3 = st.columns([1, 2, 1])
        
        with col2:
            st.markdown('<div class="login-container">', unsafe_allow_html=True)
            st.markdown('<h1 class="login-title">🔐 Login</h1>', unsafe_allow_html=True)
            st.markdown('<h3 style="text-align: center; color: #666;">Sistema de Consultas</h3>', unsafe_allow_html=True)
            st.markdown("---")
            
            username = st.text_input("👤 Usuário:", placeholder="Digite seu usuário")
            password = st.text_input("🔒 Senha:", type="password", placeholder="Digite sua senha")
            
            st.markdown("<br>", unsafe_allow_html=True)
            
            if st.button("🚀 Entrar", type="primary", use_container_width=True):
                if not username or not password:
                    st.error("❌ Preencha todos os campos!")
                elif verificar_credenciais(username, password):
                    st.session_state.authenticated = True
                    st.session_state.username = username
                    st.session_state.login_time = datetime.now()
                    st.success("✅ Login realizado com sucesso!")
                    st.rerun()
                else:
                    st.error("❌ Usuário ou senha inválidos!")
            
            st.markdown("---")
            
            with st.expander("ℹ️ Informações de Acesso"):
                st.info("""
                **Usuários padrão:**
                - admin / admin123
                - user / user123
                
                **Para personalizar, configure no arquivo .streamlit/secrets.toml:**
                ```toml
                [USUARIOS_APP]
                "seu_usuario" = "sua_senha"
                "outro_user" = "outra_senha"
                ```
                """)
            
            st.markdown('</div>', unsafe_allow_html=True)

def verificar_autenticacao():
    return st.session_state.get('authenticated', False)

def logout():
    keys_to_remove = ['authenticated', 'username', 'login_time']
    for key in keys_to_remove:
        if key in st.session_state:
            del st.session_state[key]
    st.success("✅ Logout realizado com sucesso!")
    st.rerun()

def exibir_info_usuario():
    if verificar_autenticacao():
        with st.sidebar:
            st.markdown("---")
            st.markdown("### 👤 Usuário Logado")
            st.write(f"**Usuário:** {st.session_state.username}")
            
            login_time = st.session_state.get('login_time')
            if login_time:
                st.write(f"**Login:** {login_time.strftime('%d/%m/%Y %H:%M')}")
            
            if st.button("🚪 Logout", use_container_width=True):
                logout()