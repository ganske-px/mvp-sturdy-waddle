"""
Modelo de Autenticação
Autenticação de usuários e gerenciamento de sessão
"""
import hashlib
import streamlit as st


class AuthenticationManager:
    """Gerencia autenticação de usuários"""

    @staticmethod
    def hash_password(password: str) -> str:
        """Cria hash SHA256 da senha"""
        return hashlib.sha256(password.encode()).hexdigest()

    @staticmethod
    def verify_credentials(username: str, password: str) -> bool:
        """Verifica se as credenciais são válidas"""
        try:
            valid_users = st.secrets.get("USUARIOS_APP", {})
            return username in valid_users and valid_users[username] == password
        except Exception as e:
            st.error(f"Erro ao verificar credenciais: {e}")
            return False

    @staticmethod
    def is_authenticated() -> bool:
        """Verifica se o usuário está autenticado"""
        return st.session_state.get('authenticated', False)

    @staticmethod
    def logout() -> None:
        """Deslogar usuário"""
        keys_to_clear = ['authenticated', 'username', 'login_time', 'api', 'resultados']
        for key in keys_to_clear:
            st.session_state.pop(key, None)

        st.success("✅ Logout realizado com sucesso!")
        st.rerun()
